// @ts-nocheck Browser behavior is exercised with a deliberately minimal DOM test double.
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { initializeFlightUploads } from '../../public/scripts/flightUploads.js';
import { createZipFile } from '../helpers/createZipFile.js';

function element() {
  const listeners = new Map();
  const attributes = new Map();
  return {
    hidden: false,
    open: false,
    disabled: false,
    textContent: '',
    className: '',
    classList: { add: vi.fn(), remove: vi.fn() },
    setAttribute(name, value) { attributes.set(name, value); if (name === 'hidden') this.hidden = true; },
    getAttribute(name) { return attributes.get(name) ?? null; },
    addEventListener(type, listener) { listeners.set(type, listener); },
    dispatch(type, event = {}) {
      const dispatchedEvent = { target: this, preventDefault: vi.fn(), ...event };
      listeners.get(type)?.(dispatchedEvent);
      return dispatchedEvent;
    },
    showModal() { this.open = true; },
    close() { this.open = false; this.dispatch('close'); },
    append: vi.fn(),
    replaceChildren: vi.fn(),
  };
}

function files(count, prefix = 'flight') {
  return Array.from({ length: count }, (_, index) => ({
    name: `${prefix}-${index}.igc`,
    size: 1_024,
    type: 'application/octet-stream',
  }));
}

function uploadHarness(initialTotal, fetchImplementation) {
  const uploadMoreInput = element();
  const bulkInput = element();
  const selectors = new Map([
    ['[data-upload-trigger]', element()], ['[data-upload-close]', element()],
    ['[data-upload-dialog]', element()], ['[data-upload-list]', element()], ['[data-upload-overall]', element()],
    ['[data-upload-failures]', element()], ['[data-upload-progress-state]', element()],
    ['[data-upload-message]', element()],
    ['[data-processing-state]', element()], ['[data-processing-message]', element()],
    ['[data-flight-progress-bar]', element()],
    ['[data-upload-dropzone]', element()],
    ['[data-upload-bulk-input]', bulkInput],
    ['[data-upload-bulk-cancel]', element()],
  ]);
  selectors.get('[data-upload-failures]').hidden = true;
  selectors.get('[data-processing-state]').hidden = true;
  const documentRef = {
    querySelector: (selector) => selectors.get(selector) ?? null,
    querySelectorAll: () => [uploadMoreInput],
    createElement: () => element(),
  };
  const timers = [];
  const windowRef = {
    setTimeout(callback, delay) { callback.delay = delay; timers.push(callback); return callback; },
    clearTimeout(timer) { const index = timers.indexOf(timer); if (index >= 0) timers.splice(index, 1); },
    location: { assign: vi.fn(), reload: vi.fn() },
    alert: vi.fn(),
  };
  let progressTotal = initialTotal;
  let nextIntentId = 1;
  const defaultFetch = async (url, options = {}) => {
    if (String(url) === '/v1/igc-upload-progress') {
      return { ok: true, json: async () => ({ total: progressTotal, finished: 0, completed: 0, completedIds: [], queued: progressTotal, processing: 0, failed: 0 }) };
    }
    if (String(url) === '/v1/igc-uploads/intents') {
      const id = `intent-${nextIntentId++}`;
      return { ok: true, json: async () => ({ id, uploadUrl: `https://uploads.test/${id}` }) };
    }
    if (String(url) === '/v1/flight-upload-batches' || String(url) === '/v1/flight-history-imports') {
      return { ok: true, json: async () => ({ id: String(url).includes('history') ? 'history-1' : 'batch-1' }) };
    }
    if (options.method === 'DELETE') return { ok: true, json: async () => ({ removed: true }) };
    return { ok: true, json: async () => ({}) };
  };
  vi.stubGlobal('fetch', vi.fn((url, options) => fetchImplementation?.(url, options, defaultFetch) ?? defaultFetch(url, options)));

  class PendingXMLHttpRequest {
    static instances = [];
    listeners = new Map();
    upload = { addEventListener: vi.fn() };
    status = 0;
    constructor() { PendingXMLHttpRequest.instances.push(this); }
    open() {}
    setRequestHeader() {}
    addEventListener(type, listener) { this.listeners.set(type, listener); }
    send(file) { this.file = file; }
    fail() { this.listeners.get('error')?.(); }
    succeed() { this.status = 200; this.listeners.get('load')?.(); }
  }
  vi.stubGlobal('XMLHttpRequest', PendingXMLHttpRequest);
  initializeFlightUploads(documentRef, windowRef);

  return {
    selectors, uploadInput: uploadMoreInput, uploadMoreInput, bulkInput, timers, windowRef,
    xhr: PendingXMLHttpRequest,
    setProgressTotal(total) { progressTotal = total; },
    select(input, selectedFiles) { input.files = selectedFiles; input.dispatch('change'); },
  };
}

