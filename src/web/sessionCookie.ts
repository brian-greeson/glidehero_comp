export type SessionCookie = {
  read(header: string | undefined): string | null;
  set(token: string): string;
  clear(): string;
};

export function createSessionCookie(options: {
  name: string;
  secure: boolean;
  maxAgeSeconds: number;
}): SessionCookie {
  const attributes = `Path=/; HttpOnly; SameSite=Lax${options.secure ? '; Secure' : ''}`;

  return {
    read(header) {
      if (!header) return null;

      for (const part of header.split(';')) {
        const separator = part.indexOf('=');
        if (separator < 0) continue;
        const name = part.slice(0, separator).trim();
        if (name === options.name) {
          try {
            return decodeURIComponent(part.slice(separator + 1).trim());
          } catch {
            return null;
          }
        }
      }

      return null;
    },
    set(token) {
      return `${options.name}=${encodeURIComponent(token)}; Max-Age=${options.maxAgeSeconds}; ${attributes}`;
    },
    clear() {
      return `${options.name}=; Max-Age=0; ${attributes}`;
    },
  };
}
