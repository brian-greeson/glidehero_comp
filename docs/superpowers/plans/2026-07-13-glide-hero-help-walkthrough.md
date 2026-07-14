# Glide Hero Help Walkthrough Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a reusable, on-demand three-step dashboard dialog that visually teaches crossed-cell and enclosed-cell claims.

**Architecture:** An authenticated-only Vento component renders the semantic native dialog and inline SVG demonstrations, with the pilot's territory color supplied through a CSS custom property. A standalone, dependency-free browser controller manages navigation, dismissal, active animation state, focus trapping, and restoration; `dashboard.js` only initializes it. Shared CSS provides the approved responsive layout, active-only looping sequences, and reduced-motion final states.

**Tech Stack:** Vento 2.4, native HTML `<dialog>`, ES modules, inline SVG, CSS animations/media queries, TypeScript 7, Vitest 4.

## Global Constraints

- The walkthrough opens only from `?`; it never auto-opens and stores no completion state.
- Grid-cell behavior intentionally previews the planned cell system rather than the currently implemented free-polygon claim system.
- Closing a loop claims every enclosed grid cell.
- Final approved copy and the selected responsive side-by-side treatment are used unchanged.
- Use a side-by-side layout at 700px and wider; use an animation-first stacked layout below 700px, with internal scrolling on short screens.
- No API, database, session, upload, or MapLibre contract changes.
- Modern native-dialog support is assumed; no new runtime dependencies or media assets are required.
- Existing dashboard behavior remains operational if onboarding initialization or decorative animation is unavailable.
- Keep temporary `.superpowers/` companion files untracked and out of feature commits.
- Build views from a reusable Vento component rather than duplicating dialog markup in the dashboard page.

---

## File structure

| File | Responsibility |
| --- | --- |
| `docs/superpowers/specs/2026-07-13-glide-hero-help-walkthrough-design.md` | Records the approved scope, copy, architecture, accessibility, and validation contract. |
| `docs/superpowers/plans/2026-07-13-glide-hero-help-walkthrough.md` | Tracks this task-by-task implementation plan. |
| `src/views/components/onboarding.vto` | Reusable native-dialog markup, step copy, progress, controls, and inline SVG demonstrations. |
| `src/views/pages/index.vto` | Enables the existing dashboard help trigger and includes the onboarding component only in the authenticated branch. |
| `public/scripts/onboarding.js` | Dependency-free dialog state, navigation, dismissal, focus, and missing-markup behavior. |
| `public/scripts/dashboard.js` | Imports and initializes onboarding alongside existing dashboard behavior. |
| `public/styles/app.css` | Dialog layout, responsive breakpoint, accessibility states, and SVG animation sequences. |
| `test/unit/renderer.test.ts` | Verifies authenticated-only markup, copy, hooks, and territory-color rendering. |
| `test/unit/onboarding.test.ts` | Verifies controller behavior with deterministic DOM/dialog fakes. |
| `test/unit/onboardingStyles.test.ts` | Guards responsive, animation, reduced-motion, focus, and touch-target CSS contracts. |

### Task 1: Render the authenticated onboarding component

**Files:**
- Modify: `test/unit/renderer.test.ts:6-63`
- Create: `src/views/components/onboarding.vto`
- Modify: `src/views/pages/index.vto:18-20,105-106`
- Include in commit: `docs/superpowers/specs/2026-07-13-glide-hero-help-walkthrough-design.md`
- Include in commit: `docs/superpowers/plans/2026-07-13-glide-hero-help-walkthrough.md`

**Interfaces:**
- Consumes: Vento include data `{ territoryColor: string }` from `currentUser.territoryColor`.
- Produces: `[data-onboarding-trigger]`, `[data-onboarding-dialog]`, three `[data-onboarding-step]` elements, `[data-onboarding-progress]`, `[data-onboarding-close]`, `[data-onboarding-back]`, `[data-onboarding-next]`, and `[data-onboarding-done]`.
- Produces animation hooks: `.onboarding-flight-track`, `.onboarding-loop-track`, `.onboarding-claim-cell`, `.onboarding-enclosed-cell`, and `--territory-color`.