describe('flight upload progress UI', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('does not poll for processing status while the upload modal is closed', () => {
    const harness = uploadHarness(0);

    expect(harness.selectors.get('[data-upload-dialog]').open).toBe(false);
    expect(fetch).not.toHaveBeenCalledWith('/v1/igc-upload-progress', expect.anything());
    expect(harness.timers).toHaveLength(0);
  });

  it('checks status once without polling when the open modal has no active work', async () => {
    const harness = uploadHarness(0);

    harness.selectors.get('[data-upload-trigger]').dispatch('click');

    expect(harness.selectors.get('[data-upload-dialog]').open).toBe(true);
    await vi.waitFor(() => expect(fetch.mock.calls.filter(([url]) => String(url) === '/v1/igc-upload-progress')).toHaveLength(1));
    await vi.waitFor(() => expect(harness.timers).toHaveLength(0));
    expect(harness.uploadMoreInput.files).toBeUndefined();
  });

  it('polls while server work is active and stops when it finishes', async () => {
    const harness = uploadHarness(2);
    harness.selectors.get('[data-upload-trigger]').dispatch('click');
    await vi.waitFor(() => expect(harness.timers.some((timer) => timer.delay === 5_000)).toBe(true));

    harness.setProgressTotal(0);
    harness.timers.splice(harness.timers.findIndex((timer) => timer.delay === 5_000), 1)[0]();

    await vi.waitFor(() => expect(harness.selectors.get('[data-upload-trigger]').textContent).toBe('Upload'));
    expect(harness.timers.some((timer) => timer.delay === 5_000)).toBe(false);
  });

  it('stops aggregate polling when the upload modal closes', async () => {
    const harness = uploadHarness(2);
    harness.selectors.get('[data-upload-trigger]').dispatch('click');
    await vi.waitFor(() => expect(harness.timers.some((timer) => timer.delay === 5_000)).toBe(true));

    harness.selectors.get('[data-upload-close]').dispatch('click');

    expect(harness.selectors.get('[data-upload-dialog]').open).toBe(false);
    expect(harness.timers.some((timer) => timer.delay === 5_000)).toBe(false);
  });

  it('dismisses on Escape and backdrop clicks but ignores panel clicks', async () => {
    const harness = uploadHarness(0);
    const dialog = harness.selectors.get('[data-upload-dialog]');
    harness.selectors.get('[data-upload-trigger]').dispatch('click');

    dialog.dispatch('click', { target: element() });
    expect(dialog.open).toBe(true);

    const cancelEvent = dialog.dispatch('cancel');
    expect(cancelEvent.preventDefault).toHaveBeenCalledOnce();
    expect(dialog.open).toBe(false);

    harness.selectors.get('[data-upload-trigger]').dispatch('click');
    dialog.dispatch('click');
    expect(dialog.open).toBe(false);
  });

  it('does not strand a selection when the modal closes before initial progress resolves', async () => {
    let resolveProgress;
    const progressResponse = new Promise((resolve) => { resolveProgress = resolve; });
    const harness = uploadHarness(0, (url, options, fallback) => (
      String(url) === '/v1/igc-upload-progress' ? progressResponse : fallback(url, options)
    ));
    const dialog = harness.selectors.get('[data-upload-dialog]');

    harness.selectors.get('[data-upload-trigger]').dispatch('click');
    harness.select(harness.uploadMoreInput, files(1, 'dismissed'));
    harness.selectors.get('[data-upload-close]').dispatch('click');
    expect(dialog.open).toBe(false);

    resolveProgress({ ok: true, json: async () => ({ total: 0, finished: 0, queued: 0, processing: 0, failed: 0 }) });
    await vi.waitFor(() => expect(harness.xhr.instances).toHaveLength(1));
    expect(dialog.open).toBe(false);
    expect(harness.timers.some((timer) => timer.delay === 10_000)).toBe(false);
    expect(harness.selectors.get('[data-upload-trigger]').textContent).toBe('Upload Status');

    harness.xhr.instances[0].succeed();
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledWith('/v1/igc-uploads/intent-1/complete', expect.objectContaining({ method: 'POST' })));
    expect(harness.timers.some((timer) => timer.delay === 500)).toBe(false);
    expect(harness.windowRef.location.reload).not.toHaveBeenCalled();
  });
});

