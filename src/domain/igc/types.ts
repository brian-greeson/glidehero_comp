export type IgcFix = {
  sequenceNumber: number;
  recordedAt: Date;
  latitude: number;
  longitude: number;
  pressureAltitudeMeters: number;
  gpsAltitudeMeters: number;
};

export type ParsedIgcFlight = {
  points: readonly IgcFix[];
  startedAt: Date;
  endedAt: Date;
  durationSeconds: number;
  distanceMeters: number;
  launchGpsAltitudeMeters: number;
  minGpsAltitudeMeters: number;
  maxGpsAltitudeMeters: number;
  launchLatitude: number;
  launchLongitude: number;
};
