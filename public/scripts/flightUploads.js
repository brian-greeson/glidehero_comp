import { extractIgcFilesFromZip } from './zipIgcFiles.js';

const MAX_ACTIVE_FILES = 1000;
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const CONCURRENCY = 4;
const PROGRESS_POLL_INTERVAL_MS = 5_000;

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
  const uploadTrigger = documentRef.querySelector('[data-upload-trigger]');
  const uploadDialog = documentRef.querySelector('[data-upload-dialog]');
  const uploadClose = documentRef.querySelector('[data-upload-close]');
  const uploadList = documentRef.querySelector('[data-upload-list]');
  const overall = documentRef.querySelector('[data-upload-overall]');
  const progressBar = documentRef.querySelector('[data-flight-progress-bar]');
  const progressCount = documentRef.querySelector('[data-flight-progress-count]');
  if (!windowRef || !uploadTrigger || !uploadDialog || !uploadList || !overall || !progressBar || !progressCount) return;
  const inputs = [...documentRef.querySelectorAll('[data-upload-more-input]')];

  const pending = [];
  let running = 0;
  let settled = 0;
  let selected = 0;
  let serverTotal = 0;
  let serverFinished = 0;
  let modalServerBaseline = null;
  let observedExternalGrowth = 0;
  const currentReservations = new Set();
  const currentIntentIds = new Set();
  const representedIntentIds = new Set();
  let resolveInitialProgress;
  const initialProgress = new Promise((resolve) => { resolveInitialProgress = resolve; });
  let initialProgressResolved = false;
  let progressPollTimer = null;
  let progressRequestId = 0;

  function updateUploadTrigger() {
    const localWorkActive = selected > settled || currentReservations.size > 0;
    uploadTrigger.textContent = localWorkActive || serverTotal > serverFinished ? 'Upload Status' : 'Upload';
  }

  function updateOverall() {
    overall.textContent = `${settled}/${selected}`;
    updateUploadTrigger();
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

  function addFiles(valid) {
    if (modalServerBaseline === null) modalServerBaseline = serverTotal;
    const accountedTotal = Math.max(serverTotal, modalServerBaseline + observedExternalGrowth + currentReservations.size);
    if (valid.length > MAX_ACTIVE_FILES - accountedTotal) {
      windowRef.alert(`You can have at most ${MAX_ACTIVE_FILES} active flight uploads.`);
      return;
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

  function scheduleProgressPoll() {
    if (progressPollTimer !== null) windowRef.clearTimeout?.(progressPollTimer);
    if (!uploadDialog.open) {
      progressPollTimer = null;
      return;
    }
    progressPollTimer = windowRef.setTimeout(() => {
      progressPollTimer = null;
      void refreshProgress();
    }, PROGRESS_POLL_INTERVAL_MS);
  }

  async function refreshProgress() {
    const requestId = ++progressRequestId;
    const intentIdsBeforeRequest = new Set(currentIntentIds);
    try {
      const progress = await jsonRequest('/v1/igc-upload-progress');
      if (requestId !== progressRequestId) return;
      serverTotal = progress.total;
      serverFinished = progress.finished;
      for (const id of intentIdsBeforeRequest) {
        if (currentIntentIds.has(id)) representedIntentIds.add(id);
      }
      if (modalServerBaseline !== null) {
        observedExternalGrowth = Math.max(
          observedExternalGrowth,
          serverTotal - modalServerBaseline - representedIntentIds.size,
        );
      }
      const reservations = [...currentReservations];
      if (
        serverTotal === 0
        && selected === settled
        && running === 0
        && pending.length === 0
        && reservations.length > 0
        && reservations.every((item) => item.intentId && intentIdsBeforeRequest.has(item.intentId))
      ) {
        currentReservations.clear();
        currentIntentIds.clear();
        representedIntentIds.clear();
        modalServerBaseline = null;
        observedExternalGrowth = 0;
      }
      progressBar.max = Math.max(progress.total, 1);
      progressBar.value = progress.finished;
      progressCount.textContent = `${progress.finished}/${progress.total}`;
      updateUploadTrigger();
      if (!initialProgressResolved) {
        initialProgressResolved = true;
        resolveInitialProgress();
      }
    } catch (error) {
      console.error('Unable to load flight progress', error);
    }
    if (requestId === progressRequestId && uploadDialog.open) scheduleProgressPoll();
  }

  function openUploadDialog() {
    if (!uploadDialog.open) uploadDialog.showModal();
    void refreshProgress();
  }

  function stopProgressPolling() {
    if (progressPollTimer !== null) windowRef.clearTimeout?.(progressPollTimer);
    progressPollTimer = null;
  }

  function closeUploadDialog() {
    if (uploadDialog.open) uploadDialog.close();
  }

  async function prepareFiles(files) {
    const prepared = [];
    const messages = [];
    let invalidFiles = 0;
    for (const file of files) {
      const lowerName = file.name.toLowerCase();
      if (lowerName.endsWith('.igc')) {
        if (file.size > 0 && file.size <= MAX_FILE_BYTES) prepared.push(file);
        else invalidFiles += 1;
        continue;
      }
      if (!lowerName.endsWith('.zip')) {
        invalidFiles += 1;
        continue;
      }
      try {
        const extracted = await extractIgcFilesFromZip(file, { maxEntryBytes: MAX_FILE_BYTES });
        prepared.push(...extracted.files);
        if (extracted.skippedEntries > 0) {
          messages.push(`${file.name}: skipped ${extracted.skippedEntries} non-IGC ${extracted.skippedEntries === 1 ? 'file' : 'files'}.`);
        }
      } catch (error) {
        messages.push(`${file.name}: ${error instanceof Error ? error.message : 'The ZIP archive could not be opened.'}`);
      }
    }
    if (invalidFiles > 0) messages.unshift('Only non-empty .igc files of 10 MB or less and .zip archives can be uploaded.');
    return { prepared, messages };
  }

  uploadTrigger.addEventListener('click', openUploadDialog);
  uploadClose?.addEventListener('click', closeUploadDialog);
  uploadDialog.addEventListener('close', stopProgressPolling);
  uploadDialog.addEventListener('cancel', (event) => {
    event.preventDefault();
    closeUploadDialog();
  });
  uploadDialog.addEventListener('click', (event) => {
    if (event.target === uploadDialog) closeUploadDialog();
  });

  for (const input of inputs) input.addEventListener('change', () => {
    const files = [...input.files];
    input.value = '';
    if (!files.length) return;
    if (!uploadDialog.open) openUploadDialog();
    void prepareFiles(files).then(async ({ prepared, messages }) => {
      if (messages.length) windowRef.alert(messages.join('\n'));
      if (!prepared.length) return;
      await initialProgress;
      addFiles(prepared);
    });
  });
}
