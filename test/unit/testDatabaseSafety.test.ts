import { describe, expect, it } from 'vitest';
import { validateDisposableTestDatabase } from '../integration/database.js';

describe('disposable integration database guard', () => {
  it('accepts explicitly test-named databases', () => {
    expect(validateDisposableTestDatabase('postgresql://localhost/glidehero-test')).toBe('glidehero-test');
    expect(validateDisposableTestDatabase('postgresql://localhost/glidehero_worktree_test')).toBe('glidehero_worktree_test');
  });

  it('rejects development and production database names before destructive work', () => {
    expect(() => validateDisposableTestDatabase('postgresql://localhost/glidehero')).toThrow('non-test database');
    expect(() => validateDisposableTestDatabase('postgresql://localhost/glidehero-production')).toThrow('non-test database');
  });
});
