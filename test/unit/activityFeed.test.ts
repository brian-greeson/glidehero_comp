// @ts-nocheck Browser behavior is exercised with a deliberately small DOM double.
import { describe, expect, it, vi } from 'vitest';
import { initializeActivityFeed } from '../../public/scripts/activity.js';

class FakeElement {
  attributes = new Map();
  dataset = {};
  children = [];
  listeners = new Map();
  textContent = '';
  className = '';
  parent = null;
  action = '';
  disabled = false;
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  removeAttribute(name) { this.attributes.delete(name); }
  addEventListener(name, listener) { this.listeners.set(name, listener); }
  async click() { return this.listeners.get('click')?.({ currentTarget: this, preventDefault: vi.fn() }); }
  append(...items) { this.children.push(...items); for (const item of items) item.parent = this; }
  remove() { this.parent?.children.splice(this.parent.children.indexOf(this), 1); }
  replaceWith(item) {
    if (!this.parent) return;
    const index = this.parent.children.indexOf(this);
    this.parent.children.splice(index, 1, item);
    item.parent = this.parent;
  }
  querySelector(selector) {
    if (selector === '[data-activity-feed-list]') return this.children.find((child) => child.dataset.activityFeedList !== undefined) ?? null;
    if (selector === '[data-activity-load-more]') return this.children.find((child) => child.dataset.activityLoadMore !== undefined) ?? null;
    if (selector === '[data-activity-load-more-status]') return this.children.find((child) => child.dataset.activityLoadMoreStatus !== undefined) ?? null;
    if (selector === '[data-activity-empty]') return this.children.find((child) => child.dataset.activityEmpty !== undefined) ?? null;
    const key = selector.match(/^\[data-([a-z-]+)\]$/)?.[1]?.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
    if (key) {
      for (const child of this.children) {
        if (child.dataset[key] !== undefined) return child;
        const nested = child.querySelector?.(selector);
        if (nested) return nested;
      }
    }
    return null;
  }
  closest(selector) { return selector === '[data-thermal-form]' && this.dataset.thermalForm !== undefined ? this : this.parent?.closest?.(selector) ?? null; }
  insertBefore(item, before) {
    const index = before ? this.children.indexOf(before) : -1;
    if (index < 0) this.append(item);
    else { this.children.splice(index, 0, item); item.parent = this; }
  }
}

function list(...cards) {
  const value = new FakeElement();
  value.dataset.activityFeedList = '';
  value.children = cards;
  for (const card of cards) card.parent = value;
  return value;
}

function loadMore({ endpoint = '/activity/feed?before=next', href = '/activity?before=next' } = {}) {
  const value = new FakeElement();
  value.dataset.activityLoadMore = '';
  value.dataset.fragmentHref = endpoint;
  value.href = href;
  return value;
}

function status() {
  const value = new FakeElement();
  value.dataset.activityLoadMoreStatus = '';
  return value;
}

function thermalForm({ action = '/activities/activity-id/thermal', reacted = false, count = 0 } = {}) {
  const form = new FakeElement();
  form.dataset.thermalForm = '';
  form.action = action;
  const button = new FakeElement();
  button.dataset.thermalButton = '';
  button.setAttribute('aria-pressed', reacted ? 'true' : 'false');
  const label = new FakeElement();
  label.dataset.thermalLabel = '';
  label.textContent = reacted ? 'Thermal sent' : 'Send a Thermal';
  const countNode = new FakeElement();
  countNode.dataset.thermalCount = '';
  countNode.textContent = String(count);
  const statusNode = new FakeElement();
  statusNode.dataset.thermalStatus = '';
  form.append(button, label, countNode, statusNode);
  return { form, button, label, countNode, statusNode };
}

