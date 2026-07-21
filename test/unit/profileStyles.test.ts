import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('pilot profile styles', () => {
  it('keeps achievement cards responsive and keyboard accessible', async () => {
    const css = await readFile('public/styles/profile.css', 'utf8');

    expect(css).toMatch(/\.achievement-summary\s*{[^}]*display:\s*grid;[^}]*grid-template-columns:\s*repeat\(3/s);
    expect(css).toMatch(/\.achievement-help\s*{[^}]*display:\s*grid/);
    expect(css).toMatch(/\.profile-achievement-list\s*{[^}]*grid-template-columns:\s*repeat\(3/s);
    expect(css).toMatch(/\.profile-back-link:focus-visible\s*{[^}]*outline:\s*3px solid/);
    expect(css).toContain('.profile-achievement-list,');
    expect(css).toContain('[data-profile-list][data-collapsible]:not([data-expanded]) > li:nth-child(n + 4)');
    expect(css).toMatch(/\.profile-list-toggle\[hidden\]\s*{[^}]*display:\s*none/);
    expect(css).toMatch(/\.profile-list-toggle:focus-visible\s*{[^}]*outline:\s*3px solid/);
    expect(css).toContain('.achievement-progress-value progress');
    expect(css).toMatch(/\.achievement-progress-list\s*{[^}]*display:\s*grid;[^}]*gap:/s);
    expect(css).toContain('.achievement-badge--milestone');
    expect(css).toMatch(/\.profile-flight-stats\s*{/);
    expect(css).toContain('.profile-empty-state');
    expect(css).toContain('.profile-section-heading');
    expect(css).toContain('@media (max-width: 700px)');
    expect(css).toContain('@media (max-width: 440px)');
    expect(css).toContain('@media (prefers-reduced-motion: reduce)');
  });
});