- [ ] **Step 1: Write failing renderer coverage for the component contract**

In the anonymous renderer test, add these assertions after the signup-action assertion:

```ts
expect(anonymous).not.toContain('data-onboarding-trigger');
expect(anonymous).not.toContain('data-onboarding-dialog');
```

In the authenticated renderer test, replace the existing help-stub expectation area by adding these assertions after the dashboard-map assertion:

```ts
expect(authenticated).toContain('data-onboarding-trigger');
expect(authenticated).toContain('aria-controls="glide-hero-onboarding"');
expect(authenticated).not.toContain('data-stub="help"');
expect(authenticated).toContain('<dialog id="glide-hero-onboarding"');
expect(authenticated).toContain('data-onboarding-dialog');
expect(authenticated.match(/data-onboarding-step/g)).toHaveLength(3);
expect(authenticated).toContain('Welcome to Glide Hero!');
expect(authenticated).toContain('Claim cells as you fly');
expect(authenticated).toContain('Close the loop');
expect(authenticated).toContain('data-onboarding-back');
expect(authenticated).toContain('data-onboarding-next');
expect(authenticated).toContain('data-onboarding-done');
expect(authenticated).toContain('data-onboarding-close');
expect(authenticated.match(/data-onboarding-progress/g)).toHaveLength(3);
expect(authenticated).toContain('style="--territory-color: #1769AA"');
```

- [ ] **Step 2: Run the renderer test to verify the component is absent**

Run: `npm test -- test/unit/renderer.test.ts`

Expected: FAIL because the authenticated page still renders `data-stub="help"` and has no onboarding dialog.

- [ ] **Step 3: Create the complete reusable Vento component**

Create `src/views/components/onboarding.vto` with:

