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
      savedPlans: [{ planId: 'plan-1', name: 'Boulder triangle', updatedAt: '2026-08-16T12:00:00.000Z', updatedAtLabel: 'Aug 16, 2026', href: '/plan/plan-1' }],
      activePlan: null,
      groupOptions: [],
      planBootstrapJson: JSON.stringify({ savedPlans: [], activePlan: null }),
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
    expect(html).toContain('data-plan-bootstrap="{&quot;savedPlans&quot;:[]');
    expect(html).toContain('data-plan-name');
    expect(html).toContain('data-plan-save');
    expect(html).toContain('data-plan-new');
    expect(html).toContain('data-plan-delete-saved-id="plan-1"');
    expect(html).toContain('aria-label="Delete Boulder triangle"');
    expect(html).toContain('Boulder triangle');
    expect(html).toContain('/plan/plan-1');
    expect(html).not.toContain('Direct cells');
    expect(html).not.toContain('Enclosed cells');
    expect(html).not.toContain('Personal cells');
    expect(html).not.toContain('data-plan-auth-dialog');
    expect(html).not.toContain('data-plan-collect-cells');
    expect(html).not.toContain('probability');
    expect(html.match(/data-plan-route-distance/g)).toHaveLength(1);
  });

  it('renders a public shell and branded account dialog for guest exports', async () => {
    const html = await createAuthenticatedPageRenderer()({
      page: 'plan',
      title: 'Plan a flight | GlideHero',
      isGuest: true,
      showFooter: false,
      mapStyleUrl: 'https://maps.example.test/style.json',
      thermalTileUrl: '/v1/thermal/tiles/{z}/{x}/{y}.png',
      defaultRoutingPriority: 'thermal',
      savedPlans: [],
      activePlan: null,
      groupOptions: [],
      planBootstrapJson: JSON.stringify({ savedPlans: [], activePlan: null }),
    });

    expect(html).toContain('data-plan-authenticated="false"');
    expect(html).toContain('Join or sign in');
    expect(html).not.toContain('class="mobile-navigation"');
    expect(html).not.toContain('collect Personal cells');
    expect(html).not.toContain('data-plan-collect-cells');
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

  it('renders mobile-first owner sharing controls for an active Plan', async () => {
    const plan = {
      planId: 'plan-1', ownerUserId: 'owner-1', name: 'Boulder triangle', turnpoints: [], generatedRoute: null,
      routingPriority: 'balanced', visibility: 'group', sharedGroupId: 'group-2', isOwner: true,
      createdAt: '2026-08-15T12:00:00.000Z', updatedAt: '2026-08-16T12:00:00.000Z',
    } as any;
    const html = await createAuthenticatedPageRenderer()({
      ...createAuthenticatedShellModel({ page: 'plan', user: { displayName: 'Pilot' }, showFooter: false }),
      page: 'plan', mapStyleUrl: 'style', thermalTileUrl: 'tiles', defaultRoutingPriority: 'balanced',
      savedPlans: [], activePlan: plan, groupOptions: [{ id: 'group-2', name: 'Front Range Pilots' }],
      planBootstrapJson: JSON.stringify({ savedPlans: [], activePlan: plan, groupOptions: [] }),
    });

    expect(html).toContain('class="plan-save-sheet app-bottom-sheet is-partial"');
    expect(html).toContain('data-map-sheet');
    expect(html).toContain('data-map-sheet-handle');
    expect(html).toContain('class="plan-save-sheet__content app-bottom-sheet__content"');
    expect(html).toContain('name="plan-save-share" data-plan-save-section open');
    expect(html).toContain('<strong>Save</strong>');
    expect(html).toContain('name="plan-save-share" data-plan-share-section>');
    expect(html).toContain('<strong>Share</strong>');
    expect(html).toContain('Anyone with the link');
    expect(html).toContain('Share to a Group');
    expect(html).toContain('Front Range Pilots');
    expect(html).toContain('data-plan-sharing-copy');
    expect(html).toContain('value="group" data-plan-visibility checked');
  });

  it('renders a shared Plan as read-only without owner controls', async () => {
    const plan = {
      planId: 'plan-1', ownerUserId: 'owner-1', name: 'Boulder triangle', turnpoints: [], generatedRoute: null,
      routingPriority: 'balanced', visibility: 'link', sharedGroupId: null, isOwner: false,
      createdAt: '2026-08-15T12:00:00.000Z', updatedAt: '2026-08-16T12:00:00.000Z',
    } as any;
    const html = await createAuthenticatedPageRenderer()({
      page: 'plan', title: 'Shared Plan', isGuest: true, showFooter: false,
      mapStyleUrl: 'style', thermalTileUrl: 'tiles', defaultRoutingPriority: 'balanced', savedPlans: [], activePlan: plan,
      groupOptions: [], planBootstrapJson: JSON.stringify({ savedPlans: [], activePlan: plan, groupOptions: [] }),
    });

    expect(html).toContain('data-plan-read-only="true"');
    expect(html).toContain('Read-only');
    expect(html).toContain('Shared with you by link');
    expect(html).not.toContain('data-plan-share-sheet');
    expect(html).not.toContain('data-plan-name');
    expect(html).not.toContain('data-plan-save');
    expect(html).not.toContain('data-plan-delete-saved-id');
    expect(html).toContain('data-plan-fit-route');
    expect(html).toContain('data-plan-export-open');
  });

  it('uses a four-column mobile navigation', async () => {
    const css = await readFile('public/styles/app-ui/app.css', 'utf8');
    expect(css).toContain('grid-template-columns: repeat(4, 1fr)');
  });

  it('keeps mobile drawer content intrinsically sized and touch-scrollable', async () => {
    const css = await readFile('public/styles/app-ui/plan.css', 'utf8');
    expect(css).toContain('grid-auto-rows: max-content');
    expect(css).toContain('overflow-y: scroll');
    expect(css).toContain('touch-action: pan-y');
    expect(css).toContain('overscroll-behavior-y: contain');
    expect(css).toContain('.plan-save-sheet__content > * { min-height: max-content; }');
  });
});
