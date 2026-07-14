import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('onboarding stylesheet contract', () => {
  it('defines responsive, accessible, active-only animation behavior', async () => {
    const css = await readFile('public/styles/app.css', 'utf8');

    expect(css).toContain('.onboarding-dialog');
    expect(css).toContain('max-height: calc(100dvh - 2rem)');
    expect(css).toContain('.onboarding-pages { overflow-y: auto; }');
    expect(css).toContain('min-height: 44px');
    expect(css).toContain('.icon-button[data-onboarding-trigger] { width: 44px; min-height: 44px; }');
    expect(css).toContain('.onboarding-dialog :focus-visible');
    expect(css).toContain('@media (max-width: 699px)');
    expect(css).toContain('@media (min-width: 700px)');
    expect(css).toContain('[data-onboarding-step][data-active] .onboarding-flight-track');
    expect(css).toContain('[data-onboarding-step][data-active] .onboarding-loop-track');
    expect(css).toContain('@media (prefers-reduced-motion: reduce)');
    expect(css).toContain('stroke-dashoffset: 0');
    expect(css).toContain('fill: var(--territory-color)');
  });
});
