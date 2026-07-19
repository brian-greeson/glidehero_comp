// @ts-nocheck Browser behavior is exercised with a deliberately minimal DOM test double.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { initializeFlightUploads } from '../../public/scripts/flightUploads.js';

function element() {
  const listeners = new Map();
  return {
    hidden: false,
    open: false,
    disabled: false,
    textContent: '',
    className: '',
    classList: { add: vi.fn() },
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
    ['[data-flight-progress-bar]', element()], ['[data-flight-progress-count]', element()],
  ]);
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
      return { ok: true, json: async () => ({ total: progressTotal, finished: 0, queued: progressTotal, processing: 0, failed: 0 }) };
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
    send() {}
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

  it('loads aggregate processing status while the upload modal is closed', async () => {
    const harness = uploadHarness(0);

    expect(harness.selectors.get('[data-upload-dialog]').open).toBe(false);
    await vi.waitFor(() => expect(fetch.mock.calls.filter(([url]) => String(url) === '/v1/igc-upload-progress')).toHaveLength(1));
    await vi.waitFor(() => expect(harness.timers.some((timer) => timer.delay === 10_000)).toBe(true));
  });

  it('opens status without activating the file picker and refreshes progress', async () => {
    const harness = uploadHarness(0, async (url, options, fallback) => {
      if (String(url) === '/v1/igc-upload-progress') {
        return { ok: true, json: async () => ({ total: 4, finished: 1, queued: 2, processing: 1, failed: 0 }) };
      }
      return fallback(url, options);
    });

    harness.selectors.get('[data-upload-trigger]').dispatch('click');

    expect(harness.selectors.get('[data-upload-dialog]').open).toBe(true);
    await vi.waitFor(() => expect(harness.selectors.get('[data-flight-progress-count]').textContent).toBe('1/4'));
    expect(harness.uploadMoreInput.files).toBeUndefined();
    expect(harness.selectors.get('[data-flight-progress-bar]').max).toBe(4);
    expect(harness.selectors.get('[data-flight-progress-bar]').value).toBe(1);
    expect(harness.selectors.get('[data-upload-trigger]').textContent).toBe('Upload Status');
  });

  it('keeps aggregate polling active when the upload modal closes', async () => {
    const harness = uploadHarness(2);
    await vi.waitFor(() => expect(harness.timers.some((timer) => timer.delay === 10_000)).toBe(true));
    harness.selectors.get('[data-upload-trigger]').dispatch('click');

    harness.selectors.get('[data-upload-close]').dispatch('click');

    expect(harness.selectors.get('[data-upload-dialog]').open).toBe(false);
    await vi.waitFor(() => expect(harness.timers.filter((timer) => timer.delay === 10_000)).toHaveLength(1));
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

  it('changes the trigger text as server work starts and finishes', async () => {
    const harness = uploadHarness(3);
    await vi.waitFor(() => expect(harness.selectors.get('[data-upload-trigger]').textContent).toBe('Upload Status'));

    harness.setProgressTotal(0);
    harness.timers.find((timer) => timer.delay === 10_000)();
    await vi.waitFor(() => expect(harness.selectors.get('[data-upload-trigger]').textContent).toBe('Upload'));
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
    expect(harness.selectors.get('[data-upload-trigger]').textContent).toBe('Upload Status');

    harness.xhr.instances[0].succeed();
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledWith('/v1/igc-uploads/intent-1/complete', expect.objectContaining({ method: 'POST' })));
    await vi.waitFor(() => expect(harness.timers.some((timer) => timer.delay === 500)).toBe(true));
  });
});

