import { initializeFlightUploads } from '../flightUploads.js';

export function initializeAccountMenu(documentRef = document) {
  const root = documentRef.querySelector('[data-app-account]');
  const trigger = root?.querySelector?.('[data-account-trigger]');
  const menu = root?.querySelector?.('[data-account-menu]');
  if (!root || !trigger || !menu) return;

  function setOpen(open) {
    menu.hidden = !open;
    trigger.setAttribute('aria-expanded', String(open));
  }

  trigger.addEventListener('click', () => setOpen(menu.hidden));
  documentRef.addEventListener?.('click', (event) => {
    if (!menu.hidden && !root.contains(event.target)) setOpen(false);
  });
  documentRef.addEventListener?.('keydown', (event) => {
    if (event.key !== 'Escape' || menu.hidden) return;
    setOpen(false);
    trigger.focus?.();
  });
}

export function initializeSegmentedControls(documentRef = document) {
  for (const control of documentRef.querySelectorAll('[data-segmented-control]')) {
    const buttons = [...control.querySelectorAll('button')];
    for (const button of buttons) {
      button.addEventListener('click', () => {
        for (const option of buttons) option.setAttribute('aria-pressed', String(option === button));
      });
    }
  }
}

export function initializeActivityFilters(documentRef = document) {
  const filters = documentRef.querySelector('[data-activity-filters]');
  const feed = documentRef.querySelector('[data-activity-feed]');
  if (!filters || !feed) return;
  const buttons = [...filters.querySelectorAll('[data-filter]')];
  const cards = [...feed.querySelectorAll('[data-activity-kind]')];
  for (const button of buttons) {
    button.addEventListener('click', () => {
      const filter = button.dataset.filter;
      for (const option of buttons) option.setAttribute('aria-pressed', String(option === button));
      for (const card of cards) {
        card.hidden = filter === 'yours' ? card.dataset.activityKind !== 'flight' : false;
      }
    });
  }
}

export function initializeProfileDisclosures(documentRef = document) {
  for (const card of documentRef.querySelectorAll('.profile-card')) {
    const heading = card.querySelector('.section-heading');
    if (!heading) continue;
    heading.setAttribute('role', 'button');
    heading.setAttribute('tabindex', '0');
    heading.setAttribute('aria-expanded', 'false');
    const toggle = () => {
      const expanded = card.classList.toggle('is-expanded');
      heading.setAttribute('aria-expanded', String(expanded));
    };
    heading.addEventListener('click', (event) => {
      if (event.target.closest?.('a')) return;
      toggle();
    });
    heading.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      toggle();
    });
  }
}

export function initializeFlightThumbnailFallback(documentRef = document) {
  const handleError = (event) => {
    const image = event.target?.closest?.('[data-flight-thumbnail]');
    if (!image || image.dataset.thumbnailFallback === 'true') return;
    image.dataset.thumbnailFallback = 'true';
    image.parentElement?.querySelector?.('source')?.removeAttribute('srcset');
    image.src = '/flight-thumbnail-fallback.webp';
  };
  documentRef.addEventListener?.('error', handleError, true);
}

export function initializeAppUi(documentRef = document) {
  initializeAccountMenu(documentRef);
  initializeFlightUploads(documentRef, globalThis.window);
  initializeSegmentedControls(documentRef);
  initializeActivityFilters(documentRef);
  initializeProfileDisclosures(documentRef);
  initializeFlightThumbnailFallback(documentRef);
}

if (typeof document !== 'undefined') initializeAppUi(document);
