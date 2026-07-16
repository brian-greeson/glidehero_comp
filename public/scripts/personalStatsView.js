import { formatClaimedArea, formatCount } from './dashboardFormatters.js';

export function renderPersonalStats({ documentRef, stats, locale }) {
  const card = documentRef.querySelector('[data-personal-stats]');
  const claimedArea = documentRef.querySelector('[data-personal-claimed-area]');
  const flights = documentRef.querySelector('[data-personal-flights]');
  if (!card || !claimedArea || !flights) return;

  claimedArea.textContent = '-';
  flights.textContent = '-';
  if (stats.claimedCellCount > 0) {
    claimedArea.textContent = formatClaimedArea(stats.claimedAreaSquareMeters, locale);
    flights.textContent = formatCount(stats.flightCount, locale);
  }
  card.removeAttribute('aria-busy');
}
