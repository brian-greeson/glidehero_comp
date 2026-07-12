import { promisify } from 'node:util';
import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';

const scrypt = promisify(scryptCallback);
const parameters = { N: 16_384, r: 8, p: 1, keyLength: 64 } as const;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = (await scrypt(password, salt, parameters.keyLength)) as Buffer;

  return [
    'scrypt',
    parameters.N,
    parameters.r,
    parameters.p,
    parameters.keyLength,
    salt.toString('base64url'),
    key.toString('base64url'),
  ].join('$');
}

export async function verifyPassword(password: string, encoded: string): Promise<boolean> {
  const [algorithm, n, r, p, keyLength, saltText, keyText] = encoded.split('$');
  if (algorithm !== 'scrypt' || !n || !r || !p || !keyLength || !saltText || !keyText) return false;

  const expected = Buffer.from(keyText, 'base64url');
  const length = Number(keyLength);
  if (
    Number(n) !== parameters.N ||
    Number(r) !== parameters.r ||
    Number(p) !== parameters.p ||
    length !== parameters.keyLength ||
    expected.length !== length
  ) {
    return false;
  }

  try {
    const actual = (await scrypt(password, Buffer.from(saltText, 'base64url'), length)) as Buffer;
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}
