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
    dispatch(type) { listeners.get(type)?.(); },
    showModal() { this.open = true; },
    close() { this.open = false; },
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
  const uploadInput = element();
  const uploadMoreInput = element();
  const selectors = new Map([
    ['[data-upload-dialog]', element()], ['[data-upload-list]', element()], ['[data-upload-overall]', element()],
    ['[data-flight-progress-trigger]', element()], ['[data-flight-progress-bar]', element()], ['[data-flight-progress-count]', element()],
    ['[data-flight-progress-dialog]', element()], ['[data-flight-progress-list]', element()],
    ['[data-flight-progress-previous]', element()], ['[data-flight-progress-next]', element()], ['[data-flight-progress-page]', element()],
    ['[data-flight-progress-close]', element()], ['[data-clear-failed]', element()],
  ]);
  const documentRef = {
    querySelector: (selector) => selectors.get(selector) ?? null,
    querySelectorAll: () => [uploadInput, uploadMoreInput],
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
    selectors, uploadInput, uploadMoreInput, timers, windowRef,
    xhr: PendingXMLHttpRequest,
    setProgressTotal(total) { progressTotal = total; },
    select(input, selectedFiles) { input.files = selectedFiles; input.dispatch('change'); },
  };
}

describe('flight upload progress UI', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('loads no job rows while closed and refreshes the current page on each poll while open', async () => {
    const selectors = new Map([
      ['[data-upload-dialog]', element()],
      ['[data-upload-list]', element()],
      ['[data-upload-overall]', element()],
      ['[data-flight-progress-trigger]', element()],
      ['[data-flight-progress-bar]', element()],
      ['[data-flight-progress-count]', element()],
      ['[data-flight-progress-dialog]', element()],
      ['[data-flight-progress-list]', element()],
      ['[data-flight-progress-previous]', element()],
      ['[data-flight-progress-next]', element()],
      ['[data-flight-progress-page]', element()],
      ['[data-flight-progress-close]', element()],
      ['[data-clear-failed]', element()],
    ]);
    const documentRef = {
      querySelector: (selector) => selectors.get(selector) ?? null,
      querySelectorAll: () => [],
      createElement: () => element(),
    };
    const timers = [];
    const windowRef = { setTimeout(callback) { timers.push(callback); }, location: { reload: vi.fn() }, alert: vi.fn() };
    const requests = [];
    vi.stubGlobal('fetch', vi.fn(async (url) => {
      requests.push(String(url));
      const page = Number(new URL(String(url), 'https://example.test').searchParams.get('page') ?? 1);
      const body = String(url).startsWith('/v1/igc-upload-jobs')
        ? { total: 150, page, pageSize: 100, jobs: [{ id: '1', originalFilename: 'one.igc', status: 'processing' }] }
        : { total: 150, finished: 1, queued: 149, processing: 1, failed: 0 };
      return { ok: true, json: async () => body };
    }));

    initializeFlightUploads(documentRef, windowRef);
    await vi.waitFor(() => expect(requests).toEqual(['/v1/igc-upload-progress']));
    await vi.waitFor(() => expect(timers).toHaveLength(1));
    selectors.get('[data-flight-progress-trigger]').dispatch('click');
    await vi.waitFor(() => expect(requests.filter((url) => url.startsWith('/v1/igc-upload-jobs'))).toHaveLength(1));
    await vi.waitFor(() => expect(selectors.get('[data-flight-progress-page]').textContent).toBe('Page 1 of 2'));
    selectors.get('[data-flight-progress-next]').dispatch('click');
    selectors.get('[data-flight-progress-next]').dispatch('click');
    await vi.waitFor(() => expect(requests.filter((url) => url.startsWith('/v1/igc-upload-jobs'))).toHaveLength(2));

    timers.shift()();
    await vi.waitFor(() => expect(requests.filter((url) => url.startsWith('/v1/igc-upload-jobs'))).toHaveLength(3));
    expect(requests.filter((url) => url.startsWith('/v1/igc-upload-jobs'))).toEqual([
      '/v1/igc-upload-jobs?page=1',
      '/v1/igc-upload-jobs?page=2',
      '/v1/igc-upload-jobs?page=2',
    ]);
    expect(selectors.get('[data-flight-progress-list]').replaceChildren).toHaveBeenCalledTimes(3);
  });

  it('ignores an older detail response that arrives after the selected page', async () => {
    const selectors = new Map([
      ['[data-upload-dialog]', element()],
      ['[data-upload-list]', element()],
      ['[data-upload-overall]', element()],
      ['[data-flight-progress-trigger]', element()],
      ['[data-flight-progress-bar]', element()],
      ['[data-flight-progress-count]', element()],
      ['[data-flight-progress-dialog]', element()],
      ['[data-flight-progress-list]', element()],
      ['[data-flight-progress-previous]', element()],
      ['[data-flight-progress-next]', element()],
      ['[data-flight-progress-page]', element()],
      ['[data-flight-progress-close]', element()],
      ['[data-clear-failed]', element()],
    ]);
    const documentRef = {
      querySelector: (selector) => selectors.get(selector) ?? null,
      querySelectorAll: () => [],
      createElement: () => element(),
    };
    const timers = [];
    const windowRef = { setTimeout(callback) { timers.push(callback); }, location: { reload: vi.fn() }, alert: vi.fn() };
    let resolveOldPageOne;
    const oldPageOne = new Promise((resolve) => { resolveOldPageOne = resolve; });
    let pageOneRequests = 0;
    vi.stubGlobal('fetch', vi.fn(async (url) => {
      const requestUrl = String(url);
      if (requestUrl === '/v1/igc-upload-progress') {
        return { ok: true, json: async () => ({ total: 150, finished: 0, queued: 150, processing: 0, failed: 0 }) };
      }
      if (requestUrl.endsWith('page=1')) {
        pageOneRequests += 1;
        if (pageOneRequests === 1) {
          return { ok: true, json: async () => ({ total: 150, page: 1, pageSize: 100, jobs: [] }) };
        }
        return oldPageOne;
      }
      return { ok: true, json: async () => ({ total: 150, page: 2, pageSize: 100, jobs: [{ id: '2', originalFilename: 'newer.igc', status: 'queued' }] }) };
    }));

    initializeFlightUploads(documentRef, windowRef);
    await vi.waitFor(() => expect(timers).toHaveLength(1));
    selectors.get('[data-flight-progress-trigger]').dispatch('click');
    await vi.waitFor(() => expect(selectors.get('[data-flight-progress-page]').textContent).toBe('Page 1 of 2'));
    timers.shift()();
    await vi.waitFor(() => expect(pageOneRequests).toBe(2));
    selectors.get('[data-flight-progress-next]').dispatch('click');
    await vi.waitFor(() => expect(selectors.get('[data-flight-progress-page]').textContent).toBe('Page 2 of 2'));

    resolveOldPageOne({ ok: true, json: async () => ({ total: 150, page: 1, pageSize: 100, jobs: [{ id: '1', originalFilename: 'older.igc', status: 'processing' }] }) });
    await Promise.resolve();
    await Promise.resolve();
    expect(selectors.get('[data-flight-progress-page]').textContent).toBe('Page 2 of 2');
    expect(selectors.get('[data-flight-progress-list]').replaceChildren).toHaveBeenCalledTimes(2);
  });

  it('refreshes the requested page while navigation is still in flight', async () => {
    const selectors = new Map([
      ['[data-upload-dialog]', element()],
      ['[data-upload-list]', element()],
      ['[data-upload-overall]', element()],
      ['[data-flight-progress-trigger]', element()],
      ['[data-flight-progress-bar]', element()],
      ['[data-flight-progress-count]', element()],
      ['[data-flight-progress-dialog]', element()],
      ['[data-flight-progress-list]', element()],
      ['[data-flight-progress-previous]', element()],
      ['[data-flight-progress-next]', element()],
      ['[data-flight-progress-page]', element()],
      ['[data-flight-progress-close]', element()],
      ['[data-clear-failed]', element()],
    ]);
    const documentRef = {
      querySelector: (selector) => selectors.get(selector) ?? null,
      querySelectorAll: () => [],
      createElement: () => element(),
    };
    const timers = [];
    const windowRef = { setTimeout(callback) { timers.push(callback); }, location: { reload: vi.fn() }, alert: vi.fn() };
    const detailRequests = [];
    let resolveNavigation;
    const navigationResponse = new Promise((resolve) => { resolveNavigation = resolve; });
    let pageTwoRequests = 0;
    vi.stubGlobal('fetch', vi.fn(async (url) => {
      const requestUrl = String(url);
      if (requestUrl === '/v1/igc-upload-progress') {
        return { ok: true, json: async () => ({ total: 150, finished: 0, queued: 150, processing: 0, failed: 0 }) };
      }
      detailRequests.push(requestUrl);
      if (requestUrl.endsWith('page=1')) {
        return { ok: true, json: async () => ({ total: 150, page: 1, pageSize: 100, jobs: [] }) };
      }
      pageTwoRequests += 1;
      if (pageTwoRequests === 1) return navigationResponse;
      return { ok: true, json: async () => ({ total: 150, page: 2, pageSize: 100, jobs: [] }) };
    }));

    initializeFlightUploads(documentRef, windowRef);
    await vi.waitFor(() => expect(timers).toHaveLength(1));
    selectors.get('[data-flight-progress-trigger]').dispatch('click');
    await vi.waitFor(() => expect(selectors.get('[data-flight-progress-page]').textContent).toBe('Page 1 of 2'));
    selectors.get('[data-flight-progress-next]').dispatch('click');
    timers.shift()();

    await vi.waitFor(() => expect(detailRequests).toEqual([
      '/v1/igc-upload-jobs?page=1',
      '/v1/igc-upload-jobs?page=2',
      '/v1/igc-upload-jobs?page=2',
    ]));
    await vi.waitFor(() => expect(selectors.get('[data-flight-progress-page]').textContent).toBe('Page 2 of 2'));
    resolveNavigation({ ok: true, json: async () => ({ total: 150, page: 2, pageSize: 100, jobs: [] }) });
    await Promise.resolve();
    await Promise.resolve();
    expect(selectors.get('[data-flight-progress-page]').textContent).toBe('Page 2 of 2');
  });

  it('returns to the last available page when the workload shrinks', async () => {
    const selectors = new Map([
      ['[data-upload-dialog]', element()], ['[data-upload-list]', element()], ['[data-upload-overall]', element()],
      ['[data-flight-progress-trigger]', element()], ['[data-flight-progress-bar]', element()], ['[data-flight-progress-count]', element()],
      ['[data-flight-progress-dialog]', element()], ['[data-flight-progress-list]', element()],
      ['[data-flight-progress-previous]', element()], ['[data-flight-progress-next]', element()], ['[data-flight-progress-page]', element()],
      ['[data-flight-progress-close]', element()], ['[data-clear-failed]', element()],
    ]);
    const documentRef = {
      querySelector: (selector) => selectors.get(selector) ?? null,
      querySelectorAll: () => [],
      createElement: () => element(),
    };
    const timers = [];
    const windowRef = { setTimeout(callback) { timers.push(callback); }, location: { reload: vi.fn() }, alert: vi.fn() };
    const detailRequests = [];
    let pageTwoRequests = 0;
    vi.stubGlobal('fetch', vi.fn(async (url) => {
      const requestUrl = String(url);
      if (requestUrl === '/v1/igc-upload-progress') {
        return { ok: true, json: async () => ({ total: 150, finished: 0, queued: 150, processing: 0, failed: 0 }) };
      }
      detailRequests.push(requestUrl);
      if (requestUrl.endsWith('page=1')) {
        return { ok: true, json: async () => ({ total: 150, page: 1, pageSize: 100, jobs: [] }) };
      }
      pageTwoRequests += 1;
      return pageTwoRequests === 1
        ? { ok: true, json: async () => ({ total: 150, page: 2, pageSize: 100, jobs: [] }) }
        : { ok: true, json: async () => ({ total: 50, page: 1, pageSize: 100, jobs: [] }) };
    }));

    initializeFlightUploads(documentRef, windowRef);
    await vi.waitFor(() => expect(timers).toHaveLength(1));
    selectors.get('[data-flight-progress-trigger]').dispatch('click');
    await vi.waitFor(() => expect(selectors.get('[data-flight-progress-page]').textContent).toBe('Page 1 of 2'));
    selectors.get('[data-flight-progress-next]').dispatch('click');
    await vi.waitFor(() => expect(selectors.get('[data-flight-progress-page]').textContent).toBe('Page 2 of 2'));
    timers.shift()();
    await vi.waitFor(() => expect(selectors.get('[data-flight-progress-page]').textContent).toBe('Page 1 of 1'));
    expect(selectors.get('[data-flight-progress-next]').disabled).toBe(true);
    selectors.get('[data-flight-progress-next]').dispatch('click');
    expect(detailRequests).toEqual([
      '/v1/igc-upload-jobs?page=1',
      '/v1/igc-upload-jobs?page=2',
      '/v1/igc-upload-jobs?page=2',
    ]);
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
    await vi.waitFor(() => expect(harness.timers).toHaveLength(1));

    harness.select(harness.uploadInput, files(1, 'waiting'));
    await Promise.resolve();
    expect(harness.selectors.get('[data-upload-list]').append).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalledWith('/v1/igc-uploads/intents', expect.anything());

    harness.timers.shift()();
    await vi.waitFor(() => expect(harness.selectors.get('[data-upload-list]').append).toHaveBeenCalledOnce());
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
    expect(harness.selectors.get('[data-upload-list]').append).not.toHaveBeenCalled();
    resolveProgress({ ok: true, json: async () => ({ total: 300, finished: 0, queued: 300, processing: 0, failed: 0 }) });
    await vi.waitFor(() => expect(harness.selectors.get('[data-upload-list]').append).toHaveBeenCalledTimes(700));
    harness.select(harness.uploadMoreInput, files(1, 'over-limit'));
    await vi.waitFor(() => expect(harness.windowRef.alert).toHaveBeenCalledWith('You can have at most 1000 active flight uploads.'));
  });

  it('allows 600 selected files followed by 400 more when polling sees their four prepared intents', async () => {
    const harness = uploadHarness(0);
    await vi.waitFor(() => expect(harness.timers).toHaveLength(1));

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
    await vi.waitFor(() => expect(harness.timers).toHaveLength(1));

    harness.select(harness.uploadInput, files(700));
    harness.select(harness.uploadMoreInput, files(1, 'over-limit'));

    await vi.waitFor(() => expect(harness.selectors.get('[data-upload-list]').append).toHaveBeenCalledTimes(700));
    expect(harness.windowRef.alert).toHaveBeenCalledWith('You can have at most 1000 active flight uploads.');
  });

  it('accounts for other-tab growth reported after the modal opens', async () => {
    const harness = uploadHarness(300);
    await vi.waitFor(() => expect(harness.timers).toHaveLength(1));

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
    await vi.waitFor(() => expect(harness.timers).toHaveLength(1));
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
    await vi.waitFor(() => expect(harness.timers).toHaveLength(1));

    harness.select(harness.uploadInput, files(2, 'rejected'));
    await vi.waitFor(() => expect(harness.selectors.get('[data-upload-overall]').textContent).toBe('1/2'));
    harness.select(harness.uploadMoreInput, files(1, 'replacement'));

    await vi.waitFor(() => expect(harness.selectors.get('[data-upload-list]').append).toHaveBeenCalledTimes(3));
    expect(harness.windowRef.alert).not.toHaveBeenCalled();
  });

  it('releases capacity only after cancellation of a failed object upload succeeds', async () => {
    const harness = uploadHarness(998);
    await vi.waitFor(() => expect(harness.timers).toHaveLength(1));

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
    await vi.waitFor(() => expect(harness.timers).toHaveLength(1));

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
    await vi.waitFor(() => expect(harness.timers).toHaveLength(1));

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
    await vi.waitFor(() => expect(harness.timers).toHaveLength(1));

    harness.select(harness.uploadInput, files(6, 'first'));
    harness.select(harness.uploadMoreInput, files(4, 'second'));
    harness.select(harness.uploadMoreInput, files(1, 'too-many'));

    await vi.waitFor(() => expect(harness.selectors.get('[data-upload-list]').append).toHaveBeenCalledTimes(10));
    expect(harness.windowRef.alert).toHaveBeenCalledTimes(1);
    expect(harness.windowRef.alert).toHaveBeenCalledWith('You can have at most 1000 active flight uploads.');
  });

  it('cancels a pending handoff reload when more files are accepted', async () => {
    const harness = uploadHarness(0);
    await vi.waitFor(() => expect(harness.timers).toHaveLength(1));

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
});
