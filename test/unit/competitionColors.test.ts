import { describe, expect, it } from 'vitest';

// The browser asset intentionally remains JavaScript; this test exercises its public module API.
// @ts-expect-error TypeScript does not emit or typecheck files under public/.
import { COMPETITION_COLOR_PALETTE } from '../../public/scripts/competitionColors.js';

describe('competition color palette', () => {
  it('provides 25 distinct hex colors', () => {
    expect(COMPETITION_COLOR_PALETTE).toHaveLength(25);
    expect(new Set(COMPETITION_COLOR_PALETTE).size).toBe(25);
    expect(COMPETITION_COLOR_PALETTE.every((color: string) => /^#[0-9A-F]{6}$/.test(color))).toBe(true);
  });
});
