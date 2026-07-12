import type { IgcFix } from './types.js';

const radians = (degrees: number) => degrees * Math.PI / 180;

export function totalDistanceMeters(points: readonly IgcFix[]): number {
  return points.slice(1).reduce((total, point, index) => {
    const previous = points[index]!;
    const dLat = radians(point.latitude - previous.latitude);
    const dLon = radians(point.longitude - previous.longitude);
    const a = Math.sin(dLat / 2) ** 2
      + Math.cos(radians(previous.latitude)) * Math.cos(radians(point.latitude)) * Math.sin(dLon / 2) ** 2;
    return total + 6_371_000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }, 0);
}
