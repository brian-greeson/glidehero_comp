import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('landing page stylesheet contract', () => {
  it('defines the branded split layout and responsive stacked layout', async () => {
    const css = await readFile('public/styles/app.css', 'utf8');

    expect(css).toContain("background: var(--color-logo-navy) url('/landing-territories.webp') center / cover no-repeat");
    expect(css).toMatch(/\.landing\s*{\s*display: grid;/);
    expect(css).toMatch(/\.auth-form-panel\[hidden\]\s*{\s*display: none;/);
    expect(css).toContain('grid-template-columns: minmax(0, 1.68fr) minmax(360px, 1fr)');
    expect(css).toContain('background: linear-gradient(110deg, var(--color-primary-strong)');
    expect(css).toContain('@media (max-width: 720px)');
    expect(css).toMatch(/\.landing\s*{\s*display: block;/);
    expect(css).toMatch(/\.auth-brand\s*{\s*display: none;/);
    expect(css).toContain('@media (prefers-reduced-motion: reduce)');
    expect(css).not.toContain('.auth-tabs');
  });
});