describe('flight upload active-file capacity', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('refreshes an idle modal again before admitting a new selection', async () => {
    let progressBodyRead = false;
    const harness = uploadHarness(0, async (url, options, fallback) => {
      if (String(url) !== '/v1/igc-upload-progress') return fallback(url, options);
      const response = await fallback(url, options);
      return {
        ...response,
        json: async () => {
          const body = await response.json();
          progressBodyRead = true;
          return body;
        },
      };
    });
    harness.selectors.get('[data-upload-trigger]').dispatch('click');
    await vi.waitFor(() => expect(progressBodyRead).toBe(true));
    await Promise.resolve();
    await Promise.resolve();
    expect(harness.timers).toHaveLength(0);

    harness.setProgressTotal(1_000);
    harness.select(harness.uploadInput, files(1, 'over-limit'));

    await vi.waitFor(() => expect(fetch.mock.calls.filter(([url]) => String(url) === '/v1/igc-upload-progress')).toHaveLength(2));
    await vi.waitFor(() => expect(harness.windowRef.alert).toHaveBeenCalledWith('You can have at most 1000 active flight uploads.'));
    expect(fetch).not.toHaveBeenCalledWith('/v1/igc-uploads/intents', expect.anything());
  });

  it('waits through a failed progress poll and admits selections only after a successful retry', async () => {
    let progressAttempts = 0;
    const harness = uploadHarness(0, async (url, options, fallback) => {
      if (String(url) === '/v1/igc-upload-progress') {
        progressAttempts += 1;
        if (progressAttempts === 1) return { ok: false, json: async () => ({ error: { message: 'Unavailable.' } }) };
      }
      return fallback(url, options);
    });
    harness.select(harness.uploadInput, files(1, 'waiting'));
    await vi.waitFor(() => expect(harness.timers).toHaveLength(1));
    await Promise.resolve();
    expect(fetch).not.toHaveBeenCalledWith('/v1/igc-uploads/intents', expect.anything());

    harness.timers.shift()();
    await vi.waitFor(() => expect(harness.selectors.get('[data-upload-overall]').textContent).toBe('0 of 1 file uploaded'));
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledWith('/v1/igc-uploads/intents', expect.objectContaining({ method: 'POST' })));
    expect(progressAttempts).toBe(2);
  });

  it('waits for the first authoritative total before admitting a selection', async () => {
    let resolveProgress;
    const progressResponse = new Promise((resolve) => { resolveProgress = resolve; });
    const harness = uploadHarness(0, (url, options, fallback) => (
      String(url) === '/v1/igc-upload-progress' ? progressResponse : fallback(url, options)
    ));

    harness.select(harness.uploadInput, files(700, 'initial-race'));
    resolveProgress({ ok: true, json: async () => ({ total: 300, finished: 0, queued: 300, processing: 0, failed: 0 }) });
    await vi.waitFor(() => expect(harness.selectors.get('[data-upload-overall]').textContent).toBe('0 of 700 files uploaded'));
    harness.select(harness.uploadMoreInput, files(1, 'over-limit'));
    await vi.waitFor(() => expect(harness.windowRef.alert).toHaveBeenCalledWith('You can have at most 1000 active flight uploads.'));
  });

  it('allows 600 selected files followed by 400 more when polling sees their four prepared intents', async () => {
    const harness = uploadHarness(0);

    harness.select(harness.uploadInput, files(600, 'first'));
    await vi.waitFor(() => expect(harness.xhr.instances).toHaveLength(4));
    harness.setProgressTotal(4);
    harness.timers.shift()();
    await vi.waitFor(() => expect(harness.timers).toHaveLength(1));
    harness.select(harness.uploadMoreInput, files(400, 'more'));

    await vi.waitFor(() => expect(harness.selectors.get('[data-upload-overall]').textContent).toBe('0 of 1000 files uploaded'));
    expect(harness.windowRef.alert).not.toHaveBeenCalled();
  });

  it('allows exactly 700 current files when 300 prior uploads are active', async () => {
    const harness = uploadHarness(300);

    harness.select(harness.uploadInput, files(700));
    harness.select(harness.uploadMoreInput, files(1, 'over-limit'));

    await vi.waitFor(() => expect(harness.selectors.get('[data-upload-overall]').textContent).toBe('0 of 700 files uploaded'));
    expect(harness.windowRef.alert).toHaveBeenCalledWith('You can have at most 1000 active flight uploads.');
  });

  it('accounts for other-tab growth reported after the modal opens', async () => {
    const harness = uploadHarness(300);

    harness.select(harness.uploadInput, files(600, 'current'));
    await vi.waitFor(() => expect(harness.xhr.instances).toHaveLength(4));
    harness.setProgressTotal(354);
    harness.timers.shift()();
    await vi.waitFor(() => expect(harness.timers).toHaveLength(1));
    harness.xhr.instances[0].succeed();
    await vi.waitFor(() => expect(harness.selectors.get('[data-upload-overall]').textContent).toBe('1 of 600 files uploaded'));
    harness.select(harness.uploadMoreInput, files(50, 'remaining'));
    harness.select(harness.uploadMoreInput, files(1, 'external-over-limit'));

    await vi.waitFor(() => expect(harness.selectors.get('[data-upload-overall]').textContent).toBe('1 of 650 files uploaded'));
    expect(harness.windowRef.alert).toHaveBeenCalledTimes(1);
  });

  it('retains observed external growth after a represented current intent is cancelled', async () => {
    const harness = uploadHarness(300);
    harness.select(harness.uploadInput, files(600, 'current'));
    await vi.waitFor(() => expect(harness.xhr.instances).toHaveLength(4));
    harness.setProgressTotal(354);
    harness.timers.shift()();
    await vi.waitFor(() => expect(harness.timers).toHaveLength(1));

    harness.xhr.instances[0].fail();
    await vi.waitFor(() => expect(harness.selectors.get('[data-upload-overall]').textContent).toBe('1 of 600 files uploaded'));
    harness.setProgressTotal(353);
    harness.timers.shift()();
    await vi.waitFor(() => expect(harness.timers).toHaveLength(1));
    harness.select(harness.uploadMoreInput, files(51, 'remaining'));
    harness.select(harness.uploadMoreInput, files(1, 'over-limit'));

    await vi.waitFor(() => expect(harness.selectors.get('[data-upload-overall]').textContent).toBe('1 of 651 files uploaded'));
    expect(harness.windowRef.alert).toHaveBeenCalledTimes(1);
  });

  it('releases capacity when intent creation is rejected', async () => {
    let rejectNextIntent = true;
    const harness = uploadHarness(998, async (url, options, fallback) => {
      if (String(url) === '/v1/igc-uploads/intents' && rejectNextIntent) {
        rejectNextIntent = false;
        return { ok: false, json: async () => ({ error: { message: 'Intent rejected.' } }) };
      }
      return fallback(url, options);
    });
    harness.select(harness.uploadInput, files(2, 'rejected'));
    await vi.waitFor(() => expect(harness.selectors.get('[data-upload-overall]').textContent).toBe('1 of 2 files uploaded'));
    harness.select(harness.uploadMoreInput, files(1, 'replacement'));

    await vi.waitFor(() => expect(harness.selectors.get('[data-upload-overall]').textContent).toBe('1 of 3 files uploaded'));
    expect(harness.windowRef.alert).not.toHaveBeenCalled();
  });

  it('releases capacity only after cancellation of a failed object upload succeeds', async () => {
    const harness = uploadHarness(998);

    harness.select(harness.uploadInput, files(2, 'cancelled'));
    await vi.waitFor(() => expect(harness.xhr.instances).toHaveLength(2));
    harness.xhr.instances[0].fail();
    await vi.waitFor(() => expect(harness.selectors.get('[data-upload-overall]').textContent).toBe('1 of 2 files uploaded'));
    harness.select(harness.uploadMoreInput, files(1, 'replacement'));

    await vi.waitFor(() => expect(harness.selectors.get('[data-upload-overall]').textContent).toBe('1 of 3 files uploaded'));
    expect(harness.windowRef.alert).not.toHaveBeenCalled();
  });

  it('keeps the reservation when cancellation loses to completion', async () => {
    const harness = uploadHarness(998, async (url, options, fallback) => {
      if (options?.method === 'DELETE') return { ok: true, json: async () => ({ removed: false }) };
      return fallback(url, options);
    });
    harness.select(harness.uploadInput, files(2, 'lost-cancel'));
    await vi.waitFor(() => expect(harness.xhr.instances).toHaveLength(2));
    harness.xhr.instances[0].fail();
    await vi.waitFor(() => expect(harness.selectors.get('[data-upload-overall]').textContent).toBe('1 of 2 files uploaded'));
    harness.select(harness.uploadMoreInput, files(1, 'must-reject'));

    await vi.waitFor(() => expect(harness.windowRef.alert).toHaveBeenCalledWith('You can have at most 1000 active flight uploads.'));
  });

  it('keeps the reservation when the cancellation request fails', async () => {
    const harness = uploadHarness(998, async (url, options, fallback) => {
      if (options?.method === 'DELETE') return { ok: false, json: async () => ({ error: { message: 'Cancellation failed.' } }) };
      return fallback(url, options);
    });
    harness.select(harness.uploadInput, files(2, 'failed-cancel'));
    await vi.waitFor(() => expect(harness.xhr.instances).toHaveLength(2));
    harness.xhr.instances[0].fail();
    await vi.waitFor(() => expect(harness.selectors.get('[data-upload-overall]').textContent).toBe('1 of 2 files uploaded'));
    harness.select(harness.uploadMoreInput, files(1, 'must-reject'));

    await vi.waitFor(() => expect(harness.windowRef.alert).toHaveBeenCalledWith('You can have at most 1000 active flight uploads.'));
  });

  it('reserves rapid Upload more selections synchronously near the limit', async () => {
    const harness = uploadHarness(990);

    harness.select(harness.uploadInput, files(6, 'first'));
    harness.select(harness.uploadMoreInput, files(4, 'second'));
    harness.select(harness.uploadMoreInput, files(1, 'too-many'));

    await vi.waitFor(() => expect(harness.selectors.get('[data-upload-overall]').textContent).toBe('0 of 10 files uploaded'));
    expect(harness.windowRef.alert).toHaveBeenCalledTimes(1);
    expect(harness.windowRef.alert).toHaveBeenCalledWith('You can have at most 1000 active flight uploads.');
  });

  it('releases local capacity after an authoritative poll retires completed uploads', async () => {
    const harness = uploadHarness(999);

    harness.select(harness.uploadInput, files(1, 'last-slot'));
    await vi.waitFor(() => expect(harness.xhr.instances).toHaveLength(1));
    harness.xhr.instances[0].succeed();
    await vi.waitFor(() => expect(harness.selectors.get('[data-upload-overall]').textContent).toBe('1 of 1 file uploaded'));

    harness.setProgressTotal(0);
    await vi.waitFor(() => expect(harness.timers.some((timer) => timer.delay === 5_000)).toBe(true));
    harness.timers.splice(harness.timers.findIndex((timer) => timer.delay === 5_000), 1)[0]();
    await vi.waitFor(() => expect(harness.selectors.get('[data-upload-trigger]').textContent).toBe('Upload'));
    harness.select(harness.uploadMoreInput, files(2, 'new-batch'));

    await vi.waitFor(() => expect(harness.selectors.get('[data-upload-overall]').textContent).toBe('1 of 3 files uploaded'));
    expect(harness.windowRef.alert).not.toHaveBeenCalled();
  });

  it('redirects a successful upload batch to activity after three seconds', async () => {
    const harness = uploadHarness(0);

    harness.select(harness.uploadInput, files(1, 'first'));
    await vi.waitFor(() => expect(harness.xhr.instances).toHaveLength(1));
    harness.xhr.instances[0].succeed();
    await vi.waitFor(() => expect(harness.selectors.get('[data-upload-overall]').textContent).toBe('1 of 1 file uploaded'));
    expect(harness.selectors.get('[data-upload-dialog]').open).toBe(true);
    expect(harness.selectors.get('[data-processing-message]').textContent).toBe(
      'Upload successful, this dialog will close in 3 seconds.',
    );
    const redirectTimer = harness.timers.find((timer) => timer.delay === 3_000);
    expect(redirectTimer).toBeDefined();
    expect(harness.windowRef.location.assign).not.toHaveBeenCalled();

    redirectTimer();

    expect(harness.selectors.get('[data-upload-dialog]').open).toBe(false);
    expect(harness.windowRef.location.assign).toHaveBeenCalledWith('/activity');
  });

  it('uses one file-count bar and replaces it with processing state after all attempts finish', async () => {
    const harness = uploadHarness(0);
    const bar = harness.selectors.get('[data-flight-progress-bar]');
    const uploadState = harness.selectors.get('[data-upload-progress-state]');
    const processingState = harness.selectors.get('[data-processing-state]');

    harness.select(harness.uploadInput, files(2, 'batch'));
    await vi.waitFor(() => expect(harness.xhr.instances).toHaveLength(2));
    expect(harness.selectors.get('[data-upload-overall]').textContent).toBe('0 of 2 files uploaded');
    expect(bar.max).toBe(2);
    expect(bar.value).toBe(0);
    expect(uploadState.hidden).toBe(false);
    expect(processingState.hidden).toBe(true);
    expect(harness.selectors.get('[data-upload-list]').append).not.toHaveBeenCalled();

    harness.xhr.instances[0].succeed();
    await vi.waitFor(() => expect(harness.selectors.get('[data-upload-overall]').textContent).toBe('1 of 2 files uploaded'));
    expect(bar.value).toBe(1);
    expect(uploadState.hidden).toBe(false);

    harness.xhr.instances[1].succeed();
    await vi.waitFor(() => expect(harness.selectors.get('[data-upload-overall]').textContent).toBe('2 of 2 files uploaded'));
    expect(bar.value).toBe(2);
    expect(uploadState.hidden).toBe(true);
    expect(processingState.hidden).toBe(false);
  });

  it('shows the processing state when queued or processing server work exists', async () => {
    const harness = uploadHarness(2, async (url, options, fallback) => (
      String(url) === '/v1/igc-upload-progress'
        ? { ok: true, json: async () => ({ total: 2, finished: 0, queued: 1, processing: 1, failed: 0 }) }
        : fallback(url, options)
    ));

    harness.selectors.get('[data-upload-trigger]').dispatch('click');
    await vi.waitFor(() => expect(harness.selectors.get('[data-processing-state]').hidden).toBe(false));
    expect(harness.selectors.get('[data-upload-progress-state]').hidden).toBe(true);
    expect(harness.selectors.get('[data-processing-message]').textContent).toBe('Flights are processing in the background.');
  });

  it('shows a new local upload bar while older server work is processing', async () => {
    const harness = uploadHarness(1, async (url, options, fallback) => (
      String(url) === '/v1/igc-upload-progress'
        ? { ok: true, json: async () => ({ total: 1, finished: 0, queued: 1, processing: 0, failed: 0 }) }
        : fallback(url, options)
    ));
    harness.selectors.get('[data-upload-trigger]').dispatch('click');
    await vi.waitFor(() => expect(harness.selectors.get('[data-processing-state]').hidden).toBe(false));

    harness.select(harness.uploadInput, files(1, 'new'));
    await vi.waitFor(() => expect(harness.xhr.instances).toHaveLength(1));
    expect(harness.selectors.get('[data-upload-progress-state]').hidden).toBe(false);
    expect(harness.selectors.get('[data-processing-state]').hidden).toBe(true);
    expect(harness.selectors.get('[data-upload-overall]').textContent).toBe('0 of 1 file uploaded');
  });

  it('lists only failed browser uploads below the aggregate status', async () => {
    const harness = uploadHarness(0);
    const failedList = harness.selectors.get('[data-upload-list]');
    const failures = harness.selectors.get('[data-upload-failures]');

    harness.select(harness.uploadInput, files(2, 'mixed'));
    await vi.waitFor(() => expect(harness.xhr.instances).toHaveLength(2));
    harness.xhr.instances[0].succeed();
    harness.xhr.instances[1].fail();

    await vi.waitFor(() => expect(harness.selectors.get('[data-upload-overall]').textContent).toBe('2 of 2 files uploaded'));
    expect(failedList.append).toHaveBeenCalledOnce();
    expect(failedList.append.mock.calls[0][0].textContent).toBe('mixed-1.igc: Object upload failed.');
    expect(failures.hidden).toBe(false);
    expect(harness.selectors.get('[data-processing-state]').hidden).toBe(true);
    expect(harness.timers.some((timer) => timer.delay === 3_000)).toBe(false);
  });

  it('keeps the upload modal open when an upload fails', async () => {
    const harness = uploadHarness(0);

    harness.select(harness.uploadInput, files(1, 'failed'));
    await vi.waitFor(() => expect(harness.xhr.instances).toHaveLength(1));
    harness.xhr.instances[0].fail();

    await vi.waitFor(() => expect(harness.selectors.get('[data-upload-overall]').textContent).toBe('1 of 1 file uploaded'));
    expect(harness.selectors.get('[data-upload-dialog]').open).toBe(true);
    expect(harness.timers.some((timer) => timer.delay === 3_000)).toBe(false);
    expect(harness.windowRef.location.assign).not.toHaveBeenCalled();
  });
});

