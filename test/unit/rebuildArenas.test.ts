import { describe, expect, it } from 'vitest';
import { parseRebuildArgs } from '../../src/scripts/rebuildArenas.js';

describe('rebuild Arena CLI flags', () => {
  it('defaults to a dry-run with checked-in source paths', () => {
    const options = parseRebuildArgs([]);
    expect(options.apply).toBe(false);
    expect(options.countryPath).toMatch(/ingest\/countries\.geojson$/);
    expect(options.statePath).toMatch(/ingest\/states\.geojson$/);
    expect(options.launchPath).toMatch(/ingest\/launches\.sql$/);
  });

  it('requires both mutation confirmation flags', () => {
    expect(() => parseRebuildArgs(['--apply'])).toThrow('--confirm-delete-all-arenas');
    expect(() => parseRebuildArgs(['--confirm-delete-all-arenas'])).toThrow('--apply');
    expect(() => parseRebuildArgs(['--apply', '--dry-run', '--confirm-delete-all-arenas'])).toThrow('cannot be used');
  });

  it('rejects unknown and partial flags', () => {
    expect(() => parseRebuildArgs(['--confirm'])).toThrow('Unknown rebuild flag');
    expect(() => parseRebuildArgs(['--apply', '--confirm-delete-all-arenas', '--wat'])).toThrow('Unknown rebuild flag');
    expect(() => parseRebuildArgs(['--apply', '--apply', '--confirm-delete-all-arenas'])).toThrow('Duplicate --apply');
    expect(() => parseRebuildArgs(['--dry-run', '--dry-run'])).toThrow('Duplicate --dry-run');
    expect(() => parseRebuildArgs(['--confirm-delete-all-arenas', '--confirm-delete-all-arenas'])).toThrow('Duplicate --confirm-delete-all-arenas');
  });

  it('accepts help only by itself', () => {
    expect(() => parseRebuildArgs(['--help'])).not.toThrow();
    expect(() => parseRebuildArgs(['--help', '--dry-run'])).toThrow('cannot be combined');
    expect(() => parseRebuildArgs(['--help', '--apply', '--confirm-delete-all-arenas'])).toThrow('cannot be combined');
    expect(() => parseRebuildArgs(['--help', 'countries.geojson'])).toThrow('cannot be combined');
    expect(() => parseRebuildArgs(['--help', '--help'])).toThrow('Duplicate --help');
  });
});
