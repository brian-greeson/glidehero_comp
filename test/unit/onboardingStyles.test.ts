import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('onboarding stylesheet contract', () => {
  it('defines responsive, accessible, active-only animation behavior', async () => {
    const css = await readFile('public/styles/app.css', 'utf8');
    const template = await readFile('src/views/components/onboarding.vto', 'utf8');

    expect(css).toContain('.onboarding-dialog');
    expect(css).toContain('max-height: calc(100dvh - 2rem)');
    expect(css).toMatch(/\.onboarding-pages\s*{\s*overflow-y: auto;/);
    expect(css).toContain('min-height: 44px');
    expect(css).toContain('.account-help-button');
    expect(css).toContain('.onboarding-dialog :focus-visible');
    expect(css).toContain('@media (max-width: 699px)');
    expect(css).toContain('@media (min-width: 700px)');
    expect(css).toContain('[data-onboarding-step][data-active] .onboarding-flight-track');
    expect(css).toContain('[data-onboarding-step][data-active] .onboarding-flight-claim-mask-track');
    expect(css).toContain('[data-onboarding-step][data-active] .onboarding-flight-glider');
    expect(css).toContain('@keyframes onboarding-flight-glider');
    expect(css).toContain('[data-onboarding-step][data-active] .onboarding-loop-track');
    expect(css).toContain('[data-onboarding-step][data-active] .onboarding-loop-claim-cell');
    expect(css).toContain('@keyframes onboarding-loop-claim');
    expect(css).toContain('[data-onboarding-step][data-active] .onboarding-square-track.onboarding-orange-square');
    expect(css).toContain('@keyframes onboarding-orange-square-draw');
    expect(css).toContain('@keyframes onboarding-blue-square-draw');
    expect(css).toContain('@keyframes onboarding-orange-score');
    expect(css).toContain('@keyframes onboarding-blue-score');
    expect(css).toContain('[data-onboarding-step][data-active] .onboarding-globe-scene');
    expect(css).toContain('@keyframes onboarding-globe-zoom');
    expect(css).toContain('@keyframes onboarding-local-zoom');
    expect(css).toContain('@keyframes onboarding-arena-claim-cells');
    expect(css).toContain('@keyframes onboarding-outside-claims');
    expect(css).toContain('.onboarding-step.onboarding-step-text-only');
    expect(css).toContain('@media (prefers-reduced-motion: reduce)');
    expect(css).toContain('stroke-dashoffset: 0');
    expect(css).toContain('fill: var(--territory-color)');
    expect(css).toMatch(/prefers-reduced-motion: reduce[\s\S]*\.onboarding-globe-scene,[\s\S]*animation: none;/);
    expect(template).toContain('mask="url(#onboarding-flight-claim-mask)"');
    expect(template.match(/class="onboarding-claim-cell claim-\d+"/g)).toHaveLength(11);
    for (const [x, y] of [
      [11, 171],
      [51, 171],
      [51, 131],
      [91, 131],
      [131, 131],
      [131, 91],
      [131, 51],
      [171, 51],
      [211, 51],
      [251, 51],
      [251, 11],
    ]) {
      expect(template).toContain(`x="${x}" y="${y}" width="38" height="38"`);
    }
    expect(template).toContain('class="onboarding-glider onboarding-flight-glider"');
  });
});
