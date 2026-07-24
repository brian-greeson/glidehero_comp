import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const profileCss = readFileSync('public/styles/app-ui/profile.css', 'utf8');

describe('profile glider hidden states', () => {
  it('keeps the editor, reset confirmation, and search results hidden when their hidden attribute is set', () => {
    expect(profileCss).toMatch(/\.glider-card__form\[hidden\],[^}]*\.glider-card__form fieldset\[hidden\],[^}]*\.glider-card__results\[hidden\]\s*\{\s*display:\s*none;\s*\}/);
  });
});
