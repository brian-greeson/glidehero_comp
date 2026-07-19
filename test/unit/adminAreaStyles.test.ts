import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('admin area editor stylesheet contract', () => {
  it('keeps the workspace viewport-bound with a scrollable sidebar', async () => {
    const css = await readFile('public/styles/adminAreaEditor.css', 'utf8');

    expect(css).toMatch(/\.admin-area-body\s*{[^}]*min-width:\s*0;[^}]*overflow:\s*hidden;/s);
    expect(css).toMatch(/\.admin-area-page\s*{[^}]*height:\s*100svh;[^}]*min-height:\s*0;/s);
    expect(css).toMatch(/\.admin-area-sidebar\s*{[^}]*overflow-y:\s*auto;/s);
    expect(css).toMatch(/\.admin-area-card\s*{[^}]*display:\s*block;/s);
    expect(css).toContain('align-content: start;');
    expect(css).toContain('@media (max-width: 900px)');
  });

  it('uses compact editor controls and bounded list scrolling', async () => {
    const css = await readFile('public/styles/adminAreaEditor.css', 'utf8');

    expect(css).toMatch(/\.admin-area-card input, \.admin-area-card select, \.admin-area-search input\s*{[^}]*min-height:\s*35px;/s);
    expect(css).toMatch(/\.admin-area-list-table\s*{[^}]*max-height:/s);
    expect(css).toMatch(/\.admin-area-form-actions button:disabled\s*{[^}]*opacity:\s*\.65;[^}]*cursor:\s*not-allowed;/s);
    expect(css).toContain('.admin-area-list-empty');
  });

  it('uses large map drawing controls', async () => {
    const css = await readFile('public/styles/adminAreaEditor.css', 'utf8');

    expect(css).toMatch(/\.admin-area-map \.maplibregl-ctrl-group button\s*{[^}]*width:\s*44px;[^}]*height:\s*44px;/s);
    expect(css).toMatch(/\.admin-area-map \.mapbox-gl-draw_ctrl-draw-btn\s*{[^}]*background-size:\s*26px 26px;/s);
  });
});