```html
<dialog id="glide-hero-onboarding" class="onboarding-dialog" data-onboarding-dialog aria-labelledby="onboarding-title" style="--territory-color: {{ territoryColor }}">
  <div class="onboarding-frame">
    <button type="button" class="onboarding-close" data-onboarding-close aria-label="Close walkthrough">×</button>

    <div class="onboarding-pages">
      <section class="onboarding-step onboarding-step-welcome" data-onboarding-step>
        <div class="onboarding-visual onboarding-welcome-visual" aria-hidden="true">
          <img src="/android-chrome-192x192.png" alt="">
          <span>GLIDE HERO</span>
        </div>
        <div class="onboarding-copy">
          <p class="onboarding-eyebrow">How to play · 1 of 3</p>
          <h2 id="onboarding-title">Welcome to Glide Hero!</h2>
          <p>Every flight is a chance to paint the map. Here’s how your track turns into territory.</p>
        </div>
      </section>

      <section class="onboarding-step" data-onboarding-step hidden aria-hidden="true">
        <div class="onboarding-visual" aria-hidden="true">
          <svg class="onboarding-grid" viewBox="0 0 300 220" focusable="false">
            <g class="onboarding-grid-lines">
              <path d="M10 10H290M10 50H290M10 90H290M10 130H290M10 170H290M10 210H290" />
              <path d="M10 10V210M50 10V210M90 10V210M130 10V210M170 10V210M210 10V210M250 10V210M290 10V210" />
            </g>
            <g class="onboarding-crossed-cells">
              <rect class="onboarding-claim-cell claim-1" x="11" y="171" width="38" height="38" />
              <rect class="onboarding-claim-cell claim-2" x="51" y="131" width="38" height="38" />
              <rect class="onboarding-claim-cell claim-3" x="91" y="131" width="38" height="38" />
              <rect class="onboarding-claim-cell claim-4" x="131" y="91" width="38" height="38" />
              <rect class="onboarding-claim-cell claim-5" x="171" y="51" width="38" height="38" />
              <rect class="onboarding-claim-cell claim-6" x="211" y="51" width="38" height="38" />
              <rect class="onboarding-claim-cell claim-7" x="251" y="11" width="38" height="38" />
            </g>
            <path class="onboarding-flight-track" pathLength="1" d="M25 194 C52 189 57 153 82 151 S116 158 144 113 S189 75 226 73 S255 44 279 27" />
            <path class="onboarding-glider" d="M271 22l16 5-16 5 4-5z" />
          </svg>
        </div>
        <div class="onboarding-copy">
          <p class="onboarding-eyebrow">How to play · 2 of 3</p>
          <h2>Claim cells as you fly</h2>
          <p>Your flight track claims every new cell it crosses. Explore new lines and watch the sky fill with your color.</p>
        </div>
      </section>

      <section class="onboarding-step" data-onboarding-step hidden aria-hidden="true">
        <div class="onboarding-visual" aria-hidden="true">
          <svg class="onboarding-grid" viewBox="0 0 300 220" focusable="false">
            <g class="onboarding-grid-lines">
              <path d="M10 10H290M10 50H290M10 90H290M10 130H290M10 170H290M10 210H290" />
              <path d="M10 10V210M50 10V210M90 10V210M130 10V210M170 10V210M210 10V210M250 10V210M290 10V210" />
            </g>
            <g class="onboarding-loop-fill">
              <rect class="onboarding-enclosed-cell enclosed-1" x="91" y="51" width="38" height="38" />
              <rect class="onboarding-enclosed-cell enclosed-2" x="131" y="51" width="38" height="38" />
              <rect class="onboarding-enclosed-cell enclosed-3" x="171" y="51" width="38" height="38" />
              <rect class="onboarding-enclosed-cell enclosed-4" x="91" y="91" width="38" height="38" />
              <rect class="onboarding-enclosed-cell enclosed-5" x="131" y="91" width="38" height="38" />
              <rect class="onboarding-enclosed-cell enclosed-6" x="171" y="91" width="38" height="38" />
              <rect class="onboarding-enclosed-cell enclosed-7" x="91" y="131" width="38" height="38" />
              <rect class="onboarding-enclosed-cell enclosed-8" x="131" y="131" width="38" height="38" />
              <rect class="onboarding-enclosed-cell enclosed-9" x="171" y="131" width="38" height="38" />
            </g>
            <path class="onboarding-loop-track" pathLength="1" d="M70 34 H224 C246 34 250 52 250 72 V172 C250 193 230 194 210 194 H72 C51 194 50 174 50 154 V71 C50 48 54 34 70 34 Z" />
            <path class="onboarding-glider onboarding-loop-glider" d="M61 28l16 5-16 5 4-5z" />
          </svg>
        </div>
        <div class="onboarding-copy">
          <p class="onboarding-eyebrow">How to play · 3 of 3</p>
          <h2>Close the loop</h2>
          <p>When your flight path forms a closed loop, every grid cell inside it becomes yours.</p>
        </div>
      </section>
    </div>

    <footer class="onboarding-footer">
      <ol class="onboarding-progress" aria-label="Walkthrough progress">
        <li><span data-onboarding-progress aria-current="step"><span class="sr-only">Welcome</span></span></li>
        <li><span data-onboarding-progress><span class="sr-only">Claim cells</span></span></li>
        <li><span data-onboarding-progress><span class="sr-only">Close the loop</span></span></li>
      </ol>
      <div class="onboarding-actions">
        <button type="button" class="onboarding-button onboarding-back" data-onboarding-back hidden>Back</button>
        <button type="button" class="onboarding-button onboarding-next" data-onboarding-next>Next</button>
        <button type="button" class="onboarding-button onboarding-done" data-onboarding-done hidden>Done</button>
      </div>
    </footer>
  </div>
</dialog>
```

- [ ] **Step 4: Enable the help trigger and include the component**

In `src/views/pages/index.vto`, replace the help stub comment and button with:

