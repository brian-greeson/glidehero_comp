import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { createAuthenticatedShellModel } from '../../src/views/authenticated/adapters/shellModel.js';
import { createAuthenticatedPageRenderer } from '../../src/views/authenticated/renderer.js';

describe('Plan page', () => {
  it('renders the passive thermal map, routing priorities, and export formats', async () => {
    const html = await createAuthenticatedPageRenderer()({
      ...createAuthenticatedShellModel({ page: 'plan', user: { displayName: 'Pilot' }, showFooter: false }),
      page: 'plan',
      mapStyleUrl: 'https://maps.example.test/style.json',
      thermalTileUrl: '/v1/thermal/tiles/{z}/{x}/{y}.png',
      defaultRoutingPriority: 'balanced',
    });
    expect(html).toContain('Plan your next flight');
    expect(html).toContain('Routing priority');
    expect(html).toContain('data-plan-priority-mobile');
    expect(html).toContain('data-plan-metrics');
    expect(html).toContain('data-plan-fit-route');
    expect(html).toContain('value="balanced"');
    expect(html).toContain('Main turnpoints');
    expect(html).toContain('Optimized track');
    for (const extension of ['.cup', '.tsk', '.wpt', '.xctsk']) expect(html).toContain(extension);
    expect(html).not.toContain('.gpx');
    expect(html).not.toContain('.kml');
    expect(html).toContain('/v1/thermal/tiles/{z}/{x}/{y}.png');
    expect(html).toContain('/scripts/app-ui/plan.js');
    expect(html).toContain('data-plan-authenticated="true"');
    expect(html).toContain('New Personal cells');
    expect(html).not.toContain('data-plan-auth-dialog');
    expect(html).not.toContain('data-plan-collect-cells');
    expect(html).not.toContain('probability');
    expect(html.match(/data-plan-route-distance/g)).toHaveLength(1);
  });

  it('renders a public shell, personal-cell CTA, and branded account dialog for guests', async () => {
    const html = await createAuthenticatedPageRenderer()({
      page: 'plan',
      title: 'Plan a flight | GlideHero',
      isGuest: true,
      showFooter: false,
      mapStyleUrl: 'https://maps.example.test/style.json',
      thermalTileUrl: '/v1/thermal/tiles/{z}/{x}/{y}.png',
      defaultRoutingPriority: 'thermal',
    });

    expect(html).toContain('data-plan-authenticated="false"');
    expect(html).toContain('Join or sign in');
    expect(html).not.toContain('class="mobile-navigation"');
    expect(html).not.toContain('New Personal cells');
    expect(html).toContain('data-plan-collect-cells');
    expect(html).toContain('Sign in to collect cells');
    expect(html).toContain('data-plan-auth-dialog');
    expect(html).toContain('data-plan-auth-choice');
    expect(html).toContain('data-plan-auth-signin-panel');
    expect(html).toContain('data-plan-auth-signup-panel');
    expect(html.match(/data-plan-auth-signin/g)?.length).toBeGreaterThanOrEqual(2);
    expect(html.match(/data-plan-auth-signup/g)?.length).toBeGreaterThanOrEqual(2);
    expect(html.match(/data-plan-auth-back/g)).toHaveLength(2);
    expect(html).toContain('data-plan-auth-close');
    expect(html).toContain('data-plan-login-form');
    expect(html).toContain('data-plan-signup-form');
    expect(html).toContain('data-plan-login-status');
    expect(html).toContain('data-plan-signup-status');
    expect(html).toContain('action="/login"');
    expect(html).toContain('action="/signup"');
    expect(html).toContain('Track your flights');
    expect(html).toContain('Compete for cells and Arenas');
    expect(html).toContain('Follow pilots and view activity');
    expect(html).toContain('data-plan-export-dialog');
  });

  it('uses a four-column mobile navigation', async () => {
    const css = await readFile('public/styles/app-ui/app.css', 'utf8');
    expect(css).toContain('grid-template-columns: repeat(4, 1fr)');
  });
});
