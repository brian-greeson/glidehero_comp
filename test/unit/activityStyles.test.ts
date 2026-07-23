import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('Activity stylesheet contract', () => {
  it.each([393, 430])('keeps three statistic badges and overflow inside a two-column tile at %ipx', async (viewportWidth) => {
    const css = await readFile('public/styles/app-ui/activity.css', 'utf8');

    expect(css).toContain('@media (max-width: 900px)');
    expect(css).toContain('grid-template-columns: repeat(2, minmax(0, 1fr))');
    expect(css).toContain('width: clamp(35px, 5vw, 46px)');
    expect(css).toContain('width: clamp(26px, 3.55vw, 32px)');

    const rem = 16;
    const clamp = (minimum: number, preferred: number, maximum: number) => (
      Math.max(minimum, Math.min(preferred, maximum))
    );
    const badgeWidth = clamp(35, viewportWidth * .05, 46);
    const overflowWidth = clamp(26, viewportWidth * .0355, 32);
    const gap = clamp(.15 * rem, viewportWidth * .006, .3 * rem);
    const badgeRowWidth = (badgeWidth * 3) + overflowWidth + (gap * 3);

    const pageWidth = viewportWidth - 20;
    const statsContentWidth = pageWidth - (2 * .85 * rem);
    const tileBorderBoxWidth = (statsContentWidth - (.6 * rem)) / 2;
    const tileContentWidth = tileBorderBoxWidth - (2 * .75 * rem) - 2;

    expect(badgeRowWidth).toBeLessThanOrEqual(tileContentWidth);
  });
});
