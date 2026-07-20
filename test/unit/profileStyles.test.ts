import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('pilot profile styles', () => {
  it('keeps the profile summary responsive and keyboard accessible', async () => {
    const css = await readFile('public/styles/profile.css', 'utf8');

    expect(css).toMatch(/\.profile-summary\s*{[^}]*display:\s*grid;[^}]*grid-template-columns:\s*repeat\(3/s);
    expect(css).toMatch(/\.profile-summary-card\s*{[^}]*border:\s*1px solid/);
    expect(css).toMatch(/\.profile-back-link:focus-visible\s*{[^}]*outline:\s*3px solid/);
    expect(css).toContain('@media (max-width: 700px)');
    expect(css).toContain('@media (max-width: 440px)');
  });
});
