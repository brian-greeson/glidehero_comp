import { formatClaimedArea, formatCount } from './dashboardFormatters.js';

function pilotRow(documentRef, pilot, { selectedPilotId, currentUserId, colorRegistry, onSelect }) {
  const button = documentRef.createElement('button');
  button.type = 'button';
  button.className = 'coverage-pilot-row';
  button.setAttribute('role', 'row');
  button.setAttribute('aria-pressed', String(pilot.userId === selectedPilotId));
  if (pilot.userId === selectedPilotId) button.classList.add('is-selected');
  if (pilot.userId === currentUserId) button.classList.add('is-current-pilot');
  button.addEventListener('click', () => onSelect(pilot.userId === selectedPilotId ? null : pilot));

  const name = documentRef.createElement('span');
  name.className = 'coverage-pilot-name';
  name.setAttribute('role', 'cell');
  const swatch = documentRef.createElement('span');
  swatch.className = 'leaderboard-swatch';
  swatch.style.setProperty('--pilot-color', colorRegistry.colorFor(pilot.userId));
  swatch.setAttribute('aria-hidden', 'true');
  const label = documentRef.createElement('span');
  label.textContent = `${pilot.rank ?? '—'}. ${pilot.displayName}`;
  name.append(swatch, label);

  button.append(name);
  for (const value of [
    formatCount(pilot.claimedCellCount),
    formatCount(pilot.exclusiveCellCount),
    formatCount(pilot.sharedCellCount),
    formatClaimedArea(pilot.claimedAreaSquareMeters),
  ]) {
    const cell = documentRef.createElement('span');
    cell.setAttribute('role', 'cell');
    cell.textContent = value;
    button.append(cell);
  }
  return button;
}

export function renderCoverageLeaderboard({
  documentRef,
  leaderboard,
  selectedPilotId,
  currentUserId,
  colorRegistry,
  onSelect,
}) {
  const list = documentRef.querySelector('[data-coverage-list]');
  const status = documentRef.querySelector('[data-coverage-status]');
  const current = documentRef.querySelector('[data-coverage-current-pilot]');
  if (!list || !status || !current) return;
  list.replaceChildren(...leaderboard.leaders.map((pilot) => pilotRow(documentRef, pilot, {
    selectedPilotId, currentUserId, colorRegistry, onSelect,
  })));
  current.replaceChildren();
  current.hidden = !leaderboard.currentPilot;
  if (leaderboard.currentPilot) current.append(pilotRow(documentRef, leaderboard.currentPilot, {
    selectedPilotId, currentUserId, colorRegistry, onSelect,
  }));
  status.textContent = leaderboard.leaders.length === 0 ? 'No coverage in this area.' : 'Select a pilot to view their coverage.';
}
