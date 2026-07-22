import { formatClaimedArea, formatCount } from './dashboardFormatters.js';

export function renderPersonalStats({ documentRef, stats, locale }) {
  const card = documentRef.querySelector('[data-personal-stats]');
  const claimedArea = documentRef.querySelector('[data-personal-claimed-area]');
  const claimedCells = documentRef.querySelector('[data-personal-claimed-cells]');
  const flights = documentRef.querySelector('[data-personal-flights]');
  if (!card || (!claimedArea && !claimedCells) || !flights) return;

  if (claimedArea) claimedArea.textContent = '-';
  if (claimedCells) claimedCells.textContent = '-';
  flights.textContent = '-';
  if (stats.claimedCellCount > 0) {
    if (claimedArea) claimedArea.textContent = formatClaimedArea(stats.claimedAreaSquareMeters, locale);
    if (claimedCells) claimedCells.textContent = formatCount(stats.claimedCellCount, locale);
    flights.textContent = formatCount(stats.flightCount, locale);
  }
  card.removeAttribute('aria-busy');
}
