export const FLIGHT_LAUNCH_MATCH_VERSION = 1;
export const FLIGHT_LAUNCH_MATCH_RADIUS_METERS = 1_000;

export type FlightLaunchCoordinates = {
  latitude: number | null | undefined;
  longitude: number | null | undefined;
};

export function hasValidFlightLaunchCoordinates(
  coordinates: FlightLaunchCoordinates,
): coordinates is { latitude: number; longitude: number } {
  return Number.isFinite(coordinates.latitude)
    && Number.isFinite(coordinates.longitude)
    && coordinates.latitude! >= -90
    && coordinates.latitude! <= 90
    && coordinates.longitude! >= -180
    && coordinates.longitude! <= 180;
}
