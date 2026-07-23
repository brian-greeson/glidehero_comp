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
    classList: { add: vi.fn() },
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
  const selectors = new Map([
    ['[data-upload-trigger]', element()], ['[data-upload-close]', element()],
    ['[data-upload-dialog]', element()], ['[data-upload-list]', element()], ['[data-upload-overall]', element()],
    ['[data-upload-failures]', element()], ['[data-upload-progress-state]', element()],
    ['[data-processing-state]', element()], ['[data-flight-progress-bar]', element()],
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
    location: { reload: vi.fn() },
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
    selectors, uploadInput: uploadMoreInput, uploadMoreInput, timers, windowRef,
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

  // it('opens status without activating the file picker and refreshes progress', async () => {
  //   const harness = uploadHarness(0, async (url, options, fallback) => {
  //     if (String(url) === '/v1/igc-upload-progress') {
  //       return { ok: true, json: async () => ({ total: 4, finished: 1, queued: 2, processing: 1, failed: 0 }) };
  //     }
  //     return fallback(url, options);
  //   });

  //   harness.selectors.get('[data-upload-trigger]').dispatch('click');

  //   expect(harness.selectors.get('[data-upload-dialog]').open).toBe(true);
  //   await vi.waitFor(() => expect(harness.selectors.get('[data-flight-progress-count]').textContent).toBe('1/4'));
  //   expect(harness.uploadMoreInput.files).toBeUndefined();
  //   expect(harness.selectors.get('[data-flight-progress-bar]').max).toBe(4);
  //   expect(harness.selectors.get('[data-flight-progress-bar]').value).toBe(1);
  //   expect(harness.selectors.get('[data-upload-trigger]').textContent).toBe('Upload Status');
  //   await vi.waitFor(() => expect(harness.timers.some((timer) => timer.delay === 10_000)).toBe(true));
  // });

  // it('stops aggregate polling when the upload modal closes', async () => {
  //   const harness = uploadHarness(2);
  //   harness.selectors.get('[data-upload-trigger]').dispatch('click');
  //   await vi.waitFor(() => expect(harness.timers.some((timer) => timer.delay === 10_000)).toBe(true));

  //   harness.selectors.get('[data-upload-close]').dispatch('click');

  //   expect(harness.selectors.get('[data-upload-dialog]').open).toBe(false);
  //   expect(harness.timers.some((timer) => timer.delay === 10_000)).toBe(false);
  // });

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

  // it('changes the trigger text as server work starts and finishes', async () => {
  //   const harness = uploadHarness(3);
  //   harness.selectors.get('[data-upload-trigger]').dispatch('click');
  //   await vi.waitFor(() => expect(harness.selectors.get('[data-upload-trigger]').textContent).toBe('Upload Status'));

  //   harness.setProgressTotal(0);
  //   harness.timers.find((timer) => timer.delay === 10_000)();
  //   await vi.waitFor(() => expect(harness.selectors.get('[data-upload-trigger]').textContent).toBe('Upload'));
  // });

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
    await vi.waitFor(() => expect(harness.selectors.get('[data-upload-overall]').textContent).toBe('0/1'));
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
    await vi.waitFor(() => expect(harness.selectors.get('[data-upload-overall]').textContent).toBe('0/700'));
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

    await vi.waitFor(() => expect(harness.selectors.get('[data-upload-overall]').textContent).toBe('0/1000'));
    expect(harness.windowRef.alert).not.toHaveBeenCalled();
  });

  it('allows exactly 700 current files when 300 prior uploads are active', async () => {
    const harness = uploadHarness(300);

    harness.select(harness.uploadInput, files(700));
    harness.select(harness.uploadMoreInput, files(1, 'over-limit'));

    await vi.waitFor(() => expect(harness.selectors.get('[data-upload-overall]').textContent).toBe('0/700'));
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
    await vi.waitFor(() => expect(harness.selectors.get('[data-upload-overall]').textContent).toBe('1/600'));
    harness.select(harness.uploadMoreInput, files(50, 'remaining'));
    harness.select(harness.uploadMoreInput, files(1, 'external-over-limit'));

    await vi.waitFor(() => expect(harness.selectors.get('[data-upload-overall]').textContent).toBe('1/650'));
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
    await vi.waitFor(() => expect(harness.selectors.get('[data-upload-overall]').textContent).toBe('1/600'));
    harness.setProgressTotal(353);
    harness.timers.shift()();
    await vi.waitFor(() => expect(harness.timers).toHaveLength(1));
    harness.select(harness.uploadMoreInput, files(51, 'remaining'));
    harness.select(harness.uploadMoreInput, files(1, 'over-limit'));

    await vi.waitFor(() => expect(harness.selectors.get('[data-upload-overall]').textContent).toBe('1/651'));
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
    await vi.waitFor(() => expect(harness.selectors.get('[data-upload-overall]').textContent).toBe('1/2'));
    harness.select(harness.uploadMoreInput, files(1, 'replacement'));

    await vi.waitFor(() => expect(harness.selectors.get('[data-upload-overall]').textContent).toBe('1/3'));
    expect(harness.windowRef.alert).not.toHaveBeenCalled();
  });

  it('releases capacity only after cancellation of a failed object upload succeeds', async () => {
    const harness = uploadHarness(998);

    harness.select(harness.uploadInput, files(2, 'cancelled'));
    await vi.waitFor(() => expect(harness.xhr.instances).toHaveLength(2));
    harness.xhr.instances[0].fail();
    await vi.waitFor(() => expect(harness.selectors.get('[data-upload-overall]').textContent).toBe('1/2'));
    harness.select(harness.uploadMoreInput, files(1, 'replacement'));

    await vi.waitFor(() => expect(harness.selectors.get('[data-upload-overall]').textContent).toBe('1/3'));
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
    await vi.waitFor(() => expect(harness.selectors.get('[data-upload-overall]').textContent).toBe('1/2'));
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
    await vi.waitFor(() => expect(harness.selectors.get('[data-upload-overall]').textContent).toBe('1/2'));
    harness.select(harness.uploadMoreInput, files(1, 'must-reject'));

    await vi.waitFor(() => expect(harness.windowRef.alert).toHaveBeenCalledWith('You can have at most 1000 active flight uploads.'));
  });

  it('reserves rapid Upload more selections synchronously near the limit', async () => {
    const harness = uploadHarness(990);

    harness.select(harness.uploadInput, files(6, 'first'));
    harness.select(harness.uploadMoreInput, files(4, 'second'));
    harness.select(harness.uploadMoreInput, files(1, 'too-many'));

    await vi.waitFor(() => expect(harness.selectors.get('[data-upload-overall]').textContent).toBe('0/10'));
    expect(harness.windowRef.alert).toHaveBeenCalledTimes(1);
    expect(harness.windowRef.alert).toHaveBeenCalledWith('You can have at most 1000 active flight uploads.');
  });

  // it('releases local capacity after an authoritative poll retires completed uploads', async () => {
  //   const harness = uploadHarness(999);

  //   harness.select(harness.uploadInput, files(1, 'last-slot'));
  //   await vi.waitFor(() => expect(harness.xhr.instances).toHaveLength(1));
  //   harness.xhr.instances[0].succeed();
  //   await vi.waitFor(() => expect(harness.selectors.get('[data-upload-overall]').textContent).toBe('1/1'));

  //   harness.setProgressTotal(0);
  //   harness.timers.find((timer) => timer.delay === 10_000)();
  //   await vi.waitFor(() => expect(harness.selectors.get('[data-upload-trigger]').textContent).toBe('Upload'));
  //   harness.select(harness.uploadMoreInput, files(2, 'new-batch'));

  //   await vi.waitFor(() => expect(harness.selectors.get('[data-upload-list]').append).toHaveBeenCalledTimes(3));
  //   expect(harness.windowRef.alert).not.toHaveBeenCalled();
  // });

  it('keeps the modal open after successful uploads and accepts more files without reloading', async () => {
    const harness = uploadHarness(0);

    harness.select(harness.uploadInput, files(1, 'first'));
    await vi.waitFor(() => expect(harness.xhr.instances).toHaveLength(1));
    harness.xhr.instances[0].succeed();
    await vi.waitFor(() => expect(harness.selectors.get('[data-upload-overall]').textContent).toBe('1/1'));
    expect(harness.selectors.get('[data-upload-dialog]').open).toBe(true);
    expect(harness.timers.some((timer) => timer.delay === 500)).toBe(false);
    expect(harness.windowRef.location.reload).not.toHaveBeenCalled();

    harness.select(harness.uploadMoreInput, files(1, 'second'));

    await vi.waitFor(() => expect(harness.xhr.instances).toHaveLength(2));
    harness.xhr.instances[1].succeed();
    await vi.waitFor(() => expect(harness.selectors.get('[data-upload-overall]').textContent).toBe('2/2'));
    expect(harness.selectors.get('[data-upload-dialog]').open).toBe(true);
    expect(harness.timers.some((timer) => timer.delay === 500)).toBe(false);
    expect(harness.windowRef.location.reload).not.toHaveBeenCalled();
  });

  it('uses one file-count bar and replaces it with processing state after all attempts finish', async () => {
    const harness = uploadHarness(0);
    const bar = harness.selectors.get('[data-flight-progress-bar]');
    const uploadState = harness.selectors.get('[data-upload-progress-state]');
    const processingState = harness.selectors.get('[data-processing-state]');

    harness.select(harness.uploadInput, files(2, 'batch'));
    await vi.waitFor(() => expect(harness.xhr.instances).toHaveLength(2));
    expect(harness.selectors.get('[data-upload-overall]').textContent).toBe('0/2');
    expect(bar.max).toBe(2);
    expect(bar.value).toBe(0);
    expect(uploadState.hidden).toBe(false);
    expect(processingState.hidden).toBe(true);
    expect(harness.selectors.get('[data-upload-list]').append).not.toHaveBeenCalled();

    harness.xhr.instances[0].succeed();
    await vi.waitFor(() => expect(harness.selectors.get('[data-upload-overall]').textContent).toBe('1/2'));
    expect(bar.value).toBe(1);
    expect(uploadState.hidden).toBe(false);

    harness.xhr.instances[1].succeed();
    await vi.waitFor(() => expect(harness.selectors.get('[data-upload-overall]').textContent).toBe('2/2'));
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
    expect(harness.selectors.get('[data-upload-overall]').textContent).toBe('0/1');
  });

  it('lists only failed browser uploads below the aggregate status', async () => {
    const harness = uploadHarness(0);
    const failedList = harness.selectors.get('[data-upload-list]');
    const failures = harness.selectors.get('[data-upload-failures]');

    harness.select(harness.uploadInput, files(2, 'mixed'));
    await vi.waitFor(() => expect(harness.xhr.instances).toHaveLength(2));
    harness.xhr.instances[0].succeed();
    harness.xhr.instances[1].fail();

    await vi.waitFor(() => expect(harness.selectors.get('[data-upload-overall]').textContent).toBe('2/2'));
    expect(failedList.append).toHaveBeenCalledOnce();
    expect(failedList.append.mock.calls[0][0].textContent).toBe('mixed-1.igc: Object upload failed.');
    expect(failures.hidden).toBe(false);
    expect(harness.selectors.get('[data-processing-state]').hidden).toBe(false);
  });

  it('keeps the upload modal open when an upload fails', async () => {
    const harness = uploadHarness(0);

    harness.select(harness.uploadInput, files(1, 'failed'));
    await vi.waitFor(() => expect(harness.xhr.instances).toHaveLength(1));
    harness.xhr.instances[0].fail();

    await vi.waitFor(() => expect(harness.selectors.get('[data-upload-overall]').textContent).toBe('1/1'));
    expect(harness.selectors.get('[data-upload-dialog]').open).toBe(true);
    expect(harness.timers.some((timer) => timer.delay === 500)).toBe(false);
    expect(harness.windowRef.location.reload).not.toHaveBeenCalled();
  });
});

