import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('dashboard stylesheet contract', () => {
  it('stacks the desktop leaderboard above stats on the left without changing the mobile flow', async () => {
    const css = await readFile('public/styles/app.css', 'utf8');

    expect(css).toMatch(/\.viewport-stats\s*{\s*grid-column: 1;/);
    expect(css).toMatch(/\.leaderboard-card\s*{\s*grid-column: 1;/);
    expect(css).not.toContain('.leaderboard-card { grid-column: 3;');
    expect(css).toContain('@media (max-width: 900px)');
    expect(css).toMatch(/\.dashboard-information\s*{\s*display: block;/);
    expect(css).toContain('.competition-breadcrumb {');
    expect(css).toMatch(/\.has-competition-breadcrumb \.map-stage\s*{\s*inset-block-start: 110px;/);
    expect(css).toContain('.arena-search-results {');
    expect(css).toMatch(/\.has-competition-breadcrumb \.dashboard-info\s*{\s*inset-block-start: auto;/);
    expect(css).toContain('height: 292px;');
    expect(css).toContain('.leaderboard-list > :nth-child(n + 4)');
  });
});