function harness(responseHtml, responseOk = true) {
  let responseBody = responseHtml;
  const current = new FakeElement();
  const currentList = list(new FakeElement());
  const currentLink = loadMore();
  const currentStatus = status();
  current.append(currentList, currentLink, currentStatus);
  const documentRef = {
    querySelector: (selector) => selector === '[data-activity-feed-container]' ? current : null,
    createElement: () => new FakeElement(),
    importNode: (node) => node,
  };
  const fetchImpl = vi.fn(async () => ({ ok: responseOk, status: responseOk ? 200 : 500, text: async () => responseHtml }));
  globalThis.DOMParser = class { parseFromString() { return { querySelector: () => responseBody }; } };
  return { current, currentLink, currentStatus, fetchImpl, documentRef, setResponse: (value) => { responseBody = value; } };
}

describe('activity feed pager', () => {
  it('appends cards and replaces the cursor link, then removes it on the last page', async () => {
    const incoming = new FakeElement();
    const next = loadMore({ endpoint: '/activity/feed?before=last' });
    const fragment = new FakeElement();
    fragment.append(list(incoming), next, status());
    const h = harness(fragment);
    initializeActivityFeed(h.documentRef, h.fetchImpl);
    await h.currentLink.click();
    expect(h.fetchImpl).toHaveBeenCalledWith('/activity/feed?before=next', { headers: { Accept: 'text/html' } });
    expect(h.current.querySelector('[data-activity-feed-list]').children).toContain(incoming);
    expect(h.current.querySelector('[data-activity-load-more]')).toBe(next);

    const terminal = new FakeElement();
    const terminalFragment = new FakeElement();
    terminalFragment.append(list(terminal));
    h.setResponse(terminalFragment);
    h.fetchImpl.mockResolvedValueOnce({ ok: true, status: 200, text: async () => terminalFragment });
    await h.current.querySelector('[data-activity-load-more]').click();
    expect(h.current.querySelector('[data-activity-load-more]')).toBeNull();
  });

  it('progressively toggles Thermal state through delegated form submission', async () => {
    const h = harness(new FakeElement());
    const thermal = thermalForm({ count: 2 });
    h.current.querySelector('[data-activity-feed-list]').append(thermal.form);
    h.fetchImpl.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ reacted: true, totalCount: 3 }) });
    initializeActivityFeed(h.documentRef, h.fetchImpl);
    await h.current.listeners.get('submit')({ target: thermal.form, preventDefault: vi.fn() });
    expect(h.fetchImpl).toHaveBeenCalledWith('/activities/activity-id/thermal', { method: 'POST', headers: { Accept: 'application/json' } });
    expect(thermal.button.getAttribute('aria-pressed')).toBe('true');
    expect(thermal.label.textContent).toBe('Thermal sent');
    expect(thermal.countNode.textContent).toBe('3');
  });

  it('restores Thermal state and announces errors when the request fails', async () => {
    const h = harness(new FakeElement());
    const thermal = thermalForm({ reacted: true, count: 3 });
    h.current.querySelector('[data-activity-feed-list]').append(thermal.form);
    h.fetchImpl.mockResolvedValueOnce({ ok: false, status: 500 });
    initializeActivityFeed(h.documentRef, h.fetchImpl);
    await h.current.listeners.get('submit')({ target: thermal.form, preventDefault: vi.fn() });
    expect(thermal.button.getAttribute('aria-pressed')).toBe('true');
    expect(thermal.label.textContent).toBe('Thermal sent');
    expect(thermal.countNode.textContent).toBe('3');
    expect(thermal.statusNode.getAttribute('role')).toBe('alert');
  });

  it('guards duplicate clicks and exposes an accessible failure state', async () => {
    let resolve;
    const pending = new Promise((r) => { resolve = r; });
    const h = harness(new FakeElement());
    h.fetchImpl.mockReturnValueOnce(pending);
    initializeActivityFeed(h.documentRef, h.fetchImpl);
    const first = h.currentLink.click();
    const second = h.currentLink.click();
    expect(h.fetchImpl).toHaveBeenCalledTimes(1);
    resolve({ ok: false, status: 503, text: async () => '' });
    await Promise.all([first, second]);
    expect(h.currentStatus.getAttribute('role')).toBe('alert');
    expect(h.currentStatus.textContent).toContain('Could not load more activity');
    expect(h.currentLink.getAttribute('aria-disabled')).toBeNull();
  });
});
