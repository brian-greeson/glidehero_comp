import { Coordinate } from '../domain/types.js';

export const secsPerDay = 60 * 60 * 24;

export function coordToTuple(coord: Coordinate): [number, number] {
  return [coord.latitude, coord.longitude]
}