import { describe, expect, it, vi } from 'vitest';

// The browser asset intentionally remains JavaScript; this test exercises its public module API.
// @ts-expect-error TypeScript does not emit or typecheck files under public/.
import { initializeOnboarding } from '../../public/scripts/onboarding.js';

type Handler = (event: Record<string, unknown>) => void;

class FakeElement {
  hidden = false;
  attributes = new Map<string, string>();
  listeners = new Map<string, Handler[]>();
  ownerDocument: FakeDocument | undefined;

  addEventListener(type: string, handler: Handler) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), handler]);
  }

  dispatch(type: string, values: Record<string, unknown> = {}) {
    const event = {
      type,
      target: this,
      defaultPrevented: false,
      preventDefault() { this.defaultPrevented = true; },
      ...values,
    };
    for (const handler of this.listeners.get(type) ?? []) handler(event);
    return event;
  }

  setAttribute(name: string, value: string) {
    this.attributes.set(name, value);
  }

  removeAttribute(name: string) {
    this.attributes.delete(name);
  }

  hasAttribute(name: string) {
    return this.attributes.has(name);
  }

  getAttribute(name: string) {
    return this.attributes.get(name) ?? null;
  }

  focus = vi.fn(() => {
    if (this.ownerDocument) this.ownerDocument.activeElement = this;
  });
}

class FakeDialog extends FakeElement {
  open = false;
  showModal = vi.fn(() => { this.open = true; });
  close = vi.fn(() => {
    if (!this.open) return;
    this.open = false;
    this.dispatch('close');
  });
}

class FakeDocument {
  activeElement: FakeElement | null = null;

  constructor(
    private readonly singles: Record<string, FakeElement | null>,
    private readonly multiples: Record<string, FakeElement[]>,
  ) {
    for (const element of Object.values(singles)) if (element) element.ownerDocument = this;
    for (const elements of Object.values(multiples)) {
      for (const element of elements) element.ownerDocument = this;
    }
  }

  querySelector(selector: string) {
    return this.singles[selector] ?? null;
  }

  querySelectorAll(selector: string) {
    return this.multiples[selector] ?? [];
  }
}

function createFixture(headingCount = 3) {
  const trigger = new FakeElement();
  const dialog = new FakeDialog();
  const close = new FakeElement();
  const back = new FakeElement();
  const next = new FakeElement();
  const done = new FakeElement();
  const steps = [new FakeElement(), new FakeElement(), new FakeElement()];
  const headings = Array.from({ length: headingCount }, () => new FakeElement());
  const progress = [new FakeElement(), new FakeElement(), new FakeElement()];
  const documentRef = new FakeDocument({
    '[data-onboarding-trigger]': trigger,
    '[data-onboarding-dialog]': dialog,
    '[data-onboarding-close]': close,
    '[data-onboarding-back]': back,
    '[data-onboarding-next]': next,
    '[data-onboarding-done]': done,
  }, {
    '[data-onboarding-step]': steps,
    '[data-onboarding-heading]': headings,
    '[data-onboarding-progress]': progress,
  });

  return { trigger, dialog, close, back, next, done, steps, headings, progress, documentRef };
}

