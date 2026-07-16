import { describe, expect, it } from 'vitest';

// @ts-expect-error Browser assets remain JavaScript.
import { renderCompetitionLeaderboard, renderCompetitionStats } from '../../public/scripts/competitionResultsView.js';
// @ts-expect-error Browser assets remain JavaScript.
import { formatClaimedArea } from '../../public/scripts/dashboardFormatters.js';
// @ts-expect-error Browser assets remain JavaScript.
import { renderPersonalStats } from '../../public/scripts/personalStatsView.js';

function element(): any {
  const classes = new Set<string>();
  const attributes = new Map<string, string>();
  const node = {
    hidden: false,
    textContent: '',
    className: '',
    children: [] as any[],
    classList: { add(name: string) { classes.add(name); } },
    style: { setProperty() {} },
    setAttribute(name: string, value: string) { attributes.set(name, value); },
    removeAttribute(name: string) { attributes.delete(name); },
    append(...children: any[]) { node.children.push(...children); },
    replaceChildren(...children: any[]) { node.children = children; },
  };
  return node;
}

describe('Dashboard result views', () => {
  it('renders populated Personal stats and the specified empty Competition state', () => {
    const elements = new Map([
      ['[data-personal-stats]', element()],
      ['[data-personal-claimed-area]', element()],
      ['[data-personal-flights]', element()],
      ['[data-competition-stats]', element()],
      ['[data-competition-claimed-area]', element()],
      ['[data-competition-flights]', element()],
      ['[data-competition-pilots]', element()],
      ['[data-competition-my-flights]', element()],
    ]);
    const documentRef = { querySelector: (selector: string) => elements.get(selector) ?? null };

    renderPersonalStats({
      documentRef,
      locale: 'en-US',
      stats: { claimedCellCount: 2, claimedAreaSquareMeters: 2_500_000, flightCount: 2 },
    });
    expect(elements.get('[data-personal-claimed-area]')?.textContent).toBe('2.5 km²');
    expect(elements.get('[data-personal-flights]')?.textContent).toBe('2');

    renderCompetitionStats({
      documentRef,
      stats: {
        claimedCellCount: 0,
        claimedAreaSquareMeters: 0,
        flightCount: 0,
        pilotCount: 0,
        currentPilotFlightCount: 0,
      },
    });
    for (const selector of [
      '[data-competition-claimed-area]',
      '[data-competition-flights]',
      '[data-competition-pilots]',
      '[data-competition-my-flights]',
    ]) expect(elements.get(selector)?.textContent).toBe('-');
    expect(formatClaimedArea(2_500_000, 'en-US')).toBe('2.5 km²');
  });

  it('renders leaderboard rows and the signed-in pilot separately', () => {
    const documentRef = { createElement: () => element() };
    const statusElement = element();
    const listElement = element();
    const currentPilotElement = element();
    const colorRegistry = { colorFor: () => '#1769AA' };
    renderCompetitionLeaderboard({
      documentRef,
      leaderboard: {
        leaders: [{
          userId: 'other', displayName: 'Other Pilot', claimedAreaSquareMeters: 1_000_000, rank: 1,
        }],
        currentPilot: {
          userId: 'current', displayName: 'Current Pilot', claimedAreaSquareMeters: 0, rank: null,
        },
      },
      currentUserId: 'current',
      colorRegistry,
      statusElement,
      listElement,
      currentPilotElement,
    });
    expect(listElement.children).toHaveLength(1);
    expect(currentPilotElement.hidden).toBe(false);
    expect(currentPilotElement.children).toHaveLength(2);
  });
});
