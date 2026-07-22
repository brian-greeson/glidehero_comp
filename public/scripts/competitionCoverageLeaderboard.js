import { formatClaimedArea, formatCount } from './dashboardFormatters.js';

function pilotRow(documentRef, pilot, { selectedPilotId, currentUserId, colorRegistry, onSelect }) {
  const row = documentRef.createElement('div');
  row.className = 'coverage-pilot-row';
  row.setAttribute('role', 'row');
  row.setAttribute('tabindex', '0');
  row.setAttribute('aria-pressed', String(pilot.userId === selectedPilotId));
  row.setAttribute('aria-selected', String(pilot.userId === selectedPilotId));
  if (pilot.userId === selectedPilotId) row.classList.add('is-selected');
  if (pilot.userId === currentUserId) row.classList.add('is-current-pilot');

  const toggleSelection = () => onSelect(pilot.userId === selectedPilotId ? null : pilot);
  let profileLink;
  row.addEventListener('click', (event) => {
    if (event?.target && (event.target === profileLink || event.target.closest?.('a'))) return;
    toggleSelection();
  });
  row.addEventListener('keydown', (event) => {
    // Keep the profile link independently keyboard-accessible. Only key presses
    // received by the row itself select a pilot.
    if (event?.target !== row) return;
    if (event?.key !== 'Enter' && event?.key !== ' ') return;
    event.preventDefault?.();
    toggleSelection();
  });

  const name = documentRef.createElement('span');
  name.className = 'coverage-pilot-name';
  name.setAttribute('role', 'cell');
  const swatch = documentRef.createElement('span');
  swatch.className = 'leaderboard-swatch';
  swatch.style.setProperty('--pilot-color', colorRegistry.colorFor(pilot.userId));
  swatch.setAttribute('aria-hidden', 'true');
  const rank = documentRef.createElement('span');
  rank.className = 'leaderboard-rank';
  rank.textContent = `${pilot.rank ?? '—'}.`;
  profileLink = documentRef.createElement('a');
  profileLink.className = 'coverage-pilot-link';
  profileLink.setAttribute('href', `/pilots/${encodeURIComponent(pilot.userId)}`);
  profileLink.textContent = pilot.displayName;
  name.append(swatch, rank, profileLink);

  row.append(name);
  for (const value of [
    formatCount(pilot.claimedCellCount),
    formatClaimedArea(pilot.claimedAreaSquareMeters),
  ]) {
    const cell = documentRef.createElement('span');
    cell.setAttribute('role', 'cell');
    cell.textContent = value;
    row.append(cell);
  }
  return row;
}

export function renderCoverageLeaderboard({
  documentRef,
  leaderboard,
  selectedPilotId,
  currentUserId,
  colorRegistry,
  onSelect,
}) {
  const list = documentRef.querySelector('[data-territory-list]');
  const status = documentRef.querySelector('[data-territory-status]');
  const current = documentRef.querySelector('[data-territory-current-pilot]');
  if (!list || !status || !current) return;
  list.replaceChildren(
    ...leaderboard.leaders.map((pilot) =>
      pilotRow(documentRef, pilot, {
        selectedPilotId,
        currentUserId,
        colorRegistry,
        onSelect,
      }),
    ),
  );
  current.replaceChildren();
  current.hidden = !leaderboard.currentPilot;
  if (leaderboard.currentPilot)
    current.append(
      pilotRow(documentRef, leaderboard.currentPilot, {
        selectedPilotId,
        currentUserId,
        colorRegistry,
        onSelect,
      }),
    );
  const selectedPilot = [...leaderboard.leaders, ...(leaderboard.currentPilot ? [leaderboard.currentPilot] : [])]
    .find((pilot) => pilot.userId === selectedPilotId);
  status.replaceChildren();
  if (!selectedPilot) {
    status.textContent =
      leaderboard.leaders.length === 0
        ? 'No territory for this zoom level or area.'
        : 'Select a pilot to view their coverage.';
    return;
  }
  status.textContent = `Viewing ${selectedPilot.displayName}. `;
  const profileLink = documentRef.createElement('a');
  profileLink.className = 'leaderboard-profile-link';
  profileLink.setAttribute('href', `/pilots/${encodeURIComponent(selectedPilot.userId)}`);
  profileLink.textContent = `View ${selectedPilot.displayName}’s progress`;
  status.append(profileLink);
}
