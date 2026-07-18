const MAX_ACTIVE_FILES = 1000;
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const CONCURRENCY = 4;

function statusLabel(status) {
  return { uploading: 'Uploading', queued: 'Queued', processing: 'Processing', completed: 'Completed', duplicate: 'Duplicate', failed: 'Failed' }[status] ?? status;
}

function putFile(url, file, onProgress) {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open('PUT', url);
    request.setRequestHeader('Content-Type', file.type || 'application/octet-stream');
    request.upload.addEventListener('progress', (event) => {
      if (event.lengthComputable) onProgress(Math.round((event.loaded / event.total) * 100));
    });
    request.addEventListener('load', () => request.status >= 200 && request.status < 300 ? resolve() : reject(new Error('Object upload failed.')));
    request.addEventListener('error', () => reject(new Error('Object upload failed.')));
    request.send(file);
  });
}

async function jsonRequest(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...options.headers },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error?.message || 'Request failed.');
  return body;
}

export function initializeFlightUploads(documentRef = document, windowRef = globalThis.window) {
  const uploadDialog = documentRef.querySelector('[data-upload-dialog]');
  const uploadList = documentRef.querySelector('[data-upload-list]');
  const overall = documentRef.querySelector('[data-upload-overall]');
  const progressTrigger = documentRef.querySelector('[data-flight-progress-trigger]');
  const progressBar = documentRef.querySelector('[data-flight-progress-bar]');
  const progressCount = documentRef.querySelector('[data-flight-progress-count]');
  const progressDialog = documentRef.querySelector('[data-flight-progress-dialog]');
  const progressList = documentRef.querySelector('[data-flight-progress-list]');
  const previousProgress = documentRef.querySelector('[data-flight-progress-previous]');
  const nextProgress = documentRef.querySelector('[data-flight-progress-next]');
  const progressPage = documentRef.querySelector('[data-flight-progress-page]');
  const closeProgress = documentRef.querySelector('[data-flight-progress-close]');
  const clearFailed = documentRef.querySelector('[data-clear-failed]');
  if (!windowRef || !uploadDialog || !uploadList || !overall || !progressTrigger || !progressBar || !progressCount) return;
  const inputs = [...documentRef.querySelectorAll('[data-upload-input], [data-upload-more-input]')];

  const pending = [];
  let running = 0;
  let settled = 0;
  let selected = 0;
  let serverTotal = 0;
  let modalServerBaseline = null;
  let observedExternalGrowth = 0;
  const currentReservations = new Set();
  const currentIntentIds = new Set();
  const representedIntentIds = new Set();
  let reloadScheduled = false;
  let reloadTimer = null;
  let initialProgressResolved = false;
  let resolveInitialProgress;
  const initialProgress = new Promise((resolve) => { resolveInitialProgress = resolve; });
  let requestedProgressPage = 1;
  let progressPageCount = 1;
  let detailRequestSequence = 0;

  async function loadProgressDetails(page = 1) {
    if (!progressList) return;
    requestedProgressPage = Math.max(1, Math.min(page, progressPageCount));
    const requestSequence = ++detailRequestSequence;
    const result = await jsonRequest(`/v1/igc-upload-jobs?page=${requestedProgressPage}`);
    if (requestSequence !== detailRequestSequence) return;
    progressPageCount = Math.max(1, Math.ceil(result.total / result.pageSize));
    requestedProgressPage = Math.min(result.page, progressPageCount);
    progressList.replaceChildren(...result.jobs.map((job) => {
      const row = documentRef.createElement('div');
      row.className = 'flight-progress-row';
      const name = documentRef.createElement('span');
      name.textContent = job.originalFilename;
      const state = documentRef.createElement('span');
      state.textContent = job.error || statusLabel(job.status);
      if (job.status === 'failed') state.className = 'error';
      row.append(name, state);
      return row;
    }));
    if (progressPage) progressPage.textContent = `Page ${requestedProgressPage} of ${progressPageCount}`;
    if (previousProgress) previousProgress.disabled = requestedProgressPage <= 1;
    if (nextProgress) nextProgress.disabled = requestedProgressPage >= progressPageCount;
  }

  function updateOverall() {
    overall.textContent = `${settled}/${selected}`;
    if (selected > 0 && settled === selected && running === 0 && pending.length === 0 && !reloadScheduled) {
      reloadScheduled = true;
      reloadTimer = windowRef.setTimeout(() => {
        reloadTimer = null;
        windowRef.location.reload();
      }, 500);
    }
  }

  function makeRow(file) {
    const row = documentRef.createElement('div');
    row.className = 'flight-upload-row';
    const name = documentRef.createElement('span');
    name.textContent = file.name;
    const progress = documentRef.createElement('progress');
    progress.max = 100;
    progress.value = 0;
    const status = documentRef.createElement('span');
    status.textContent = 'Waiting';
    row.append(name, progress, status);
    uploadList.append(row);
    return { progress, status };
  }

  async function upload(item) {
    item.row.status.textContent = 'Preparing';
    const intent = await jsonRequest('/v1/igc-uploads/intents', {
      method: 'POST',
      body: JSON.stringify({ originalFilename: item.file.name, contentType: item.file.type || 'application/octet-stream', byteSize: item.file.size }),
    });
    item.intentId = intent.id;
    currentIntentIds.add(intent.id);
    item.row.status.textContent = 'Uploading';
    await putFile(intent.uploadUrl, item.file, (percent) => { item.row.progress.value = percent; });
    item.row.progress.value = 100;
    item.row.status.textContent = 'Queueing';
    await jsonRequest(`/v1/igc-uploads/${intent.id}/complete`, { method: 'POST', body: '{}' });
    item.row.status.textContent = 'Queued';
  }

  function releaseReservation(item) {
    if (!currentReservations.delete(item)) return;
    if (item.intentId) {
      currentIntentIds.delete(item.intentId);
      representedIntentIds.delete(item.intentId);
    }
  }

  async function releaseFailedUpload(item) {
    if (!item.intentId) {
      releaseReservation(item);
      return;
    }
    try {
      const result = await jsonRequest(`/v1/igc-uploads/${item.intentId}`, { method: 'DELETE' });
      if (result.removed === true) releaseReservation(item);
    } catch (error) {
      console.error('Unable to cancel failed flight upload', error);
    }
  }

  function pump() {
    while (running < CONCURRENCY && pending.length) {
      const item = pending.shift();
      running += 1;
      void upload(item).catch(async (error) => {
        item.row.status.textContent = error.message;
        item.row.status.classList.add('error');
        await releaseFailedUpload(item);
      }).finally(() => {
        running -= 1;
        settled += 1;
        updateOverall();
        pump();
      });
    }
  }

  function addFiles(fileList) {
    const files = [...fileList];
    if (!files.length) return;
    const valid = files.filter((file) => file.name.toLowerCase().endsWith('.igc') && file.size > 0 && file.size <= MAX_FILE_BYTES);
    if (valid.length !== files.length) windowRef.alert('Only non-empty .igc files of 10 MB or less can be uploaded.');
    if (!valid.length) return;
    if (modalServerBaseline === null) modalServerBaseline = serverTotal;
    const accountedTotal = Math.max(serverTotal, modalServerBaseline + observedExternalGrowth + currentReservations.size);
    if (valid.length > MAX_ACTIVE_FILES - accountedTotal) {
      windowRef.alert(`You can have at most ${MAX_ACTIVE_FILES} active flight uploads.`);
      return;
    }
    if (reloadScheduled) {
      if (reloadTimer !== null) windowRef.clearTimeout?.(reloadTimer);
      reloadTimer = null;
      reloadScheduled = false;
    }
    for (const file of valid) {
      const item = { file, row: makeRow(file) };
      currentReservations.add(item);
      pending.push(item);
    }
    selected += valid.length;
    updateOverall();
    if (valid.length && !uploadDialog.open) uploadDialog.showModal();
    pump();
  }

  async function pollProgress() {
    const intentIdsBeforeRequest = new Set(currentIntentIds);
    try {
      const progress = await jsonRequest('/v1/igc-upload-progress');
      serverTotal = progress.total;
      for (const id of intentIdsBeforeRequest) {
        if (currentIntentIds.has(id)) representedIntentIds.add(id);
      }
      if (modalServerBaseline !== null) {
        observedExternalGrowth = Math.max(
          observedExternalGrowth,
          serverTotal - modalServerBaseline - representedIntentIds.size,
        );
      }
      if (!progress.total) {
        progressTrigger.hidden = true;
      } else {
        progressTrigger.hidden = false;
        progressBar.max = progress.total;
        progressBar.value = progress.finished;
        progressCount.textContent = `${progress.finished}/${progress.total}`;
      }
      if (clearFailed) clearFailed.hidden = progress.failed === 0;
      if (progressDialog?.open) await loadProgressDetails(requestedProgressPage);
      if (!initialProgressResolved) {
        initialProgressResolved = true;
        resolveInitialProgress();
      }
    } catch (error) {
      console.error('Unable to load flight progress', error);
    }
    windowRef.setTimeout(pollProgress, 2500);
  }

  for (const input of inputs) input.addEventListener('change', () => {
    const selectedFiles = [...input.files];
    input.value = '';
    void initialProgress.then(() => addFiles(selectedFiles));
  });
  progressTrigger.addEventListener('click', () => {
    progressDialog?.showModal();
    void loadProgressDetails(1).catch((error) => console.error('Unable to load flight details', error));
  });
  previousProgress?.addEventListener('click', () => {
    if (requestedProgressPage > 1) void loadProgressDetails(requestedProgressPage - 1);
  });
  nextProgress?.addEventListener('click', () => {
    if (requestedProgressPage < progressPageCount) void loadProgressDetails(requestedProgressPage + 1);
  });
  closeProgress?.addEventListener('click', () => progressDialog.close());
  clearFailed?.addEventListener('click', async () => {
    clearFailed.disabled = true;
    try {
      await jsonRequest('/v1/igc-upload-failures', { method: 'DELETE' });
      windowRef.location.reload();
    } finally {
      clearFailed.disabled = false;
    }
  });
  void pollProgress();
}
