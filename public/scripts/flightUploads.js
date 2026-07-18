const MAX_ACTIVE_FILES = 1000;
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const CONCURRENCY = 4;
const PROGRESS_POLL_INTERVAL_MS = 10_000;

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
  const progressBar = documentRef.querySelector('[data-flight-progress-bar]');
  const progressCount = documentRef.querySelector('[data-flight-progress-count]');
  if (!windowRef || !uploadDialog || !uploadList || !overall || !progressBar || !progressCount) return;
  const inputs = [...documentRef.querySelectorAll('[data-upload-input], [data-upload-more-input]')];

  const pending = [];
  let running = 0;
  let settled = 0;
  let selected = 0;
  let failed = 0;
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
  let initialProgress = new Promise((resolve) => { resolveInitialProgress = resolve; });
  let progressPollTimer = null;
  let progressPollCycle = 0;

  function updateOverall() {
    overall.textContent = `${settled}/${selected}`;
    if (selected > 0 && settled === selected && failed === 0 && running === 0 && pending.length === 0 && !reloadScheduled) {
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
        failed += 1;
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

  function addFiles(valid) {
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
    pump();
  }

  async function pollProgress(cycle) {
    const intentIdsBeforeRequest = new Set(currentIntentIds);
    try {
      const progress = await jsonRequest('/v1/igc-upload-progress');
      if (cycle !== progressPollCycle || !uploadDialog.open) return;
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
      progressBar.max = Math.max(progress.total, 1);
      progressBar.value = progress.finished;
      progressCount.textContent = `${progress.finished}/${progress.total}`;
      if (!initialProgressResolved) {
        initialProgressResolved = true;
        resolveInitialProgress();
      }
    } catch (error) {
      console.error('Unable to load flight progress', error);
    }
    if (cycle === progressPollCycle && uploadDialog.open) {
      progressPollTimer = windowRef.setTimeout(() => {
        progressPollTimer = null;
        void pollProgress(cycle);
      }, PROGRESS_POLL_INTERVAL_MS);
    }
  }

  function startProgressPolling() {
    if (progressPollTimer !== null) windowRef.clearTimeout?.(progressPollTimer);
    progressPollTimer = null;
    progressPollCycle += 1;
    if (initialProgressResolved) {
      initialProgressResolved = false;
      initialProgress = new Promise((resolve) => { resolveInitialProgress = resolve; });
    }
    void pollProgress(progressPollCycle);
  }

  function stopProgressPolling() {
    progressPollCycle += 1;
    if (progressPollTimer !== null) windowRef.clearTimeout?.(progressPollTimer);
    progressPollTimer = null;
  }

  for (const input of inputs) input.addEventListener('change', () => {
    const files = [...input.files];
    input.value = '';
    if (!files.length) return;
    const valid = files.filter((file) => file.name.toLowerCase().endsWith('.igc') && file.size > 0 && file.size <= MAX_FILE_BYTES);
    if (valid.length !== files.length) windowRef.alert('Only non-empty .igc files of 10 MB or less can be uploaded.');
    if (!valid.length) return;
    if (!uploadDialog.open) {
      uploadDialog.showModal();
      startProgressPolling();
    }
    void initialProgress.then(() => addFiles(valid));
  });
  uploadDialog.addEventListener('close', stopProgressPolling);
}
