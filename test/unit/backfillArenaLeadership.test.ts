import { describe, expect, it } from 'vitest';
import { parseArenaLeadershipBackfillArgs } from '../../src/scripts/backfillArenaLeadership.js';

describe('arena leadership backfill arguments', () => {
  it('defaults to dry-run', () => expect(parseArenaLeadershipBackfillArgs([])).toEqual({ apply: false, help: false }));
  it('accepts apply and help', () => {
    expect(parseArenaLeadershipBackfillArgs(['--apply'])).toEqual({ apply: true, help: false });
    expect(parseArenaLeadershipBackfillArgs(['--help'])).toEqual({ apply: false, help: true });
  });
  it('rejects duplicate, conflicting, and unknown flags', () => {
    expect(() => parseArenaLeadershipBackfillArgs(['--apply', '--apply'])).toThrow(/Duplicate/);
    expect(() => parseArenaLeadershipBackfillArgs(['--apply', '--dry-run'])).toThrow(/cannot/);
    expect(() => parseArenaLeadershipBackfillArgs(['--wat'])).toThrow(/Unknown/);
  });
});
