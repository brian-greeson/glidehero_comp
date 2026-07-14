import { defineRelations } from 'drizzle-orm';
import * as schema from './schema.js';

export const relations = defineRelations(schema, (r) => ({
  users: {
    password: r.one.userPasswords({ from: r.users.id, to: r.userPasswords.userId }),
    profile: r.one.profiles({ from: r.users.id, to: r.profiles.userId }),
    sessions: r.many.appSessions({ from: r.users.id, to: r.appSessions.userId }),
    igcFiles: r.many.igcFiles({ from: r.users.id, to: r.igcFiles.userId }),
    flights: r.many.flights({ from: r.users.id, to: r.flights.userId }),
    personalTerritory: r.one.personalTerritories({ from: r.users.id, to: r.personalTerritories.userId }),
    gridClaims: r.many.userGridClaims({ from: r.users.id, to: r.userGridClaims.claimUser }),
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
    trackPoints: r.many.trackPoints({ from: r.flights.id, to: r.trackPoints.flightId }),
    areas: r.many.flightAreas({ from: r.flights.id, to: r.flightAreas.flightId }),
    gridClaims: r.many.userGridClaims({ from: r.flights.id, to: r.userGridClaims.claimFlight }),
    competitionGridClaims: r.many.competitionGridClaims({ from: r.flights.id, to: r.competitionGridClaims.claimFlight }),
  },
  trackPoints: {
    flight: r.one.flights({ from: r.trackPoints.flightId, to: r.flights.id }),
  },
  flightAreas: {
    flight: r.one.flights({ from: r.flightAreas.flightId, to: r.flights.id }),
  },
  personalTerritories: {
    user: r.one.users({ from: r.personalTerritories.userId, to: r.users.id }),
  },
  userGridClaims: {
    flight: r.one.flights({ from: r.userGridClaims.claimFlight, to: r.flights.id }),
    user: r.one.users({ from: r.userGridClaims.claimUser, to: r.users.id }),
  },
  competitionGridClaims: {
    flight: r.one.flights({ from: r.competitionGridClaims.claimFlight, to: r.flights.id }),
    user: r.one.users({ from: r.competitionGridClaims.claimUser, to: r.users.id }),
  },
}));