```html
          <button type="button" class="icon-button" data-onboarding-trigger aria-label="Open Glide Hero walkthrough" aria-controls="glide-hero-onboarding">?</button>
```

Immediately after the closing `</aside>` and before the authenticated dashboard section's closing `</section>`, add:

```vento
      {{ include "components/onboarding.vto" { territoryColor: currentUser.territoryColor } }}
```

- [ ] **Step 5: Run focused and regression renderer tests**

Run: `npm test -- test/unit/renderer.test.ts`

Expected: PASS with three renderer tests passing.

- [ ] **Step 6: Commit the documented renderer contract**

```bash
git add src/views/components/onboarding.vto src/views/pages/index.vto test/unit/renderer.test.ts
git add -f docs/superpowers/specs/2026-07-13-glide-hero-help-walkthrough-design.md docs/superpowers/plans/2026-07-13-glide-hero-help-walkthrough.md
git commit -m "feat: render dashboard help walkthrough"
```

Do not stage `.superpowers/`.

### Task 2: Implement dialog navigation, dismissal, and focus behavior

**Files:**
- Create: `test/unit/onboarding.test.ts`
- Create: `public/scripts/onboarding.js`
- Modify: `public/scripts/dashboard.js:1,27-28`

**Interfaces:**
- Consumes the exact data hooks produced by Task 1.
- Produces: `initializeOnboarding({ documentRef = document } = {})` returning `undefined` for missing required markup or `{ open(): void, close(): void }` after successful initialization. State remains observable through the production DOM hooks; do not add test-only introspection methods.
- Mutates each step's `hidden`, `aria-hidden`, and `data-active`; mutates progress `aria-current`; mutates navigation `hidden`.
- `dashboard.js` continues to export `initializeDashboard(...)` and additionally calls `initializeOnboarding({ documentRef })`.

- [ ] **Step 1: Create deterministic DOM fakes for controller tests**

Create `test/unit/onboarding.test.ts` with these imports and fakes:

```ts
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

function createFixture() {
  const trigger = new FakeElement();
  const dialog = new FakeDialog();
  const close = new FakeElement();
  const back = new FakeElement();
  const next = new FakeElement();
  const done = new FakeElement();
  const steps = [new FakeElement(), new FakeElement(), new FakeElement()];
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
    '[data-onboarding-progress]': progress,
  });

  return { trigger, dialog, close, back, next, done, steps, progress, documentRef };
}
```

- [ ] **Step 2: Add failing tests for open, reset, navigation, and active animation state**

Append to `test/unit/onboarding.test.ts`:

```ts
describe('Glide Hero onboarding controller', () => {
  it('opens on the first step and exposes only its animation state', () => {
    const fixture = createFixture();
    const opener = new FakeElement();
    opener.ownerDocument = fixture.documentRef;
    fixture.documentRef.activeElement = opener;
    initializeOnboarding({ documentRef: fixture.documentRef });

    fixture.trigger.dispatch('click');

    expect(fixture.dialog.showModal).toHaveBeenCalledOnce();
    expect(fixture.steps.map((step) => step.hidden)).toEqual([false, true, true]);
    expect(fixture.steps.map((step) => step.hasAttribute('data-active'))).toEqual([true, false, false]);
    expect(fixture.progress.map((item) => item.getAttribute('aria-current'))).toEqual(['step', null, null]);
    expect(fixture.back.hidden).toBe(true);
    expect(fixture.next.hidden).toBe(false);
    expect(fixture.done.hidden).toBe(true);
    expect(fixture.close.focus).toHaveBeenCalledOnce();
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
  });
```

- [ ] **Step 3: Add failing tests for every dismissal and focus path**

Continue the same `describe` block:

```ts
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
});
```

- [ ] **Step 4: Run the controller test to verify the module is absent**

Run: `npm test -- test/unit/onboarding.test.ts`

Expected: FAIL because `public/scripts/onboarding.js` does not exist.

- [ ] **Step 5: Implement the complete dependency-free controller**

