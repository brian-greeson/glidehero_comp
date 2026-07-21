import { defineRelations } from 'drizzle-orm';
import * as schema from './schema.js';

export const relations = defineRelations(schema, (r) => ({
  users: {
    password: r.one.userPasswords({ from: r.users.id, to: r.userPasswords.userId }),
    profile: r.one.profiles({ from: r.users.id, to: r.profiles.userId }),
    sessions: r.many.appSessions({ from: r.users.id, to: r.appSessions.userId }),
    igcFiles: r.many.igcFiles({ from: r.users.id, to: r.igcFiles.userId }),
    flights: r.many.flights({ from: r.users.id, to: r.flights.userId }),
    flightProgress: r.many.flightProgress({ from: r.users.id, to: r.flightProgress.userId }),
    achievements: r.many.achievements({ from: r.users.id, to: r.achievements.userId }),
    achievementRecords: r.many.achievementRecords({ from: r.users.id, to: r.achievementRecords.userId }),
    achievementRecordEvents: r.many.achievementRecordEvents({ from: r.users.id, to: r.achievementRecordEvents.userId }),
    personalGridClaims: r.many.personalGridClaims({ from: r.users.id, to: r.personalGridClaims.claimUser }),
    competitionGridClaims: r.many.competitionGridClaims({ from: r.users.id, to: r.competitionGridClaims.claimUser }),
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
    flight: r.one.flights({ from: r.igcFiles.id, to: r.flights.igcFileId }),
  },
  flights: {
    user: r.one.users({ from: r.flights.userId, to: r.users.id }),
    igcFile: r.one.igcFiles({ from: r.flights.igcFileId, to: r.igcFiles.id }),
    flightProgress: r.one.flightProgress({ from: r.flights.id, to: r.flightProgress.flightId }),
    achievements: r.many.achievements({ from: r.flights.id, to: r.achievements.sourceFlightId }),
    trackPoints: r.many.trackPoints({ from: r.flights.id, to: r.trackPoints.flightId }),
    personalGridClaims: r.many.personalGridClaims({ from: r.flights.id, to: r.personalGridClaims.claimFlight }),
    competitionGridClaims: r.many.competitionGridClaims({ from: r.flights.id, to: r.competitionGridClaims.claimFlight }),
  },
  trackPoints: {
    flight: r.one.flights({ from: r.trackPoints.flightId, to: r.flights.id }),
  },
  flightProgress: {
    flight: r.one.flights({ from: r.flightProgress.flightId, to: r.flights.id }),
    user: r.one.users({ from: r.flightProgress.userId, to: r.users.id }),
  },
  achievements: {
    user: r.one.users({ from: r.achievements.userId, to: r.users.id }),
    sourceFlight: r.one.flights({ from: r.achievements.sourceFlightId, to: r.flights.id }),
  },
  achievementRecords: {
    user: r.one.users({ from: r.achievementRecords.userId, to: r.users.id }),
    sourceFlight: r.one.flights({ from: r.achievementRecords.sourceFlightId, to: r.flights.id }),
    events: r.many.achievementRecordEvents({ from: r.achievementRecords.id, to: r.achievementRecordEvents.recordId }),
  },
  achievementRecordEvents: {
    record: r.one.achievementRecords({ from: r.achievementRecordEvents.recordId, to: r.achievementRecords.id }),
    user: r.one.users({ from: r.achievementRecordEvents.userId, to: r.users.id }),
    sourceFlight: r.one.flights({ from: r.achievementRecordEvents.sourceFlightId, to: r.flights.id }),
  },
  personalGridClaims: {
    flight: r.one.flights({ from: r.personalGridClaims.claimFlight, to: r.flights.id }),
    user: r.one.users({ from: r.personalGridClaims.claimUser, to: r.users.id }),
  },
  competitionGridClaims: {
    flight: r.one.flights({ from: r.competitionGridClaims.claimFlight, to: r.flights.id }),
    user: r.one.users({ from: r.competitionGridClaims.claimUser, to: r.users.id }),
  },
}));
