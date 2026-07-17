import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('dashboard stylesheet contract', () => {
  it('lays out the promoted coverage leaderboard without changing the mobile flow', async () => {
    const css = await readFile('public/styles/app.css', 'utf8');

    expect(css).toMatch(/\.competition-coverage \.dashboard-information\s*{[^}]*grid-template-columns: minmax\(560px, 640px\)/s);
    expect(css).not.toContain('.coverage-eyebrow');
    expect(css).toContain('@media (max-width: 900px)');
    expect(css).toMatch(/\.dashboard-information\s*{\s*display: block;/);
    expect(css).toContain('.competition-breadcrumb {');
    expect(css).toMatch(/\.has-competition-breadcrumb \.map-stage\s*{\s*inset-block-start: 110px;/);
    expect(css).toContain('.arena-search-results {');
    expect(css).toMatch(/\.has-competition-breadcrumb \.dashboard-info\s*{\s*inset-block-start: auto;/);
    expect(css).toContain('height: 292px;');
    expect(css).toMatch(/@media \(max-width: 900px\)[\s\S]*?\.coverage-table\s*{\s*min-width: 39rem;/);
    expect(css).toMatch(/\.dashboard-info:not\(\.is-expanded\) \.coverage-table-header,\s*\.dashboard-info:not\(\.is-expanded\) \.coverage-pilot-row\s*{\s*grid-template-columns: minmax\(9rem, 1fr\) 5rem;/);
    expect(css).toMatch(/\.dashboard-info:not\(\.is-expanded\) \.coverage-table-header > :nth-child\(n \+ 3\),\s*\.dashboard-info:not\(\.is-expanded\) \.coverage-pilot-row > :nth-child\(n \+ 3\),\s*\.dashboard-info:not\(\.is-expanded\) \.coverage-pilot-row:nth-child\(n \+ 4\)\s*{\s*display: none;/);
    expect(css).toMatch(/\.dashboard-info:not\(\.is-expanded\) \.coverage-leaderboard > \.coverage-table\s*{\s*display: block;\s*min-width: 0;/);
    expect(css).toMatch(/\.dashboard-info\.is-expanded \.dashboard-information\s*{\s*overflow-y: auto;/);
    expect(css).not.toContain('.leaderboard-list');
    expect(css).not.toContain('.leaderboard-row');
  });

  it('anchors the coverage claimant card around its map tap', async () => {
    const css = await readFile('public/styles/app.css', 'utf8');

    expect(css).toMatch(/\.coverage-cell-popup\s*{[^}]*width: max-content;[^}]*transform: translate\(-50%, calc\(-100% - 0\.75rem\)\);/s);
    expect(css).toMatch(/\.coverage-cell-popup\[data-placement='below'\]\s*{\s*transform: translate\(-50%, 0\.75rem\);/);
  });

  it('provides accessible flight-aid controls above the mobile sheet', async () => {
    const css = await readFile('public/styles/app.css', 'utf8');

    expect(css).toMatch(/\.flight-aid-button\s*{[^}]*width: 44px;[^}]*min-height: 44px;/s);
    expect(css).toMatch(/\.flight-aid-button\[aria-pressed='true'\]\s*{[^}]*background: var\(--color-primary-strong\);/s);
    expect(css).toMatch(/\.flight-aid-control\[hidden\]\s*{\s*display: none;/);
    expect(css).toMatch(/\.map-flight-aid-status\s*{[^}]*z-index: 5;/s);
    expect(css).toMatch(/@media \(max-width: 900px\)[\s\S]*?\.map-flight-aid-status\s*{[^}]*bottom: 92px;/);
    expect(css).not.toContain('.map-actions');
  });
});
