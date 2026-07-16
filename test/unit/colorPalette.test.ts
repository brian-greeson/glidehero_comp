import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('app color palette', () => {
  it('defines logo colors and exposes them through semantic app tokens', async () => {
    const palette = await readFile('public/styles/color-palette.css', 'utf8');

    expect(palette).toContain('--color-logo-ink: #17182f;');
    expect(palette).toContain('--color-logo-cyan: #12b9cf;');
    expect(palette).toContain('--color-logo-orange: #ff5a24;');
    expect(palette).toContain('--color-primary: var(--color-logo-cyan);');
    expect(palette).toContain('--color-accent: var(--color-logo-orange);');
  });

  it('loads before the app stylesheet and is consumed by app-wide styles', async () => {
    const layout = await readFile('src/views/layouts/appLayout.vto', 'utf8');
    const css = await readFile('public/styles/app.css', 'utf8');
    const palettePosition = layout.indexOf('/styles/color-palette.css');
    const appPosition = layout.indexOf('/styles/app.css');

    expect(palettePosition).toBeGreaterThan(-1);
    expect(appPosition).toBeGreaterThan(palettePosition);
    expect(css).toContain('color: var(--color-text);');
    expect(css).toContain('background: var(--color-surface-subtle);');
    expect(css).toContain('border-bottom: 3px solid var(--color-primary);');
    expect(css).toContain('stroke: var(--color-accent);');
  });
});
