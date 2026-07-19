import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('admin user management stylesheet', () => {
  it('uses a two-panel desktop workspace and stacks it on small screens', async () => {
    const css = await readFile('public/styles/adminUserManagement.css', 'utf8');
    expect(css).toMatch(/\.admin-user-workspace\s*{[^}]*grid-template-columns:/s);
    expect(css).toMatch(/@media \(max-width: 820px\)[\s\S]*\.admin-user-workspace\s*{[^}]*grid-template-columns:\s*1fr;/);
    expect(css).toMatch(/\.admin-user-results\s*{[^}]*overflow-y:\s*auto;/s);
  });
});
