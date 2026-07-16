export function initializeDashboardChrome({ documentRef = document } = {}) {
  const accountTrigger = documentRef.querySelector('[data-account-trigger]');
  const accountPopover = documentRef.querySelector('[data-account-popover]');
  const accountHelpButton = accountPopover?.querySelector?.('[data-onboarding-trigger]');
  if (accountTrigger && accountPopover) {
    accountTrigger.addEventListener('click', () => {
      const open = accountPopover.hidden;
      accountPopover.hidden = !open;
      accountTrigger.setAttribute('aria-expanded', String(open));
    });
    accountHelpButton?.addEventListener('click', () => {
      accountPopover.hidden = true;
      accountTrigger.setAttribute('aria-expanded', 'false');
    });
  }

  const uploadForm = documentRef.querySelector('[data-upload-form]');
  const uploadInput = uploadForm?.querySelector('input[type="file"]');
  if (uploadForm && uploadInput) {
    uploadInput.addEventListener('change', () => {
      if (uploadInput.files?.length) uploadForm.requestSubmit();
    });
  }
}
