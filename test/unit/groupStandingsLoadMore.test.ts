import { afterEach, describe, expect, it, vi } from 'vitest';

// The Group browser module intentionally remains JavaScript.
// @ts-expect-error TypeScript does not emit or typecheck files under public/.
import { initializeStandingsLoadMore } from '../../public/scripts/app-ui/group.js';

class ClassListStub {
  values = new Set<string>();
  toggle(name: string, enabled: boolean) {
    if (enabled) this.values.add(name);
    else this.values.delete(name);
  }
  contains(name: string) { return this.values.has(name); }
}

class ElementStub {
  className = '';
  dataset: Record<string, string> = {};
  href = '';
  id = '';
  removed = false;
  textContent = '';
  type = '';
  children: ElementStub[] = [];
  listeners = new Map<string, Array<(event: any) => unknown>>();
  style = { setProperty: vi.fn() };

  addEventListener(type: string, listener: (event: any) => unknown) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }
  async dispatch(type: string) {
    const event = { preventDefault: vi.fn() };
    await Promise.all((this.listeners.get(type) ?? []).map((listener) => listener(event)));
  }
  append(...children: ElementStub[]) { this.children.push(...children); }
  remove() { this.removed = true; }
}

class RowStub extends ElementStub {
  cells: ElementStub[] = [];
  classList = new ClassListStub();
  insertCell() {
    const cell = new ElementStub();
    this.cells.push(cell);
    return cell;
  }
}

class BodyStub {
  rows: RowStub[];
  constructor(rows: RowStub[]) { this.rows = rows; }
  querySelectorAll(selector: string) {
    return selector === '[data-group-standing-user-id]' ? this.rows : [];
  }
  insertRow() {
    const row = new RowStub();
    this.rows.push(row);
    return row;
  }
  insertBefore(row: RowStub, reference: RowStub) {
    this.rows.splice(this.rows.indexOf(row), 1);
    this.rows.splice(this.rows.indexOf(reference), 0, row);
  }
}

function existingRow(userId: string, rank: string) {
  const row = new RowStub();
  row.dataset.groupStandingUserId = userId;
  row.insertCell().textContent = rank;
  return row;
}

describe('Group standings pagination', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('inserts rows around the pinned current pilot and styles a selected pilot', async () => {
    vi.stubGlobal('location', { href: 'http://localhost/groups/group?month=2026-08&pilot=selected' });
    const link = new ElementStub();
    link.href = 'http://localhost/v1/groups/group/standings?month=2026-08&offset=25';
    const body = new BodyStub([
      existingRow('rank-25', '25'),
      existingRow('current', '30'),
    ]);
    const documentRef = {
      querySelector: (selector: string) => selector === '[data-group-standings-load-more]' ? link : body,
      createElement: () => new ElementStub(),
    };
    const standings = [
      { userId: 'rank-26', displayName: 'Rank 26', territoryColor: '#111111', claimedCellCount: 5, bestFivePointDistanceMeters: 10_000, rank: 26, trophy: false },
      { userId: 'rank-27', displayName: 'Rank 27', territoryColor: '#222222', claimedCellCount: 4, bestFivePointDistanceMeters: 9_000, rank: 27, trophy: false },
      { userId: 'current', displayName: 'Current', territoryColor: '#333333', claimedCellCount: 3, bestFivePointDistanceMeters: 8_000, rank: 30, trophy: false },
      { userId: 'selected', displayName: 'Selected', territoryColor: '#444444', claimedCellCount: 2, bestFivePointDistanceMeters: 7_000, rank: 31, trophy: false },
    ];
    const fetchImpl = vi.fn(async () => ({ ok: true, json: async () => ({ standings, nextOffset: null }) }));

    initializeStandingsLoadMore(documentRef as any, fetchImpl);
    await link.dispatch('click');

    expect(body.rows.map((row) => row.dataset.groupStandingUserId)).toEqual([
      'rank-25', 'rank-26', 'rank-27', 'current', 'selected',
    ]);
    expect(body.rows.find((row) => row.dataset.groupStandingUserId === 'selected')?.classList.contains('is-selected')).toBe(true);
    expect(link.removed).toBe(true);
  });
});
