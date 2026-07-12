import { describe, expect, it } from 'vitest';
import { createSessionCookie } from '../../src/web/sessionCookie.js';

describe('sessionCookie', () => {
  it('uses HTTP-only same-site local attributes', () => {
    const cookie = createSessionCookie({
      name: 'glidehero_session',
      secure: false,
      maxAgeSeconds: 604800,
    });
    expect(cookie.set('token-value')).toBe(
      'glidehero_session=token-value; Max-Age=604800; Path=/; HttpOnly; SameSite=Lax',
    );
    expect(cookie.clear()).toBe(
      'glidehero_session=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax',
    );
  });

  it('adds Secure in production and reads a named cookie', () => {
    const cookie = createSessionCookie({
      name: 'glidehero_session',
      secure: true,
      maxAgeSeconds: 604800,
    });
    expect(cookie.set('abc')).toContain('; Secure');
    expect(cookie.read('theme=dark; glidehero_session=abc; locale=en')).toBe('abc');
    expect(cookie.read(undefined)).toBeNull();
  });

  it('encodes and decodes token values', () => {
    const cookie = createSessionCookie({
      name: 'glidehero_session',
      secure: false,
      maxAgeSeconds: 604800,
    });
    expect(cookie.set('token value/with=symbols')).toContain(
      'glidehero_session=token%20value%2Fwith%3Dsymbols;',
    );
    expect(cookie.read('glidehero_session=token%20value%2Fwith%3Dsymbols')).toBe(
      'token value/with=symbols',
    );
  });
});
