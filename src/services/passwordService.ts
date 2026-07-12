import { promisify } from 'node:util';
import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';

const scrypt = promisify(scryptCallback);
const parameters = { N: 16_384, r: 8, p: 1, keyLength: 64 } as const;

function decodeBase64Url(value: string): Buffer | undefined {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) return undefined;

  const decoded = Buffer.from(value, 'base64url');
  return decoded.toString('base64url') === value ? decoded : undefined;
}

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
  const fields = encoded.split('$');
  if (fields.length !== 7) return false;

  const [algorithm, n, r, p, keyLength, saltText, keyText] = fields;
  if (algorithm !== 'scrypt' || !n || !r || !p || !keyLength || !saltText || !keyText) return false;

  const salt = decodeBase64Url(saltText);
  const expected = decodeBase64Url(keyText);
  const length = Number(keyLength);
  if (
    !salt ||
    !expected ||
    Number(n) !== parameters.N ||
    Number(r) !== parameters.r ||
    Number(p) !== parameters.p ||
    length !== parameters.keyLength ||
    salt.length !== 16 ||
    expected.length !== length
  ) {
    return false;
  }

  try {
    const actual = (await scrypt(password, salt, length)) as Buffer;
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}
