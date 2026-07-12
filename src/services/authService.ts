import { createHash, randomBytes } from 'node:crypto';
import { eq } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { appSessions, profiles, userPasswords, users } from '../db/schema.js';
import { hashPassword, verifyPassword } from './passwordService.js';

export type AuthenticatedUser = {
  userId: string;
  email: string;
  displayName: string;
  territoryColor: string;
  sessionId: string;
};

export type BrowserSession = {
  token: string;
  expiresAt: Date;
  user: AuthenticatedUser;
};

export type SignupInput = { email: string; password: string; displayName?: string };
export type LoginInput = { email: string; password: string };
export type AuthFailureCode = 'duplicate_email' | 'invalid_credentials';

export class AuthFailure extends Error {
  constructor(public readonly code: AuthFailureCode) {
    super(code);
  }
}

export interface AuthService {
  signup(input: SignupInput): Promise<BrowserSession>;
  login(input: LoginInput): Promise<BrowserSession>;
  authenticate(token: string): Promise<AuthenticatedUser | null>;
  logout(token: string): Promise<void>;
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function tokenDigest(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function newToken(): string {
  return randomBytes(32).toString('base64url');
}

function isUniqueViolation(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  if ('code' in error && error.code === '23505') return true;
  return 'cause' in error && isUniqueViolation(error.cause);
}

export function createAuthService(
  database: Database,
  options: { sessionTtlSeconds: number },
): AuthService {
  const expiresAt = () => new Date(Date.now() + options.sessionTtlSeconds * 1000);

  return {
    async signup(input) {
      const email = normalizeEmail(input.email);
      const passwordHash = await hashPassword(input.password);
      const token = newToken();
      const expiry = expiresAt();
      const displayName = input.displayName?.trim() || email.split('@')[0] || 'Pilot';

      try {
        return await database.transaction(async (tx) => {
          const [user] = await tx.insert(users).values({ email }).returning();
          if (!user) throw new Error('User insert returned no row.');

          await tx.insert(userPasswords).values({ userId: user.id, passwordHash });
          const [profile] = await tx
            .insert(profiles)
            .values({ userId: user.id, displayName })
            .returning();
          if (!profile) throw new Error('Profile insert returned no row.');

          const [session] = await tx
            .insert(appSessions)
            .values({ userId: user.id, tokenHash: tokenDigest(token), expiresAt: expiry })
            .returning();
          if (!session) throw new Error('Session insert returned no row.');

          return {
            token,
            expiresAt: expiry,
            user: {
              userId: user.id,
              email: user.email,
              displayName: profile.displayName,
              territoryColor: profile.territoryColor,
              sessionId: session.sessionId,
            },
          };
        });
      } catch (error) {
        if (isUniqueViolation(error)) throw new AuthFailure('duplicate_email');
        throw error;
      }
    },

    async login(input) {
      const account = await database.query.users.findFirst({
        where: { email: normalizeEmail(input.email) },
        with: { password: true, profile: true },
      });
      if (!account?.password || !account.profile) throw new AuthFailure('invalid_credentials');
      if (!(await verifyPassword(input.password, account.password.passwordHash))) {
        throw new AuthFailure('invalid_credentials');
      }

      const token = newToken();
      const expiry = expiresAt();
      const now = new Date();
      const [session] = await database.transaction(async (tx) => {
        await tx.update(users).set({ lastLogin: now, updatedAt: now }).where(eq(users.id, account.id));
        return tx
          .insert(appSessions)
          .values({ userId: account.id, tokenHash: tokenDigest(token), expiresAt: expiry })
          .returning();
      });
      if (!session) throw new Error('Session insert returned no row.');

      return {
        token,
        expiresAt: expiry,
        user: {
          userId: account.id,
          email: account.email,
          displayName: account.profile.displayName,
          territoryColor: account.profile.territoryColor,
          sessionId: session.sessionId,
        },
      };
    },

    async authenticate(token) {
      if (!token) return null;
      const session = await database.query.appSessions.findFirst({
        where: { tokenHash: tokenDigest(token), expiresAt: { gt: new Date() } },
        with: { user: { with: { profile: true } } },
      });
      if (!session?.user?.profile) return null;
      return {
        userId: session.user.id,
        email: session.user.email,
        displayName: session.user.profile.displayName,
        territoryColor: session.user.profile.territoryColor,
        sessionId: session.sessionId,
      };
    },

    async logout(token) {
      if (!token) return;
      await database.delete(appSessions).where(eq(appSessions.tokenHash, tokenDigest(token)));
    },
  };
}
