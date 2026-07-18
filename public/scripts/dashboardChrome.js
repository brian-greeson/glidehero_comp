import { initializeFlightUploads } from './flightUploads.js';

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

  initializeFlightUploads(documentRef);
}