Create `public/scripts/onboarding.js` with:

```js
export function initializeOnboarding({ documentRef = document } = {}) {
  const trigger = documentRef.querySelector('[data-onboarding-trigger]');
  const dialog = documentRef.querySelector('[data-onboarding-dialog]');
  if (!trigger || !dialog) return undefined;

  const closeButton = documentRef.querySelector('[data-onboarding-close]');
  const backButton = documentRef.querySelector('[data-onboarding-back]');
  const nextButton = documentRef.querySelector('[data-onboarding-next]');
  const doneButton = documentRef.querySelector('[data-onboarding-done]');
  const steps = Array.from(documentRef.querySelectorAll('[data-onboarding-step]'));
  const progress = Array.from(documentRef.querySelectorAll('[data-onboarding-progress]'));
  if (!closeButton || !backButton || !nextButton || !doneButton || steps.length !== 3) return undefined;

  let activeStep = 0;
  let restoreFocus = null;

  function renderStep(index) {
    activeStep = Math.max(0, Math.min(index, steps.length - 1));
    steps.forEach((step, stepIndex) => {
      const active = stepIndex === activeStep;
      step.hidden = !active;
      step.setAttribute('aria-hidden', String(!active));
      if (active) step.setAttribute('data-active', '');
      else step.removeAttribute('data-active');
    });
    progress.forEach((item, itemIndex) => {
      if (itemIndex === activeStep) item.setAttribute('aria-current', 'step');
      else item.removeAttribute('aria-current');
    });
    backButton.hidden = activeStep === 0;
    nextButton.hidden = activeStep === steps.length - 1;
    doneButton.hidden = activeStep !== steps.length - 1;
  }

  function clearAnimationState() {
    for (const step of steps) step.removeAttribute('data-active');
  }

  function open() {
    restoreFocus = documentRef.activeElement ?? trigger;
    renderStep(0);
    dialog.showModal();
    closeButton.focus();
  }

  function close() {
    if (dialog.open) dialog.close();
  }

  function visibleControls() {
    return [closeButton, backButton, nextButton, doneButton].filter((control) => !control.hidden);
  }

  trigger.addEventListener('click', open);
  closeButton.addEventListener('click', close);
  doneButton.addEventListener('click', close);
  backButton.addEventListener('click', () => renderStep(activeStep - 1));
  nextButton.addEventListener('click', () => renderStep(activeStep + 1));

  dialog.addEventListener('cancel', (event) => {
    event.preventDefault();
    close();
  });
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) close();
  });
  dialog.addEventListener('keydown', (event) => {
    if (event.key !== 'Tab') return;
    const controls = visibleControls();
    const first = controls[0];
    const last = controls[controls.length - 1];
    if (!first || !last) return;
    if (event.shiftKey && documentRef.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && documentRef.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  });
  dialog.addEventListener('close', () => {
    clearAnimationState();
    restoreFocus?.focus();
    restoreFocus = null;
  });

  return { open, close };
}
```

- [ ] **Step 6: Wire onboarding into existing dashboard initialization**

At the top of `public/scripts/dashboard.js`, add:

```js
import { initializeOnboarding } from './onboarding.js';
```

As the first statement inside `initializeDashboard(...)`, before querying the map element, add:

```js
  initializeOnboarding({ documentRef });
```

This location guarantees onboarding initializes even when MapLibre or map markup is unavailable, while the onboarding module's early return preserves the existing dashboard test fakes.

- [ ] **Step 7: Run controller and dashboard regression tests**

Run: `npm test -- test/unit/onboarding.test.ts test/unit/dashboard.test.ts`

Expected: PASS with all onboarding cases and both existing dashboard map cases passing.

- [ ] **Step 8: Commit the controller integration**

```bash
git add public/scripts/onboarding.js public/scripts/dashboard.js test/unit/onboarding.test.ts
git commit -m "feat: control help walkthrough dialog"
```

Do not stage `.superpowers/`.

