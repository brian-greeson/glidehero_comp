import { extractIgcFilesFromZip } from './zipIgcFiles.js';

const MAX_ACTIVE_FILES = 1_000;
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const CONCURRENCY = 4;
const PROGRESS_POLL_INTERVAL_MS = 5_000;
const SUCCESS_REDIRECT_DELAY_MS = 3_000;

function putFile(url, file) {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open('PUT', url);
    request.setRequestHeader('Content-Type', file.type || 'application/octet-stream');
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
  const primaryUploadTrigger = documentRef.querySelector('[data-upload-trigger]');
  const uploadTriggers = [primaryUploadTrigger, ...documentRef.querySelectorAll('[data-upload-trigger][data-upload-mode]')]
    .filter((trigger, index, all) => trigger && all.indexOf(trigger) === index && (trigger === primaryUploadTrigger || trigger.dataset?.uploadMode));
  const uploadDialog = documentRef.querySelector('[data-upload-dialog]');
  const uploadClose = documentRef.querySelector('[data-upload-close]');
  const uploadList = documentRef.querySelector('[data-upload-list]');
  const uploadFailures = documentRef.querySelector('[data-upload-failures]');
  const uploadProgressState = documentRef.querySelector('[data-upload-progress-state]');
  const uploadMessage = documentRef.querySelector('[data-upload-message]');
  const processingState = documentRef.querySelector('[data-processing-state]');
  const processingMessage = documentRef.querySelector('[data-processing-message]');
  const overall = documentRef.querySelector('[data-upload-overall]');
  const progressBar = documentRef.querySelector('[data-flight-progress-bar]');
  const dropzone = documentRef.querySelector('[data-upload-dropzone]');
  const bulkInput = documentRef.querySelector('[data-upload-bulk-input]');
  const bulkCancel = documentRef.querySelector('[data-upload-bulk-cancel]');
  if (!windowRef || uploadTriggers.length === 0 || !uploadDialog || !uploadList || !uploadFailures || !uploadProgressState || !uploadMessage || !processingState || !processingMessage || !overall || !progressBar) return;
  const inputs = [...documentRef.querySelectorAll('[data-upload-more-input]')];

  const pending = [];
  let running = 0;
  let settled = 0;
  let selected = 0;
  let failed = 0;
  let serverTotal = 0;
  let serverFinished = 0;
  let serverWorkActive = false;
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
  let successRedirectTimer = null;
  const workflows = new Set();
  let hasBulkWorkflow = false;
  let activeBulkWorkflow = null;

  function updateUploadTrigger() {
    const localWorkActive = selected > settled || currentReservations.size > 0;
    for (const trigger of uploadTriggers) {
      if (!trigger.dataset?.uploadMode) trigger.textContent = localWorkActive || serverTotal > serverFinished ? 'Upload Status' : 'Upload';
    }
  }

  function updateOverall() {
    overall.textContent = `${settled} of ${selected} ${selected === 1 ? 'file' : 'files'} uploaded`;
    if (selected > 0) {
      uploadMessage.textContent = `Uploading ${selected} IGC ${selected === 1 ? 'file' : 'files'}.`;
    }
    progressBar.max = Math.max(selected, 1);
    progressBar.value = settled;
    const localUploadsActive = selected > settled;
    const localUploadsSuccessful = selected > 0
      && settled === selected
      && failed === 0
      && running === 0
      && pending.length === 0;
    const bulkActive = [...workflows].some((workflow) => workflow.kind === 'bulk' && !workflow.sealed);
    const processing = !localUploadsActive && failed === 0 && (serverWorkActive || localUploadsSuccessful);
    uploadProgressState.hidden = processing;
    processingState.hidden = !processing;
    processingMessage.textContent = localUploadsSuccessful
      ? 'Upload successful, this dialog will close in 3 seconds.'
      : 'Flights are processing in the background.';
    if (localUploadsSuccessful && !bulkActive && !hasBulkWorkflow && successRedirectTimer === null) {
      successRedirectTimer = windowRef.setTimeout(() => {
        successRedirectTimer = null;
        if (uploadDialog.open) uploadDialog.close();
        windowRef.location.assign('/activity');
      }, SUCCESS_REDIRECT_DELAY_MS);
    }
    updateUploadTrigger();
  }

  function appendFailedUpload(file, error) {
    const item = documentRef.createElement('li');
    item.textContent = `${file.name}: ${error instanceof Error ? error.message : 'Upload failed.'}`;
    uploadList.append(item);
    uploadFailures.hidden = false;
  }

  async function upload(item) {
    const metadata = { originalFilename: item.file.name, contentType: item.file.type || 'application/octet-stream', byteSize: item.file.size };
    if (item.workflow.kind === 'regular') metadata.batchId = item.workflow.id;
    else metadata.historyImportId = item.workflow.id;
    const intent = await jsonRequest('/v1/igc-uploads/intents', {
      method: 'POST',
      body: JSON.stringify(metadata),
    });
    item.intentId = intent.id;
    currentIntentIds.add(intent.id);
    await putFile(intent.uploadUrl, item.file);
    await jsonRequest(`/v1/igc-uploads/${intent.id}/complete`, { method: 'POST', body: '{}' });
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
        appendFailedUpload(item.file, error);
        await releaseFailedUpload(item);
      }).finally(() => {
        running -= 1;
        settled += 1;
        item.workflow.settled += 1;
        updateOverall();
        void sealWorkflow(item.workflow);
        pump();
      });
    }
  }

  async function createWorkflow(kind) {
    const endpoint = kind === 'regular' ? '/v1/flight-upload-batches' : '/v1/flight-history-imports';
    const body = kind === 'regular' ? { kind: 'regular' } : {};
    const result = await jsonRequest(endpoint, { method: 'POST', body: JSON.stringify(body) });
    const workflow = { kind, id: result.id, total: 0, settled: 0, sealed: false };
    if (kind === 'bulk') hasBulkWorkflow = true;
    workflows.add(workflow);
    return workflow;
  }

  async function sealWorkflow(workflow) {
    if (!workflow || workflow.sealed || workflow.total === 0 || workflow.settled < workflow.total) return;
    workflow.sealed = true;
    const endpoint = workflow.kind === 'regular'
      ? `/v1/flight-upload-batches/${workflow.id}/seal`
      : `/v1/flight-history-imports/${workflow.id}/seal`;
    try {
      await jsonRequest(endpoint, { method: 'POST', body: '{}' });
      if (workflow.kind === 'bulk') {
        activeBulkWorkflow = null;
        if (bulkCancel) bulkCancel.hidden = true;
      }
    } catch (error) {
      workflow.sealed = false;
      appendFailedUpload({ name: workflow.kind === 'bulk' ? 'Bulk import' : 'Regular upload' }, error);
    }
    updateOverall();
  }

  async function addFiles(valid, kind = 'regular') {
    if (modalServerBaseline === null) modalServerBaseline = serverTotal;
    const accountedTotal = Math.max(serverTotal, modalServerBaseline + observedExternalGrowth + currentReservations.size);
    if (valid.length > MAX_ACTIVE_FILES - accountedTotal) {
      windowRef.alert(`You can have at most ${MAX_ACTIVE_FILES} active flight uploads.`);
      return;
    }
    if (successRedirectTimer !== null) {
      windowRef.clearTimeout?.(successRedirectTimer);
      successRedirectTimer = null;
    }
    const items = valid.map((file) => ({ file, workflow: null }));
    for (const item of items) {
      currentReservations.add(item);
    }
    selected += valid.length;
    updateOverall();
    let workflow;
    try {
      workflow = await createWorkflow(kind);
    } catch (error) {
      appendFailedUpload({ name: kind === 'bulk' ? 'Bulk import' : 'Regular upload' }, error);
      for (const item of items) {
        const index = pending.indexOf(item);
        if (index >= 0) pending.splice(index, 1);
        currentReservations.delete(item);
      }
      settled += items.length;
      failed += items.length;
      updateOverall();
      return;
    }
    workflow.total = valid.length;
    for (const item of items) item.workflow = workflow;
    pending.push(...items);
    if (kind === 'bulk') {
      activeBulkWorkflow = workflow;
      if (bulkCancel) bulkCancel.hidden = false;
    }
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
      serverWorkActive = Number(progress.queued) > 0 || Number(progress.processing) > 0;
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
      updateOverall();
      if (!initialProgressResolved) {
        initialProgressResolved = true;
        resolveInitialProgress();
      }
    } catch (error) {
      console.error('Unable to load flight progress', error);
    }
    if (requestId === progressRequestId && uploadDialog.open) scheduleProgressPoll();
  }

  function openUploadDialog(mode = 'recent') {
    if (uploadDialog.dataset) uploadDialog.dataset.uploadMode = mode;
    else uploadDialog.setAttribute?.('data-upload-mode', mode);
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

  async function prepareFiles(files, mode = 'regular') {
    const prepared = [];
    const messages = [];
    let invalidFiles = 0;
    for (const file of files) {
      const lowerName = file.name.toLowerCase();
      if (mode === 'regular' && lowerName.endsWith('.igc')) {
        if (file.size > 0 && file.size <= MAX_FILE_BYTES) prepared.push(file);
        else invalidFiles += 1;
        continue;
      }
      if (mode === 'regular' || !lowerName.endsWith('.zip')) {
        invalidFiles += 1;
        continue;
      }
      try {
        const extracted = await extractIgcFilesFromZip(file, { maxEntryBytes: MAX_FILE_BYTES });
        prepared.push(...extracted.files);
      } catch (error) {
        messages.push(`${file.name}: ${error instanceof Error ? error.message : 'The ZIP archive could not be opened.'}`);
      }
    }
    if (invalidFiles > 0) messages.unshift(mode === 'regular' ? 'Only non-empty .igc files of 10 MB or less can be uploaded here.' : 'Choose exactly one ZIP archive.');
    return { prepared, messages };
  }

  for (const trigger of uploadTriggers) {
    trigger.addEventListener('click', () => openUploadDialog(trigger.dataset?.uploadMode || 'recent'));
  }
  bulkCancel?.addEventListener('click', async () => {
    if (!activeBulkWorkflow) return;
    const workflow = activeBulkWorkflow;
    // Fence local completion callbacks before waiting for the server so the
    // final upload cannot start sealing while cancellation is in flight.
    workflow.sealed = true;
    try {
      await jsonRequest(`/v1/flight-history-imports/${workflow.id}`, { method: 'DELETE' });
      activeBulkWorkflow = null;
      bulkCancel.hidden = true;
    } catch (error) {
      workflow.sealed = false;
      appendFailedUpload({ name: 'Bulk import' }, error);
    }
  });
  uploadClose?.addEventListener('click', closeUploadDialog);
  uploadDialog.addEventListener('close', stopProgressPolling);
  uploadDialog.addEventListener('cancel', (event) => {
    event.preventDefault();
    closeUploadDialog();
  });
  uploadDialog.addEventListener('click', (event) => {
    if (event.target === uploadDialog) closeUploadDialog();
  });

  function handleRegularFiles(files) {
    if (!files.length) return;
    if (!uploadDialog.open) openUploadDialog();
    void prepareFiles(files, 'regular').then(async ({ prepared, messages }) => {
      if (messages.length) windowRef.alert(messages.join('\n'));
      if (!prepared.length) return;
      await initialProgress;
      await addFiles(prepared, 'regular');
    });
  }

  for (const input of inputs) input.addEventListener('change', () => {
    const files = [...input.files];
    input.value = '';
    handleRegularFiles(files);
  });

  dropzone?.addEventListener('dragenter', (event) => {
    event.preventDefault();
    dropzone.classList.add('is-dragging');
  });
  dropzone?.addEventListener('dragover', (event) => {
    event.preventDefault();
    dropzone.classList.add('is-dragging');
  });
  dropzone?.addEventListener('dragleave', () => dropzone.classList.remove('is-dragging'));
  dropzone?.addEventListener('drop', (event) => {
    event.preventDefault();
    dropzone.classList.remove('is-dragging');
    handleRegularFiles([...(event.dataTransfer?.files || [])]);
  });

  bulkInput?.addEventListener('change', () => {
    const files = [...(bulkInput.files || [])];
    bulkInput.value = '';
    if (files.length !== 1 || !files[0].name.toLowerCase().endsWith('.zip')) {
      windowRef.alert('Choose exactly one ZIP archive for a bulk historical upload.');
      return;
    }
    if (!uploadDialog.open) openUploadDialog();
    void prepareFiles(files, 'bulk').then(async ({ prepared, messages }) => {
      if (messages.length) windowRef.alert(messages.join('\n'));
      if (!prepared.length) return;
      await initialProgress;
      await addFiles(prepared, 'bulk');
    });
  });
}
