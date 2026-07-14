import tzLookup from '@photostructure/tz-lookup';

export type LaunchCoordinates = {
  latitude: number;
  longitude: number;
};

export function resolveLaunchTimeZone({ latitude, longitude }: LaunchCoordinates): string {
  return tzLookup(latitude, longitude);
}
