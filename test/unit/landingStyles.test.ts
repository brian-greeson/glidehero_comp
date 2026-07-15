import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('landing page stylesheet contract', () => {
  it('defines the branded split layout and responsive stacked layout', async () => {
    const css = await readFile('public/styles/app.css', 'utf8');

    expect(css).toContain("background: #0a3149 url('/landing-territories.webp') center / cover no-repeat");
    expect(css).toContain('.landing { display: grid;');
    expect(css).toContain('.auth-form-panel[hidden] { display: none; }');
    expect(css).toContain('grid-template-columns: minmax(0, 1.68fr) minmax(360px, 1fr)');
    expect(css).toContain('background: linear-gradient(110deg, var(--brand-blue)');
    expect(css).toContain('@media (max-width: 720px)');
    expect(css).toContain('.landing { display: block; }');
    expect(css).toContain('.auth-brand { display: none; }');
    expect(css).toContain('@media (prefers-reduced-motion: reduce)');
    expect(css).not.toContain('.auth-tabs');
  });
});
