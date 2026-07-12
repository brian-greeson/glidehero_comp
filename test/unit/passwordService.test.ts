import { scryptSync } from 'node:crypto';
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

  it('rejects encodings with extra fields', async () => {
    const password = 'correct horse battery staple';
    const encoded = await hashPassword(password);

    await expect(verifyPassword(password, `${encoded}$junk`)).resolves.toBe(false);
  });

  it('rejects non-canonical salt text', async () => {
    const password = 'correct horse battery staple';
    const encoded = await hashPassword(password);
    const fields = encoded.split('$');
    fields[5] = `${fields[5]}!`;

    await expect(verifyPassword(password, fields.join('$'))).resolves.toBe(false);
  });

  it('rejects non-canonical key text', async () => {
    const password = 'correct horse battery staple';
    const encoded = await hashPassword(password);
    const fields = encoded.split('$');
    fields[6] = `${fields[6]}!`;

    await expect(verifyPassword(password, fields.join('$'))).resolves.toBe(false);
  });

  it('rejects salts that are not exactly 16 bytes', async () => {
    const password = 'correct horse battery staple';
    const encoded = await hashPassword(password);
    const fields = encoded.split('$');
    const shortSalt = Buffer.from(fields[5]!, 'base64url').subarray(0, 15);
    fields[5] = shortSalt.toString('base64url');
    fields[6] = scryptSync(password, shortSalt, 64).toString('base64url');

    await expect(verifyPassword(password, fields.join('$'))).resolves.toBe(false);
  });
});
