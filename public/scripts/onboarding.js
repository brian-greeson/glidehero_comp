export function initializeOnboarding({ documentRef = document } = {}) {
  const trigger = documentRef.querySelector('[data-onboarding-trigger]');
  const dialog = documentRef.querySelector('[data-onboarding-dialog]');
  if (!trigger || !dialog) return undefined;

  const closeButton = documentRef.querySelector('[data-onboarding-close]');
  const backButton = documentRef.querySelector('[data-onboarding-back]');
  const nextButton = documentRef.querySelector('[data-onboarding-next]');
  const doneButton = documentRef.querySelector('[data-onboarding-done]');
  const steps = Array.from(documentRef.querySelectorAll('[data-onboarding-step]'));
  const headings = Array.from(documentRef.querySelectorAll('[data-onboarding-heading]'));
  const progress = Array.from(documentRef.querySelectorAll('[data-onboarding-progress]'));
  if (!closeButton || !backButton || !nextButton || !doneButton || steps.length !== 3 || headings.length !== steps.length) return undefined;

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
  backButton.addEventListener('click', () => {
    renderStep(activeStep - 1);
    headings[activeStep].focus();
  });
  nextButton.addEventListener('click', () => {
    renderStep(activeStep + 1);
    headings[activeStep].focus();
  });

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