describe('Glide Hero onboarding controller', () => {
  it('opens on the first step, focuses Close, and exposes only open and close', () => {
    const fixture = createFixture();
    const opener = new FakeElement();
    opener.ownerDocument = fixture.documentRef;
    fixture.documentRef.activeElement = opener;
    const controller = initializeOnboarding({ documentRef: fixture.documentRef });

    fixture.trigger.dispatch('click');

    expect(Object.keys(controller ?? {})).toEqual(['open', 'close']);
    expect(fixture.dialog.showModal).toHaveBeenCalledOnce();
    expect(fixture.steps.map((step) => step.hidden)).toEqual([false, true, true]);
    expect(fixture.steps.map((step) => step.hasAttribute('data-active'))).toEqual([true, false, false]);
    expect(fixture.progress.map((item) => item.getAttribute('aria-current'))).toEqual(['step', null, null]);
    expect(fixture.back.hidden).toBe(true);
    expect(fixture.next.hidden).toBe(false);
    expect(fixture.done.hidden).toBe(true);
    expect(fixture.close.focus).toHaveBeenCalledOnce();
    expect(fixture.headings.every((heading) => heading.focus.mock.calls.length === 0)).toBe(true);
  });

  it('focuses the final heading when Next hides itself', () => {
    const fixture = createFixture();
    const finalHeading = fixture.headings[2]!;
    initializeOnboarding({ documentRef: fixture.documentRef });
    fixture.trigger.dispatch('click');
    fixture.next.dispatch('click');

    fixture.next.dispatch('click');

    expect(fixture.next.hidden).toBe(true);
    expect(finalHeading.focus).toHaveBeenCalledOnce();
    expect(fixture.documentRef.activeElement).toBe(finalHeading);
  });

  it('focuses the Welcome heading when Back hides itself', () => {
    const fixture = createFixture();
    const welcomeHeading = fixture.headings[0]!;
    initializeOnboarding({ documentRef: fixture.documentRef });
    fixture.trigger.dispatch('click');
    fixture.next.dispatch('click');

    fixture.back.dispatch('click');

    expect(fixture.back.hidden).toBe(true);
    expect(welcomeHeading.focus).toHaveBeenCalledOnce();
    expect(fixture.documentRef.activeElement).toBe(welcomeHeading);
  });

  it('moves forward and back and swaps Next for Done on the final step', () => {
    const fixture = createFixture();
    initializeOnboarding({ documentRef: fixture.documentRef });
    fixture.trigger.dispatch('click');

    fixture.next.dispatch('click');
    expect(fixture.steps.map((step) => step.hasAttribute('data-active'))).toEqual([false, true, false]);
    expect(fixture.back.hidden).toBe(false);

    fixture.next.dispatch('click');
    expect(fixture.steps.map((step) => step.hasAttribute('data-active'))).toEqual([false, false, true]);
    expect(fixture.next.hidden).toBe(true);
    expect(fixture.done.hidden).toBe(false);

    fixture.back.dispatch('click');
    expect(fixture.steps.map((step) => step.hasAttribute('data-active'))).toEqual([false, true, false]);
    expect(fixture.next.hidden).toBe(false);
    expect(fixture.done.hidden).toBe(true);
  });

  it('resets to the welcome step every time it reopens', () => {
    const fixture = createFixture();
    initializeOnboarding({ documentRef: fixture.documentRef });
    fixture.trigger.dispatch('click');
    fixture.next.dispatch('click');
    fixture.next.dispatch('click');
    fixture.done.dispatch('click');

    fixture.trigger.dispatch('click');

    expect(fixture.steps.map((step) => step.hasAttribute('data-active'))).toEqual([true, false, false]);
    expect(fixture.steps.map((step) => step.hidden)).toEqual([false, true, true]);
    expect(fixture.close.focus).toHaveBeenCalledTimes(2);
    expect(fixture.headings[0]!.focus).not.toHaveBeenCalled();
  });

  it.each([
    ['close button', (fixture: ReturnType<typeof createFixture>) => fixture.close.dispatch('click')],
    ['Done', (fixture: ReturnType<typeof createFixture>) => fixture.done.dispatch('click')],
    ['Escape', (fixture: ReturnType<typeof createFixture>) => fixture.dialog.dispatch('cancel')],
    ['backdrop', (fixture: ReturnType<typeof createFixture>) => fixture.dialog.dispatch('click', { target: fixture.dialog })],
  ])('closes with %s and restores the prior focus', (_name, dismiss) => {
    const fixture = createFixture();
    const priorFocus = new FakeElement();
    priorFocus.ownerDocument = fixture.documentRef;
    fixture.documentRef.activeElement = priorFocus;
    initializeOnboarding({ documentRef: fixture.documentRef });
    fixture.trigger.dispatch('click');
    fixture.next.dispatch('click');
    fixture.next.dispatch('click');

    dismiss(fixture);

    expect(fixture.dialog.close).toHaveBeenCalledOnce();
    expect(priorFocus.focus).toHaveBeenCalledOnce();
    expect(fixture.steps.every((step) => !step.hasAttribute('data-active'))).toBe(true);
  });

  it('ignores clicks inside the dialog surface', () => {
    const fixture = createFixture();
    const inside = new FakeElement();
    initializeOnboarding({ documentRef: fixture.documentRef });
    fixture.trigger.dispatch('click');

    fixture.dialog.dispatch('click', { target: inside });

    expect(fixture.dialog.close).not.toHaveBeenCalled();
  });

  it('wraps Tab and Shift+Tab among visible dialog controls', () => {
    const fixture = createFixture();
    initializeOnboarding({ documentRef: fixture.documentRef });
    fixture.trigger.dispatch('click');
    fixture.documentRef.activeElement = fixture.next;

    const forward = fixture.dialog.dispatch('keydown', { key: 'Tab', shiftKey: false });
    expect(forward.defaultPrevented).toBe(true);
    expect(fixture.close.focus).toHaveBeenCalledTimes(2);

    fixture.documentRef.activeElement = fixture.close;
    const backward = fixture.dialog.dispatch('keydown', { key: 'Tab', shiftKey: true });
    expect(backward.defaultPrevented).toBe(true);
    expect(fixture.next.focus).toHaveBeenCalledOnce();
  });

  it('returns a safe no-op when required markup is missing', () => {
    const documentRef = new FakeDocument({}, {});

    expect(() => initializeOnboarding({ documentRef })).not.toThrow();
    expect(initializeOnboarding({ documentRef })).toBeUndefined();
  });

  it('returns a safe no-op when the step heading hooks are incomplete', () => {
    const fixture = createFixture(2);

    expect(initializeOnboarding({ documentRef: fixture.documentRef })).toBeUndefined();
  });
});