describe('flight ZIP uploads', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('leaves mobile file selection unfiltered so standalone IGC files remain selectable', () => {
    const template = readFileSync(
      new URL('../../src/views/authenticated/components/flightUploadDialog.vto', import.meta.url),
      'utf8',
    );

    expect(template).toContain('data-upload-more-input type="file" multiple');
    expect(template).not.toContain('accept=');
  });

  it('rejects unsupported files after selection', async () => {
    const harness = uploadHarness(0);

    harness.select(harness.uploadInput, [
      { name: 'notes.txt', size: 1_024, type: 'text/plain' },
    ]);

    await vi.waitFor(() => expect(harness.windowRef.alert).toHaveBeenCalledWith(
      'Only non-empty .igc files of 10 MB or less and .zip archives can be uploaded.',
    ));
    expect(harness.xhr.instances).toHaveLength(0);
  });

  it('expands ZIP entries and uploads each IGC through the existing intent flow', async () => {
    const harness = uploadHarness(0);
    const archive = createZipFile([
      { name: 'first.igc', contents: 'first flight', compression: 'stored' },
      { name: 'folder/second.IGC', contents: 'second flight', compression: 'deflated' },
      { name: 'notes.txt', contents: 'ignore me' },
    ]);

    harness.select(harness.uploadInput, [archive]);

    await vi.waitFor(() => expect(harness.xhr.instances).toHaveLength(2));
    const intentBodies = fetch.mock.calls
      .filter(([url]) => String(url) === '/v1/igc-uploads/intents')
      .map(([, options]) => JSON.parse(options.body));
    expect(intentBodies).toEqual([
      expect.objectContaining({ originalFilename: 'first.igc', byteSize: 12 }),
      expect.objectContaining({ originalFilename: 'second.IGC', byteSize: 13 }),
    ]);
    expect(harness.selectors.get('[data-upload-overall]').textContent).toBe('0/2');
    expect(harness.windowRef.alert).toHaveBeenCalledWith('flights.zip: skipped 1 non-IGC file.');
  });

  it('uploads direct IGC files and ZIP entries selected together', async () => {
    const harness = uploadHarness(0);
    const archive = createZipFile([{ name: 'archived.igc', contents: 'archive flight' }]);

    harness.select(harness.uploadInput, [files(1, 'direct')[0], archive]);

    await vi.waitFor(() => expect(harness.xhr.instances).toHaveLength(2));
    const names = fetch.mock.calls
      .filter(([url]) => String(url) === '/v1/igc-uploads/intents')
      .map(([, options]) => JSON.parse(options.body).originalFilename);
    expect(names).toEqual(['direct-0.igc', 'archived.igc']);
  });

  it('applies active-flight capacity to the number of extracted IGC files', async () => {
    const harness = uploadHarness(999);
    const archive = createZipFile([
      { name: 'one.igc', contents: 'one' },
      { name: 'two.igc', contents: 'two' },
    ]);

    harness.select(harness.uploadInput, [archive]);

    await vi.waitFor(() => expect(harness.windowRef.alert).toHaveBeenCalledWith('You can have at most 1000 active flight uploads.'));
    expect(harness.xhr.instances).toHaveLength(0);
    expect(harness.selectors.get('[data-upload-list]').append).not.toHaveBeenCalled();
  });

  it('keeps the modal open and reports a corrupt ZIP without creating uploads', async () => {
    const harness = uploadHarness(0);
    const archive = new File(['not a zip'], 'broken.zip', { type: 'application/zip' });

    harness.select(harness.uploadInput, [archive]);

    await vi.waitFor(() => expect(harness.windowRef.alert).toHaveBeenCalledWith(expect.stringContaining('broken.zip: This is not a valid ZIP archive.')));
    expect(harness.selectors.get('[data-upload-dialog]').open).toBe(true);
    expect(harness.xhr.instances).toHaveLength(0);
  });
});
