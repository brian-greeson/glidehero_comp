import { createRemoteJWKSet, JWK, jwtVerify, SignJWT } from 'jose';
import { eq } from 'drizzle-orm';
import { KeyObject, randomBytes, randomUUID, webcrypto } from 'node:crypto';
import { db } from '../db/client.js';
import { appSessions, profiles, users } from '../db/schema.js';
import { config } from '../config.js';
import { ApiError, invalidRequest, notFound, serverError, unauthorized } from '../domain/errors.js';
import type { UserRow } from '../db/types.js';
import { ProfileDTO } from '../dto/profileDTO.js';
import { toProfileDTO } from '../serializers/profileSerializer.js';
import { AccountDTO, toAccountDTO } from '../serializers/userSerializer.js';

const appleJwks = createRemoteJWKSet(new URL('https://appleid.apple.com/auth/keys'));
const jwtSecret = new TextEncoder().encode(config.jwt.secret);
const refreshSecret = new TextEncoder().encode(config.jwt.refreshSecret);
const accessTokenTtlSec = 24 * 60 * 60;
const refreshTokenTtlSec = 7 * 24 * 60 * 60;

type LoginResponse = {
  accessToken: string;
  refreshToken: string;
  tokenType: 'Bearer';
  expiresAt: string;
  profile: ProfileDTO;
};

type SignupResponse = {
  user: AccountDTO;
  profile: ProfileDTO;
};
export type AuthUser = {
  id: string;
  appleSubject: string | null;
  email: string | null;
  lastLogin: Date;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
  profile: {
    id: string;
    createdAt: Date;
    updatedAt: Date;
    deletedAt: Date | null;
    userId: string | null;
    displayName: string;
    handedness: string | null;
    avatarUrl: string | null;
    createdByUserId: string | null;
    claimedAt: Date | null;
  };
};
/**
 *
 * @param input
 * Login with apple verification
 * @returns
 */
export async function exchangeAppleCredentials(input: {
  identityToken: string;
  authorizationCode: string;
  name?: string;
}): Promise<LoginResponse> {
  const appleClaims = await verifyAppleIdentityToken(input.identityToken);
  const appleSubject = appleClaims.sub;
  const email: string = (appleClaims.email as string) ?? '';
  const displayName =
    input.name && input.name.trim() != ''
      ? input.name.trim()
      : 'Player_' + randomBytes(3).toString('hex');
  if (!appleSubject) {
    throw unauthorized('Apple identity token is missing a subject.');
  }
  const existing = await db.query.users.findFirst({
    where: { appleSubject },
  });

  const now = new Date();
  let user: UserRow | undefined;
  let profile: ProfileDTO | undefined;

  if (existing) {
    if (existing.email !== email) {
      [user] = await db
        .update(users)
        .set({
          email,
          lastLogin: now,
          updatedAt: now,
        })
        .where(eq(users.id, existing.id))
        .returning();
    } else {
      [user] = await db
        .update(users)
        .set({
          lastLogin: now,
        })
        .where(eq(users.id, existing.id))
        .returning();
    }
  } else {
    const result = await db.transaction(async (tx) => {
      const [createdUser] = await tx
        .insert(users)
        .values({
          appleSubject,
          email,
        })
        .returning();

      if (!createdUser) {
        throw new Error('Failed to create user account.');
      }

      const [createdProfile] = await tx
        .insert(profiles)
        .values({
          userId: createdUser.id,
          displayName,
          claimedAt: now,
        })
        .returning();

      if (!createdProfile) {
        throw new Error('Failed to create user profile.');
      }

      return { user: createdUser, profile: createdProfile };
    });

    user = result.user;
    profile = toProfileDTO(result.profile);
  }

  if (!user) {
    throw new Error('Failed to upsert user account.');
  }
  profile ??= await getRequiredUserProfile(user.id);

  const expiresAt = new Date(Date.now() + accessTokenTtlSec * 1000);
  const refreshExpiresAt = new Date(Date.now() + refreshTokenTtlSec * 1000);
  const [session] = await db.insert(appSessions).values({ userId: user.id, expiresAt }).returning();

  if (!session) {
    throw new Error('Failed to create app session.');
  }

  return {
    accessToken: await signToken(user.id, session.sessionId, expiresAt, jwtSecret),
    refreshToken: await signToken(user.id, session.sessionId, refreshExpiresAt, refreshSecret),
    tokenType: 'Bearer',
    expiresAt: expiresAt.toISOString(),
    profile,
  };
}