describe('flight upload modes', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('leaves mobile file selection unfiltered so standalone IGC files remain selectable', () => {
    const template = readFileSync(
      new URL('../../src/views/authenticated/components/flightUploadDialog.vto', import.meta.url),
      'utf8',
    );

    expect(template).toContain('data-upload-more-input type="file" multiple');
    expect(template).not.toContain('accept=');
    expect(template).toContain('data-upload-dropzone');
    expect(template).toContain('<p class="flight-upload-bulk-help">Upload a ZIP of older IGC files.');
    expect(template).toContain('<label class="flight-upload-action flight-upload-action--secondary">Bulk historical upload<input data-upload-bulk-input type="file" aria-label="Bulk historical upload"></label>');
    expect(template).not.toContain('data-upload-bulk-trigger');
    expect(template).not.toContain('data-upload-bulk-panel hidden');
    expect(template).toContain('Upload successful, this dialog will close in 3 seconds.');
    expect(template).not.toContain('flight-processing-spinner');
  });

  it('rejects regular ZIP files after selection', async () => {
    const harness = uploadHarness(0);

    harness.select(harness.uploadInput, [
      { name: 'history.zip', size: 1_024, type: 'application/zip' },
    ]);

    await vi.waitFor(() => expect(harness.windowRef.alert).toHaveBeenCalledWith(
      'Only non-empty .igc files of 10 MB or less can be uploaded here.',
    ));
    expect(harness.xhr.instances).toHaveLength(0);
  });

  it('creates one regular batch and seals after multi-IGC uploads settle', async () => {
    const harness = uploadHarness(0);
    harness.select(harness.uploadInput, files(2, 'regular'));

    await vi.waitFor(() => expect(harness.xhr.instances).toHaveLength(2));
    const batchCalls = fetch.mock.calls.filter(([url]) => String(url) === '/v1/flight-upload-batches');
    expect(batchCalls).toHaveLength(1);
    expect(JSON.parse(batchCalls[0][1].body)).toEqual({ kind: 'regular' });
    const intentBodies = fetch.mock.calls
      .filter(([url]) => String(url) === '/v1/igc-uploads/intents')
      .map(([, options]) => JSON.parse(options.body));
    expect(intentBodies).toEqual([
      expect.objectContaining({ originalFilename: 'regular-0.igc', batchId: 'batch-1' }),
      expect.objectContaining({ originalFilename: 'regular-1.igc', batchId: 'batch-1' }),
    ]);
    harness.xhr.instances.forEach((request) => request.succeed());
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledWith('/v1/flight-upload-batches/batch-1/seal', expect.objectContaining({ method: 'POST' })));
  });

  it('accepts regular IGC files dropped onto the recent-flight upload area', async () => {
    const harness = uploadHarness(0);
    const dropzone = harness.selectors.get('[data-upload-dropzone]');
    const droppedFiles = files(2, 'dropped');

    const dragEvent = dropzone.dispatch('dragover');
    expect(dragEvent.preventDefault).toHaveBeenCalledOnce();
    expect(dropzone.classList.add).toHaveBeenCalledWith('is-dragging');

    const dropEvent = dropzone.dispatch('drop', { dataTransfer: { files: droppedFiles } });
    expect(dropEvent.preventDefault).toHaveBeenCalledOnce();
    expect(dropzone.classList.remove).toHaveBeenCalledWith('is-dragging');
    await vi.waitFor(() => expect(harness.xhr.instances).toHaveLength(2));
  });

  it('accepts one bulk ZIP, sends history IDs, and seals without redirecting', async () => {
    const harness = uploadHarness(0);
    const archive = createZipFile([
      { name: 'first.igc', contents: 'first flight', compression: 'stored' },
      { name: 'second.IGC', contents: 'second flight', compression: 'deflated' },
      { name: '__MACOSX/._first.igc', contents: 'metadata', compression: 'deflated' },
      { name: 'notes.txt', contents: 'not a flight' },
    ]);
    harness.select(harness.bulkInput, [archive]);
    await vi.waitFor(() => expect(harness.xhr.instances).toHaveLength(2));
    expect(harness.windowRef.alert).not.toHaveBeenCalled();
    expect(harness.selectors.get('[data-upload-message]').textContent).toBe('Uploading 2 IGC files.');
    expect(fetch).toHaveBeenCalledWith('/v1/flight-history-imports', expect.objectContaining({ method: 'POST' }));
    const intentBodies = fetch.mock.calls.filter(([url]) => String(url) === '/v1/igc-uploads/intents').map(([, options]) => JSON.parse(options.body));
    expect(intentBodies.every((body) => body.historyImportId === 'history-1')).toBe(true);
    harness.xhr.instances.forEach((request) => request.succeed());
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledWith('/v1/flight-history-imports/history-1/seal', expect.objectContaining({ method: 'POST' })));
    expect(harness.windowRef.location.assign).not.toHaveBeenCalled();
  });

  it('prevents the final bulk completion from sealing while cancellation is in flight', async () => {
    const cancellation = Promise.withResolvers<object>();
    const harness = uploadHarness(0, async (url, options, fallback) => {
      if (String(url) === '/v1/flight-history-imports/history-1' && options?.method === 'DELETE') {
        return cancellation.promise;
      }
      return fallback(url, options);
    });
    const archive = createZipFile([
      { name: 'first.igc', contents: 'first flight', compression: 'stored' },
      { name: 'second.igc', contents: 'second flight', compression: 'stored' },
    ]);
    harness.select(harness.bulkInput, [archive]);
    await vi.waitFor(() => expect(harness.xhr.instances).toHaveLength(2));

    harness.selectors.get('[data-upload-bulk-cancel]').dispatch('click');
    harness.xhr.instances.forEach((request) => request.succeed());
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledWith(
      '/v1/flight-history-imports/history-1',
      expect.objectContaining({ method: 'DELETE' }),
    ));
    await vi.waitFor(() => expect(fetch.mock.calls.filter(
      ([url]) => String(url).endsWith('/complete'),
    )).toHaveLength(2));
    expect(fetch).not.toHaveBeenCalledWith(
      '/v1/flight-history-imports/history-1/seal',
      expect.anything(),
    );

    cancellation.resolve({ ok: true, json: async () => ({ cancelled: true }) });
    await vi.waitFor(() => expect(harness.selectors.get('[data-upload-bulk-cancel]').hidden).toBe(true));
  });

  it('rejects non-ZIP and multiple bulk selections', async () => {
    const harness = uploadHarness(0);
    harness.select(harness.bulkInput, [{ name: 'notes.txt', size: 1_024, type: 'text/plain' }]);
    expect(harness.windowRef.alert).toHaveBeenCalledWith('Choose exactly one ZIP archive for a bulk historical upload.');
    harness.select(harness.bulkInput, [new File([''], 'a.zip'), new File([''], 'b.zip')]);
    expect(harness.windowRef.alert).toHaveBeenCalledTimes(2);
    expect(harness.xhr.instances).toHaveLength(0);
  });
});
