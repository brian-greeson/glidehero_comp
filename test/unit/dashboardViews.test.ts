import { describe, expect, it } from 'vitest';

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
  it('renders populated Personal stats', () => {
    const elements = new Map([
      ['[data-personal-stats]', element()],
      ['[data-personal-claimed-cells]', element()],
      ['[data-personal-claimed-area]', element()],
      ['[data-personal-flights]', element()],
    ]);
    const documentRef = { querySelector: (selector: string) => elements.get(selector) ?? null };

    renderPersonalStats({
      documentRef,
      locale: 'en-US',
      stats: { claimedCellCount: 2, claimedAreaSquareMeters: 2_500_000, flightCount: 2 },
    });
    expect(elements.get('[data-personal-claimed-area]')?.textContent).toBe('2.5 km²');
    expect(elements.get('[data-personal-flights]')?.textContent).toBe('2');
    expect(elements.get('[data-personal-claimed-cells]')?.textContent).toBe('2');

    expect(formatClaimedArea(2_500_000, 'en-US')).toBe('2.5 km²');
  });
});