### Task 3: Add responsive presentation and active-only animation

**Files:**
- Create: `test/unit/onboardingStyles.test.ts`
- Modify: `public/styles/app.css:98`

**Interfaces:**
- Consumes the class hooks and `data-active` state from Tasks 1 and 2.
- Consumes `--territory-color` from the component root.
- Produces a 700px layout breakpoint, `max-height`/internal scrolling behavior, 44px controls, `:focus-visible`, active-only six-second animation loops, and reduced-motion completed states.

- [ ] **Step 1: Write a failing stylesheet contract test**

Create `test/unit/onboardingStyles.test.ts` with:

```ts
import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('onboarding stylesheet contract', () => {
  it('defines responsive, accessible, active-only animation behavior', async () => {
    const css = await readFile('public/styles/app.css', 'utf8');

    expect(css).toContain('.onboarding-dialog');
    expect(css).toContain('max-height: calc(100dvh - 2rem)');
    expect(css).toContain('.onboarding-pages { overflow-y: auto; }');
    expect(css).toContain('min-height: 44px');
    expect(css).toContain('.icon-button[data-onboarding-trigger] { width: 44px; min-height: 44px; }');
    expect(css).toContain('.onboarding-dialog :focus-visible');
    expect(css).toContain('@media (max-width: 699px)');
    expect(css).toContain('@media (min-width: 700px)');
    expect(css).toContain('[data-onboarding-step][data-active] .onboarding-flight-track');
    expect(css).toContain('[data-onboarding-step][data-active] .onboarding-loop-track');
    expect(css).toContain('@media (prefers-reduced-motion: reduce)');
    expect(css).toContain('stroke-dashoffset: 0');
    expect(css).toContain('fill: var(--territory-color)');
  });
});
```

- [ ] **Step 2: Run the stylesheet test to verify it fails**

Run: `npm test -- test/unit/onboardingStyles.test.ts`

Expected: FAIL because no onboarding selectors exist in `public/styles/app.css`.

- [ ] **Step 3: Add the base dialog, layout, and accessibility styles**

Append this block to the end of `public/styles/app.css`, after the existing dashboard media queries, so the onboarding trigger's 44px target overrides the current narrow-navigation icon sizing:

