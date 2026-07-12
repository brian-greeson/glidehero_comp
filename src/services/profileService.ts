import { eq } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { profiles } from '../db/schema.js';

const territoryColorPattern = /^#[0-9a-f]{6}$/i;

export type UpdateTerritoryColorInput = {
  userId: string;
  territoryColor: string;
};

export class TerritoryColorValidationError extends Error {
  constructor() {
    super('Territory color must be a six-digit hexadecimal value prefixed with #.');
  }
}

export interface ProfileService {
  updateTerritoryColor(input: UpdateTerritoryColorInput): Promise<void>;
}

export function normalizeTerritoryColor(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return territoryColorPattern.test(normalized) ? normalized.toUpperCase() : null;
}

export function createProfileService(database: Database): ProfileService {
  return {
    async updateTerritoryColor({ userId, territoryColor }) {
      const normalizedColor = normalizeTerritoryColor(territoryColor);
      if (!normalizedColor) throw new TerritoryColorValidationError();

      await database
        .update(profiles)
        .set({ territoryColor: normalizedColor, updatedAt: new Date() })
        .where(eq(profiles.userId, userId));
    },
  };
}
