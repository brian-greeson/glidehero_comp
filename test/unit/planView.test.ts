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
    expect(html).toContain('value="balanced"');
    expect(html).toContain('Main turnpoints');
    expect(html).toContain('Optimized track');
    for (const extension of ['.cup', '.tsk', '.wpt', '.xctsk']) expect(html).toContain(extension);
    expect(html).not.toContain('.gpx');
    expect(html).not.toContain('.kml');
    expect(html).toContain('/v1/thermal/tiles/{z}/{x}/{y}.png');
    expect(html).toContain('/scripts/app-ui/plan.js');
    expect(html).not.toContain('probability');
  });

  it('uses a five-column mobile navigation', async () => {
    const css = await readFile('public/styles/app-ui/app.css', 'utf8');
    expect(css).toContain('grid-template-columns: repeat(5, 1fr)');
  });
});
