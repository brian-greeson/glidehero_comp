import { describe, expect, it } from 'vitest';
import { hashPassword, verifyPassword } from '../../src/services/passwordService.js';

describe('passwordService', () => {
  it('creates salted, versioned hashes that verify', async () => {
    const first = await hashPassword('correct horse battery staple');
    const second = await hashPassword('correct horse battery staple');
    expect(first).toMatch(/^scrypt\$16384\$8\$1\$64\$/);
    expect(second).not.toBe(first);
    await expect(verifyPassword('correct horse battery staple', first)).resolves.toBe(true);
  });

  it('rejects incorrect passwords and malformed encodings', async () => {
    const encoded = await hashPassword('correct horse battery staple');
    await expect(verifyPassword('incorrect password', encoded)).resolves.toBe(false);
    await expect(verifyPassword('anything', 'not-a-password-encoding')).resolves.toBe(false);
  });
});
