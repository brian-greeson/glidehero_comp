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
    expect(css).toContain('.leaderboard-list > :nth-child(n + 4)');
  });

  it('anchors the coverage claimant card around its map tap', async () => {
    const css = await readFile('public/styles/app.css', 'utf8');

    expect(css).toMatch(/\.coverage-cell-popup\s*{[^}]*width: max-content;[^}]*transform: translate\(-50%, calc\(-100% - 0\.75rem\)\);/s);
    expect(css).toMatch(/\.coverage-cell-popup\[data-placement='below'\]\s*{\s*transform: translate\(-50%, 0\.75rem\);/);
  });
});