```css
.onboarding-dialog { width: min(880px, calc(100vw - 2rem)); max-width: none; max-height: calc(100dvh - 2rem); padding: 0; overflow: hidden; border: 0; border-radius: 1.25rem; color: #14213d; background: #fff; box-shadow: 0 24px 80px rgb(2 8 23 / .38); }
.onboarding-dialog::backdrop { background: rgb(2 8 23 / .68); backdrop-filter: blur(3px); }
.onboarding-frame { display: grid; max-height: calc(100dvh - 2rem); grid-template-rows: minmax(0, 1fr) auto; position: relative; }
.onboarding-pages { overflow-y: auto; }
.onboarding-step { min-height: 430px; padding: clamp(2rem, 5vw, 4rem); }
.onboarding-step[hidden] { display: none; }
.onboarding-visual { display: grid; min-width: 0; place-items: center; padding: 1rem; border-radius: 1rem; background: linear-gradient(145deg, #eef6ff, #e5edf7); }
.onboarding-welcome-visual { align-content: center; gap: .75rem; color: #071521; font-size: clamp(1.2rem, 3vw, 1.8rem); font-style: italic; font-weight: 900; letter-spacing: .04em; }
.onboarding-welcome-visual img { width: min(180px, 44vw); height: auto; filter: drop-shadow(0 12px 18px rgb(15 23 42 / .18)); }
.onboarding-copy { align-self: center; }
.onboarding-copy h2 { margin: .25rem 0 .85rem; color: #0f172a; font-size: clamp(1.8rem, 4vw, 2.8rem); line-height: 1.05; }
.onboarding-copy > p:last-child { margin: 0; color: #52657a; font-size: 1.05rem; line-height: 1.6; }
.onboarding-eyebrow { margin: 0; color: var(--territory-color); font-size: .78rem; font-weight: 900; letter-spacing: .13em; text-transform: uppercase; }
.onboarding-grid { width: min(100%, 340px); height: auto; overflow: visible; }
.onboarding-grid-lines { fill: none; stroke: #b8c8d9; stroke-width: 1.5; }
.onboarding-flight-track, .onboarding-loop-track { fill: none; stroke: #f36b35; stroke-width: 5; stroke-linecap: round; stroke-linejoin: round; stroke-dasharray: 1; stroke-dashoffset: 1; }
.onboarding-glider { fill: #f36b35; }
.onboarding-claim-cell, .onboarding-enclosed-cell { fill: var(--territory-color); opacity: 0; }
.icon-button[data-onboarding-trigger] { width: 44px; min-height: 44px; }
.onboarding-close { position: absolute; top: .75rem; right: .75rem; z-index: 2; width: 44px; min-height: 44px; padding: 0; border: 0; border-radius: 999px; color: #334155; background: #eef2f7; font-size: 1.6rem; line-height: 1; }
.onboarding-footer { display: flex; min-height: 76px; align-items: center; justify-content: space-between; gap: 1rem; padding: .85rem 1.25rem; border-top: 1px solid #e2e8f0; background: #fff; }
.onboarding-progress { display: flex; gap: .5rem; margin: 0; padding: 0; list-style: none; }
.onboarding-progress [data-onboarding-progress] { display: block; width: 9px; height: 9px; border-radius: 999px; background: #cbd5e1; transition: width .2s ease, background-color .2s ease; }
.onboarding-progress [aria-current="step"] { width: 26px; background: var(--territory-color); }
.onboarding-actions { display: flex; gap: .65rem; margin-left: auto; }
.onboarding-button { width: auto; min-width: 92px; min-height: 44px; padding: .65rem 1rem; }
.onboarding-back { color: #334155; border-color: #cbd5e1; background: #fff; }
.onboarding-next, .onboarding-done { border-radius: 999px; }
.onboarding-dialog :focus-visible { outline: 3px solid #f59e0b; outline-offset: 3px; }
```

- [ ] **Step 4: Add the approved responsive composition**

Append immediately after the base onboarding styles:

```css
@media (max-width: 699px) {
  .onboarding-step { display: flex; min-height: 0; flex-direction: column; gap: 1.5rem; padding: 4rem 1.25rem 1.75rem; }
  .onboarding-visual { order: 1; min-height: 220px; }
  .onboarding-copy { order: 2; }
  .onboarding-footer { position: sticky; bottom: 0; }
}

@media (min-width: 700px) {
  .onboarding-step { display: grid; grid-template-columns: minmax(0, 1.1fr) minmax(260px, .9fr); gap: clamp(2rem, 5vw, 4rem); }
}
```

- [ ] **Step 5: Add active-only loops and completed reduced-motion states**

Append after the responsive layout blocks:

