import { defineRelations } from 'drizzle-orm';
import * as schema from './schema.js';

export const relations = defineRelations(schema, (r) => ({
  users: {
    password: r.one.userPasswords({
      from: r.users.id,
      to: r.userPasswords.userId,
    }),
    sessions: r.many.appSessions({
      from: r.users.id,
      to: r.appSessions.userId,
    }),
    profile: r.one.profiles({
      from: r.users.id,
      to: r.profiles.userId,
    }),
    createdProfiles: r.many.profiles({
      from: r.users.id,
      to: r.profiles.createdByUserId,
    }),
  },
  userPasswords: {
    user: r.one.users({
      from: r.userPasswords.userId,
      to: r.users.id,
    }),
  },
  appSessions: {
    user: r.one.users({
      from: r.appSessions.userId,
      to: r.users.id,
    }),
  },
  profiles: {
    user: r.one.users({
      from: r.profiles.userId,
      to: r.users.id,
    }),
    createdBy: r.one.users({
      from: r.profiles.createdByUserId,
      to: r.users.id,
    }),
    
    sourceProfileFollows: r.many.profileFollows({
      from: r.profiles.id,
      to: r.profileFollows.sourceProfileId,
    }),
    followedByProfileFollows: r.many.profileFollows({
      from: r.profiles.id,
      to: r.profileFollows.followedProfileId,
    }),
    
  },
  profileFollows: {
    sourceProfile: r.one.profiles({
      from: r.profileFollows.sourceProfileId,
      to: r.profiles.id,
    }),
    followedProfile: r.one.profiles({
      from: r.profileFollows.followedProfileId,
      to: r.profiles.id,
    }),
  },
}));
