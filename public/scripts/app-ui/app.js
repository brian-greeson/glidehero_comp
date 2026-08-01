import { initializeFlightUploads } from '../flightUploads.js';
import { initializeMapSheet } from './mapSheet.js';

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
    if (card.hasAttribute?.('data-profile-always-open')) continue;
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

export function repairFlightThumbnail(image) {
  if (!image || image.dataset?.thumbnailFallback === 'true') return;
  image.dataset.thumbnailFallback = 'true';
  image.parentElement?.querySelector?.('source')?.remove?.();
  image.src = '/flight-thumbnail-fallback.webp';
}

export function initializeFlightThumbnailFallback(documentRef = document) {
  const handleError = (event) => {
    const image = event.target?.closest?.('[data-flight-thumbnail]');
    repairFlightThumbnail(image);
  };
  documentRef.addEventListener?.('error', handleError, true);
  for (const image of documentRef.querySelectorAll?.('[data-flight-thumbnail]') ?? []) {
    if (image.complete === true && image.naturalWidth === 0) repairFlightThumbnail(image);
  }
}

export function sortFlightRows(rows, key, direction) {
  const multiplier = direction === 'asc' ? 1 : -1;
  return [...rows].sort((left, right) => {
    const difference = Number(left.dataset[key] ?? -1) - Number(right.dataset[key] ?? -1);
    if (difference !== 0) return difference * multiplier;
    return String(left.dataset.launch ?? '').localeCompare(String(right.dataset.launch ?? '')) * -1;
  });
}

export function initializeFlightTables(documentRef = document) {
  for (const table of documentRef.querySelectorAll('[data-flight-table]')) {
    const body = table.querySelector('[data-flight-table-body]');
    if (!body) continue;
    const buttons = [...table.querySelectorAll('[data-flight-sort]')];
    for (const button of buttons) {
      button.addEventListener('click', () => {
        const key = button.dataset.flightSort;
        if (!key) return;
        const header = button.closest('th');
        const currentlyActive = header?.getAttribute('aria-sort') !== 'none';
        const direction = currentlyActive && button.dataset.sortDirection === 'desc' ? 'asc' : 'desc';
        button.dataset.sortDirection = direction;
        const rows = [...body.querySelectorAll('[data-flight-row]')];
        for (const row of sortFlightRows(rows, key, direction)) body.append(row);
        for (const option of buttons) {
          const optionHeader = option.closest('th');
          const active = option === button;
          optionHeader?.setAttribute('aria-sort', active ? (direction === 'asc' ? 'ascending' : 'descending') : 'none');
          const indicator = option.querySelector('span');
          if (indicator) indicator.textContent = active ? (direction === 'asc' ? '↑' : '↓') : '↕';
        }
      });
    }
  }
}

export function initializeAppUi(documentRef = document) {
  initializeAccountMenu(documentRef);
  initializeFlightUploads(documentRef, globalThis.window);
  initializeSegmentedControls(documentRef);
  initializeActivityFilters(documentRef);
  initializeProfileDisclosures(documentRef);
  initializeFlightThumbnailFallback(documentRef);
  initializeFlightTables(documentRef);
  if (documentRef.querySelector?.('[data-app-page="flight"]')) initializeMapSheet({ documentRef });
}

if (typeof document !== 'undefined') initializeAppUi(document);