describe('flight upload active-file capacity', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('waits through a failed progress poll and admits selections only after a successful retry', async () => {
    let progressAttempts = 0;
    const harness = uploadHarness(0, async (url, options, fallback) => {
      if (String(url) === '/v1/igc-upload-progress') {
        progressAttempts += 1;
        if (progressAttempts <= 2) return { ok: false, json: async () => ({ error: { message: 'Unavailable.' } }) };
      }
      return fallback(url, options);
    });
    harness.select(harness.uploadInput, files(1, 'waiting'));
    await vi.waitFor(() => expect(harness.timers).toHaveLength(1));
    await Promise.resolve();
    expect(harness.selectors.get('[data-upload-list]').append).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalledWith('/v1/igc-uploads/intents', expect.anything());

    harness.timers.shift()();
    await vi.waitFor(() => expect(harness.selectors.get('[data-upload-list]').append).toHaveBeenCalledOnce());
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledWith('/v1/igc-uploads/intents', expect.objectContaining({ method: 'POST' })));
    expect(progressAttempts).toBe(3);
  });

  it('waits for the first authoritative total before admitting a selection', async () => {
    let resolveProgress;
    const progressResponse = new Promise((resolve) => { resolveProgress = resolve; });
    const harness = uploadHarness(0, (url, options, fallback) => (
      String(url) === '/v1/igc-upload-progress' ? progressResponse : fallback(url, options)
    ));

    harness.select(harness.uploadInput, files(700, 'initial-race'));
    expect(harness.selectors.get('[data-upload-list]').append).not.toHaveBeenCalled();
    resolveProgress({ ok: true, json: async () => ({ total: 300, finished: 0, queued: 300, processing: 0, failed: 0 }) });
    await vi.waitFor(() => expect(harness.selectors.get('[data-upload-list]').append).toHaveBeenCalledTimes(700));
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

    await vi.waitFor(() => expect(harness.selectors.get('[data-upload-list]').append).toHaveBeenCalledTimes(1_000));
    expect(harness.windowRef.alert).not.toHaveBeenCalled();
  });

  it('allows exactly 700 current files when 300 prior uploads are active', async () => {
    const harness = uploadHarness(300);

    harness.select(harness.uploadInput, files(700));
    harness.select(harness.uploadMoreInput, files(1, 'over-limit'));

    await vi.waitFor(() => expect(harness.selectors.get('[data-upload-list]').append).toHaveBeenCalledTimes(700));
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

    await vi.waitFor(() => expect(harness.selectors.get('[data-upload-list]').append).toHaveBeenCalledTimes(650));
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

    await vi.waitFor(() => expect(harness.selectors.get('[data-upload-list]').append).toHaveBeenCalledTimes(651));
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

    await vi.waitFor(() => expect(harness.selectors.get('[data-upload-list]').append).toHaveBeenCalledTimes(3));
    expect(harness.windowRef.alert).not.toHaveBeenCalled();
  });

  it('releases capacity only after cancellation of a failed object upload succeeds', async () => {
    const harness = uploadHarness(998);

    harness.select(harness.uploadInput, files(2, 'cancelled'));
    await vi.waitFor(() => expect(harness.xhr.instances).toHaveLength(2));
    harness.xhr.instances[0].fail();
    await vi.waitFor(() => expect(harness.selectors.get('[data-upload-overall]').textContent).toBe('1/2'));
    harness.select(harness.uploadMoreInput, files(1, 'replacement'));

    await vi.waitFor(() => expect(harness.selectors.get('[data-upload-list]').append).toHaveBeenCalledTimes(3));
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

    expect(harness.selectors.get('[data-upload-list]').append).toHaveBeenCalledTimes(2);
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

    expect(harness.selectors.get('[data-upload-list]').append).toHaveBeenCalledTimes(2);
    await vi.waitFor(() => expect(harness.windowRef.alert).toHaveBeenCalledWith('You can have at most 1000 active flight uploads.'));
  });

  it('reserves rapid Upload more selections synchronously near the limit', async () => {
    const harness = uploadHarness(990);

    harness.select(harness.uploadInput, files(6, 'first'));
    harness.select(harness.uploadMoreInput, files(4, 'second'));
    harness.select(harness.uploadMoreInput, files(1, 'too-many'));

    await vi.waitFor(() => expect(harness.selectors.get('[data-upload-list]').append).toHaveBeenCalledTimes(10));
    expect(harness.windowRef.alert).toHaveBeenCalledTimes(1);
    expect(harness.windowRef.alert).toHaveBeenCalledWith('You can have at most 1000 active flight uploads.');
  });

  it('cancels a pending handoff reload when more files are accepted', async () => {
    const harness = uploadHarness(0);

    harness.select(harness.uploadInput, files(1, 'first'));
    await vi.waitFor(() => expect(harness.xhr.instances).toHaveLength(1));
    harness.xhr.instances[0].succeed();
    await vi.waitFor(() => expect(harness.timers.some((timer) => timer.delay === 500)).toBe(true));
    harness.select(harness.uploadMoreInput, files(1, 'second'));

    await vi.waitFor(() => expect(harness.timers.some((timer) => timer.delay === 500)).toBe(false));
    expect(harness.windowRef.location.reload).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(harness.xhr.instances).toHaveLength(2));
    harness.xhr.instances[1].succeed();
    await vi.waitFor(() => expect(harness.timers.some((timer) => timer.delay === 500)).toBe(true));
    harness.timers.find((timer) => timer.delay === 500)();
    expect(harness.windowRef.location.reload).toHaveBeenCalledOnce();
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