```css
[data-onboarding-step][data-active] .onboarding-flight-track { animation: onboarding-draw 6s ease-in-out infinite; }
[data-onboarding-step][data-active] .onboarding-loop-track { animation: onboarding-draw-loop 6s ease-in-out infinite; }
[data-onboarding-step][data-active] .onboarding-claim-cell { animation: onboarding-claim 6s ease-out infinite; }
[data-onboarding-step][data-active] .claim-2 { animation-delay: .25s; }
[data-onboarding-step][data-active] .claim-3 { animation-delay: .5s; }
[data-onboarding-step][data-active] .claim-4 { animation-delay: .75s; }
[data-onboarding-step][data-active] .claim-5 { animation-delay: 1s; }
[data-onboarding-step][data-active] .claim-6 { animation-delay: 1.25s; }
[data-onboarding-step][data-active] .claim-7 { animation-delay: 1.5s; }
[data-onboarding-step][data-active] .onboarding-enclosed-cell { animation: onboarding-enclose 6s ease-out infinite; }
[data-onboarding-step][data-active] .enclosed-2, [data-onboarding-step][data-active] .enclosed-4 { animation-delay: .08s; }
[data-onboarding-step][data-active] .enclosed-3, [data-onboarding-step][data-active] .enclosed-5, [data-onboarding-step][data-active] .enclosed-7 { animation-delay: .16s; }
[data-onboarding-step][data-active] .enclosed-6, [data-onboarding-step][data-active] .enclosed-8 { animation-delay: .24s; }
[data-onboarding-step][data-active] .enclosed-9 { animation-delay: .32s; }

@keyframes onboarding-draw {
  0%, 8% { stroke-dashoffset: 1; }
  58%, 82% { stroke-dashoffset: 0; }
  100% { stroke-dashoffset: -1; }
}
@keyframes onboarding-draw-loop {
  0%, 8% { stroke-dashoffset: 1; }
  55%, 84% { stroke-dashoffset: 0; }
  100% { stroke-dashoffset: -1; }
}
@keyframes onboarding-claim {
  0%, 18% { opacity: 0; }
  30%, 82% { opacity: .58; }
  100% { opacity: 0; }
}
@keyframes onboarding-enclose {
  0%, 52% { opacity: 0; }
  64%, 84% { opacity: .62; }
  100% { opacity: 0; }
}

@media (prefers-reduced-motion: reduce) {
  [data-onboarding-step][data-active] .onboarding-flight-track,
  [data-onboarding-step][data-active] .onboarding-loop-track,
  [data-onboarding-step][data-active] .onboarding-claim-cell,
  [data-onboarding-step][data-active] .onboarding-enclosed-cell { animation: none; }
  .onboarding-flight-track, .onboarding-loop-track { stroke-dashoffset: 0; }
  .onboarding-claim-cell, .onboarding-enclosed-cell { fill: var(--territory-color); opacity: .62; }
  .onboarding-progress [data-onboarding-progress] { transition: none; }
}
```

The draw/fill animations reach their completed state by 64% and hold through at least 82%, creating the required completed-state pause before looping.

- [ ] **Step 6: Run focused UI contract tests**

Run: `npm test -- test/unit/onboardingStyles.test.ts test/unit/onboarding.test.ts test/unit/renderer.test.ts`

Expected: PASS for the stylesheet contract, controller behavior, and rendered markup.

- [ ] **Step 7: Start the app for manual viewport and interaction validation**

Run: `npm run dev`

Expected: the server starts without an exception and serves the authenticated dashboard using the existing local environment configuration. Keep this process outside the feature commit.

- [ ] **Step 8: Validate narrow portrait layouts**

At 375×667 and 390×844, open `?` and verify the animation appears before the copy, the footer remains reachable, internal scrolling reveals all copy on the shorter viewport, each control is at least 44px, and no content crosses the viewport edges.

- [ ] **Step 9: Validate short landscape and the exact breakpoint**

At 667×375, 699px wide, and 700px wide, verify short-screen scrolling works, 699px uses animation-first stacking, and 700px switches to a side-by-side visual/copy composition without clipping.

- [ ] **Step 10: Validate desktop behavior, keyboard behavior, and reduced motion**

On desktop, verify all three steps, looping completed-state pauses, the user's territory color, Back/Next/Done, close, backdrop click, Escape, visible focus, Tab/Shift+Tab wrapping, focus restoration to `?`, reopening at Welcome, inactive-step hiding, and static completed SVGs with reduced motion enabled.

- [ ] **Step 11: Run the complete required verification**

Run: `npm test && npm run typecheck && npm run build`

Expected: the full unit suite passes; typecheck exits with no diagnostics; build emits `dist/` and exits successfully.

- [ ] **Step 12: Commit the responsive animated treatment**

```bash
git add public/styles/app.css test/unit/onboardingStyles.test.ts
git commit -m "feat: animate onboarding claim examples"
```

Do not stage `.superpowers/` or generated `dist/` output.
