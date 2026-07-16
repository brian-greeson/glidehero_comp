import { formatClaimedArea, formatCount } from './dashboardFormatters.js';

export function resetCompetitionResults(documentRef) {
  documentRef.querySelector('[data-leaderboard-list]')?.replaceChildren();
  const currentPilot = documentRef.querySelector('[data-current-pilot-result]');
  if (currentPilot) currentPilot.hidden = true;
  for (const selector of [
    '[data-competition-claimed-area]',
    '[data-competition-flights]',
    '[data-competition-pilots]',
    '[data-competition-my-flights]',
  ]) {
    const value = documentRef.querySelector(selector);
    if (value) value.textContent = '-';
  }
}

export function renderCompetitionStats({ documentRef, stats, locale }) {
  const card = documentRef.querySelector('[data-competition-stats]');
  const claimedArea = documentRef.querySelector('[data-competition-claimed-area]');
  const flights = documentRef.querySelector('[data-competition-flights]');
  const pilots = documentRef.querySelector('[data-competition-pilots]');
  const myFlights = documentRef.querySelector('[data-competition-my-flights]');
  if (!card || !claimedArea || !flights || !pilots || !myFlights) return;

  for (const value of [claimedArea, flights, pilots, myFlights]) value.textContent = '-';
  if (stats.claimedCellCount > 0) {
    claimedArea.textContent = formatClaimedArea(stats.claimedAreaSquareMeters, locale);
    flights.textContent = formatCount(stats.flightCount, locale);
    pilots.textContent = formatCount(stats.pilotCount, locale);
    myFlights.textContent = formatCount(stats.currentPilotFlightCount, locale);
  }
  card.removeAttribute('aria-busy');
}

function createLeaderboardRow(documentRef, pilot, { currentUserId, colorRegistry }) {
  const row = documentRef.createElement('div');
  row.className = 'leaderboard-row';
  row.setAttribute('role', 'listitem');
  if (pilot.userId === currentUserId) row.classList.add('is-current-pilot');

  const rank = documentRef.createElement('span');
  rank.className = 'leaderboard-rank';
  rank.textContent = pilot.rank === null ? '—' : String(pilot.rank);
  const swatch = documentRef.createElement('span');
  swatch.className = 'leaderboard-swatch';
  swatch.setAttribute('aria-hidden', 'true');
  swatch.style.setProperty('--pilot-color', colorRegistry.colorFor(pilot.userId));
  const name = documentRef.createElement('span');
  name.className = 'leaderboard-name';
  name.textContent = pilot.displayName;
  const area = documentRef.createElement('span');
  area.className = 'leaderboard-area';
  area.textContent = formatClaimedArea(pilot.claimedAreaSquareMeters);
  row.append(rank, swatch, name, area);
  return row;
}

export function renderCompetitionLeaderboard({
  documentRef,
  leaderboard,
  currentUserId,
  colorRegistry,
  statusElement,
  listElement,
  currentPilotElement,
}) {
  listElement.replaceChildren(...leaderboard.leaders.map((pilot) => createLeaderboardRow(
    documentRef,
    pilot,
    { currentUserId, colorRegistry },
  )));
  statusElement.textContent = leaderboard.leaders.length === 0 ? 'No claimed territory in this area.' : '';
  currentPilotElement.replaceChildren();
  currentPilotElement.hidden = leaderboard.currentPilot === null;
  if (leaderboard.currentPilot) {
    const label = documentRef.createElement('p');
    label.className = 'current-pilot-label';
    label.textContent = 'Your position';
    currentPilotElement.append(
      label,
      createLeaderboardRow(documentRef, leaderboard.currentPilot, { currentUserId, colorRegistry }),
    );
  }
}
