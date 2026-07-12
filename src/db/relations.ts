import { defineRelations } from 'drizzle-orm';
import * as schema from './schema.js';

export const relations = defineRelations(schema, (r) => ({
  users: {
    password: r.one.userPasswords({ from: r.users.id, to: r.userPasswords.userId }),
    profile: r.one.profiles({ from: r.users.id, to: r.profiles.userId }),
    sessions: r.many.appSessions({ from: r.users.id, to: r.appSessions.userId }),
    igcFiles: r.many.igcFiles({ from: r.users.id, to: r.igcFiles.userId }),
  },
  userPasswords: {
    user: r.one.users({ from: r.userPasswords.userId, to: r.users.id }),
  },
  profiles: {
    user: r.one.users({ from: r.profiles.userId, to: r.users.id }),
  },
  appSessions: {
    user: r.one.users({ from: r.appSessions.userId, to: r.users.id }),
  },
  igcFiles: {
    user: r.one.users({ from: r.igcFiles.userId, to: r.users.id }),
  },
}));
