import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('dashboard stylesheet contract', () => {
  it('stacks the desktop leaderboard above stats on the left without changing the mobile flow', async () => {
    const css = await readFile('public/styles/app.css', 'utf8');

    expect(css).toContain('.viewport-stats { grid-column: 1; }');
    expect(css).toContain('.leaderboard-card { grid-column: 1; }');
    expect(css).not.toContain('.leaderboard-card { grid-column: 3;');
    expect(css).toContain('@media (max-width: 900px)');
    expect(css).toContain('.dashboard-information { display: block;');
    expect(css).toContain('.competition-breadcrumb {');
    expect(css).toContain('.has-competition-breadcrumb .map-stage { inset-block-start: 110px; }');
    expect(css).toContain('.arena-search-results {');
    expect(css).toContain('.has-competition-breadcrumb .dashboard-info { inset-block-start: auto; }');
  });
});