export async function authenticateAccessToken(accessToken: string): Promise<AuthUser> {
  try {
    const verified = await jwtVerify(accessToken, jwtSecret, {
      issuer: config.jwt.issuer,
      audience: config.jwt.audience,
    });
    const userId = verified.payload.sub;
    const sessionId = verified.payload.sid;
    if (!userId || typeof sessionId !== 'string') {
      throw unauthorized('Access token is missing required claims.');
    }

    const session = await db.query.appSessions.findFirst({
      where: { sessionId },
    });
    if (!session || session.userId !== userId || session.expiresAt <= new Date()) {
      throw unauthorized('Access token session is invalid or expired.');
    }

    const user = await db.query.users.findFirst({
      where: { id: userId },
      with: { profile: true },
    });

    if (!user || !user.profile) {
      throw unauthorized('Access token user does not exist.');
    }

    return user as AuthUser; // Casting because typescript can't infer. Type is narrowed with above check
  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    }
    throw unauthorized('Access token is invalid or expired.');
  }
}

export async function authenticateRefreshToken(refreshToken: string) {
  try {
    const verified = await jwtVerify(refreshToken, refreshSecret, {
      issuer: config.jwt.issuer,
      audience: config.jwt.audience,
    });
    const userId = verified.payload.sub;
    const sessionId = verified.payload.sid;
    if (!userId || !sessionId || typeof sessionId !== 'string') {
      throw unauthorized('refresh token is missing required claims.');
    }

    // remove the existing session
    const existingSession = await db.query.appSessions.findFirst({
      where: { sessionId },
    });
    if (existingSession && existingSession.userId === userId) {
      await db.delete(appSessions).where(eq(appSessions.sessionId, sessionId));
    }

    // TODO: ensure user is valid and not deleted
    const expiresAt = new Date(Date.now() + accessTokenTtlSec * 1000);
    const [session] = await db.insert(appSessions).values({ userId, expiresAt }).returning();
    const refreshExpiresAt = new Date(Date.now() + refreshTokenTtlSec * 1000);

    if (session) {
      return {
        accessToken: await signToken(userId, session.sessionId, expiresAt, jwtSecret),
        refreshToken: await signToken(userId, session.sessionId, refreshExpiresAt, refreshSecret),
        tokenType: 'Bearer',
        expiresAt: expiresAt.toISOString(),
      };
    } else {
      throw serverError('Cannot create session');
    }
  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    }
    throw unauthorized('Refresh token is invalid or expired.');
  }
}

export async function passwordLogin(input: {
  email: string;
  password: string;
}): Promise<LoginResponse> {
  const user = await db.query.users.findFirst({
    where: { email: input.email },
  });
  if (!user) {
    throw notFound('Player does not exist.');
  }

  // TODO: Validate password
  const profile = await getRequiredUserProfile(user.id);
  const expiresAt = new Date(Date.now() + accessTokenTtlSec * 1000);
  const [session] = await db.insert(appSessions).values({ userId: user.id, expiresAt }).returning();

  if (!session) {
    throw new Error('Failed to create app session.');
  }

  return {
    accessToken: await signToken(user.id, session.sessionId, expiresAt, jwtSecret),
    refreshToken: await signToken(user.id, session.sessionId, expiresAt, refreshSecret),
    tokenType: 'Bearer',
    expiresAt: expiresAt.toISOString(),
    profile,
  };
}

export async function passwordSignup(input: {
  email: string;
  password: string;
  displayName?: string;
}): Promise<SignupResponse> {
  if (!input.email) {
    throw invalidRequest('Missing required');
  }
  const exists = await db.query.users.findFirst({ where: { email: input.email } });

  if (exists) {
    throw unauthorized('Player alread exists.'); // TODO: obfuscate
  }
  const result = await db.transaction(async (tx) => {
    const [user] = await tx
      .insert(users)
      .values({
        email: input.email,
      })
      .returning();

    if (!user) {
      throw serverError('unable to create user');
    }

    const [profile] = await tx
      .insert(profiles)
      .values({
        userId: user.id,
        displayName: input.displayName || input.email,
        claimedAt: new Date(),
      })
      .returning();

    if (!profile) {
      throw serverError('unable to create profile');
    }

    return { user, profile };
  });

  return { user: toAccountDTO(result.user), profile: toProfileDTO(result.profile) };
}

async function getRequiredUserProfile(userId: string): Promise<ProfileDTO> {
  const profile = await db.query.profiles.findFirst({
    where: { userId, deletedAt: { isNull: true } },
  });
  if (!profile) {
    throw serverError('Authenticated user is missing a profile.');
  }
  return toProfileDTO(profile);
}

async function verifyAppleIdentityToken(identityToken: string) {
  const verified = await jwtVerify(identityToken, appleJwks, {
    issuer: 'https://appleid.apple.com',
    audience: config.appleClientIds,
  });

  return verified.payload;
}

async function signToken(
  userId: string,
  sessionId: string,
  expiresAt: Date,
  secret: webcrypto.CryptoKey | KeyObject | JWK | Uint8Array<ArrayBufferLike>,
): Promise<string> {
  return new SignJWT({ sid: sessionId, jti: randomUUID() })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setIssuer(config.jwt.issuer)
    .setAudience(config.jwt.audience)
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime(Math.floor(expiresAt.getTime() / 1000))
    .sign(secret);
}
