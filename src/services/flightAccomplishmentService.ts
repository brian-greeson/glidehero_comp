import { sql } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { arenaPath } from '../domain/arena/arenaRoute.js';
import { findAchievementDefinition } from '../domain/achievement/catalog.js';

export type FlightAccomplishment = {
  id: string;
  /** Stable catalog/legacy identity used by presentation adapters. */
  achievementKey: string;
  title: string;
  description: string;
  /** Display metadata shared by Activity, Achievements, and flight details. */
  badgeLabel: string;
  category: string;
  kind: string;
  tone: 'green' | 'blue' | 'orange' | 'purple';
  arenaName?: string;
  arenaPath?: string;
};

type AchievementRow = {
  id: string;
  sourceFlightId: string;
  achievementType: string;
  achievementKey: string;
  earnedAt: Date | string;
  details: unknown;
  arenaId: string | null;
  arenaName: string | null;
  arenaSourceId: number | string | null;
  arenaCountryCode: string | null;
};

type RecordEventRow = {
  id: string;
  sourceFlightId: string;
  recordKey: string;
  value: number;
  earnedAt: Date | string;
  details: unknown;
};

type LeadershipRow = {
  id: string;
  sourceFlightId: string;
  eventType: 'took' | 'reclaimed';
  claimTimestamp: Date | string;
  arenaId: string;
  arenaName: string;
  arenaSourceId: number | string;
  arenaCountryCode: string;
};

function storedTimestamp(value: Date | string): Date {
  const timestamp = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(timestamp.getTime())) throw new Error('Activity accomplishment timestamp is invalid.');
  return timestamp;
}

function detailsObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function detailNumber(details: Record<string, unknown>, key: string): number | null {
  const value = details[key];
  const parsed = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

function countText(value: number | null): string {
  return value === null ? 'an unknown number of' : String(value);
}

function cellCountText(value: number | null): string {
  return `${countText(value)} ${value === 1 ? 'cell' : 'cells'}`;
}

function accomplishmentTone(category: string | undefined, kind: string | undefined): FlightAccomplishment['tone'] {
  if (kind === 'record') return 'blue';
  if (category === 'leadership') return 'purple';
  if (category === 'launch') return 'orange';
  return 'green';
}

function accomplishmentMetadata(input: {
  category?: string;
  kind?: string;
  threshold?: number;
  milestone?: number | null;
}): Pick<FlightAccomplishment, 'badgeLabel' | 'category' | 'kind' | 'tone'> {
  const category = input.category ?? 'general';
  const kind = input.kind ?? 'special';
  const badgeLabel = input.threshold !== undefined
    ? String(input.threshold)
    : input.milestone !== null && input.milestone !== undefined
      ? String(input.milestone)
      : kind === 'record' ? 'PB' : category === 'leadership' ? '★' : '•';
  return { badgeLabel, category, kind, tone: accomplishmentTone(category, kind) };
}

function achievementAccomplishment(row: AchievementRow): FlightAccomplishment {
  const details = detailsObject(row.details);
  const definition = findAchievementDefinition(row.achievementKey);
  const arenaName = row.arenaName ?? (typeof details.arenaName === 'string' && details.arenaName.trim() ? details.arenaName.trim() : undefined);
  const linkedArena = arenaName && row.arenaSourceId !== null && row.arenaCountryCode
    ? { arenaName, arenaPath: arenaPath({ sourceId: Number(row.arenaSourceId), name: arenaName, countryCode: row.arenaCountryCode }) }
    : {};
  if (definition) {
    const isLeadership = row.achievementKey === 'took_lead_in_arena' || row.achievementKey === 'reclaimed_lead_in_arena';
    const title = isLeadership && arenaName
      ? `${row.achievementKey === 'took_lead_in_arena' ? 'Took' : 'Reclaimed'} the Lead in ${arenaName}`
      : definition.title;
    const description = isLeadership && arenaName ? `${title}.` : definition.description;
    return {
      id: row.id,
      achievementKey: row.achievementKey,
      title,
      description,
      ...accomplishmentMetadata({ category: definition.category, kind: definition.kind, threshold: 'threshold' in definition ? definition.threshold : undefined }),
      ...linkedArena,
    };
  }

  const milestone = detailNumber(details, 'milestone');
  const previousRecord = detailNumber(details, 'previousRecord');
  const newRecord = detailNumber(details, 'newRecord');
  const directCells = detailNumber(details, 'directCells');
  const enclosedCells = detailNumber(details, 'enclosedCells');
  const newCells = detailNumber(details, 'newCells');
  const newTotal = detailNumber(details, 'newTotal');
  if (row.achievementType === 'unique_cells_milestone') {
    const title = milestone === null ? 'Unique Cells Milestone' : `${milestone} Unique Cells`;
    const description = milestone === null
      ? 'Reached a new Personal Map milestone.'
      : `Reached ${milestone} unique Personal Map cells, adding ${countText(newCells)} new ${newCells === 1 ? 'cell' : 'cells'} to a total of ${countText(newTotal)}.`;
    return {
      id: row.id,
      achievementKey: row.achievementType,
      title,
      description,
      ...accomplishmentMetadata({ category: 'general', kind: 'threshold', milestone }),
      ...linkedArena,
    };
  }
  if (row.achievementType === 'personal_best_total_cells' || row.achievementType === 'personal_best_enclosed_cells') {
    const enclosed = row.achievementType === 'personal_best_enclosed_cells';
    const record = countText(newRecord);
    const description = previousRecord === null
      ? `Established an initial ${enclosed ? 'enclosed-cell' : 'total-cell'} record of ${cellCountText(newRecord)} (${countText(directCells)} direct and ${countText(enclosedCells)} enclosed).`
      : `Improved the ${enclosed ? 'enclosed-cell' : 'total-cell'} record from ${previousRecord} to ${record} cells (${countText(directCells)} direct and ${countText(enclosedCells)} enclosed).`;
    return {
      id: row.id,
      achievementKey: row.achievementType,
      title: enclosed ? 'New Enclosed Cell Record' : 'New Flight Cell Record',
      description,
      ...accomplishmentMetadata({ category: 'general', kind: 'record' }),
      ...linkedArena,
    };
  }
  return {
    id: row.id,
    achievementKey: row.achievementKey,
    title: 'Progress Achievement',
    description: 'A progression achievement earned during a flight.',
    ...accomplishmentMetadata({}),
    ...linkedArena,
  };
}

function recordAccomplishment(row: RecordEventRow): FlightAccomplishment {
  const definition = findAchievementDefinition(row.recordKey);
  const details = detailsObject(row.details);
  const previousValue = detailNumber(details, 'previousValue');
  const count = `${row.value} Launch Arena${row.value === 1 ? '' : 's'}`;
  return {
    id: row.id,
    achievementKey: row.recordKey,
    title: definition?.title ?? 'Personal Best',
    description: previousValue === null
      ? `Tagged ${count} during one flight, establishing an initial record.`
      : `Tagged ${count} during one flight, improving the previous best of ${previousValue}.`,
    ...accomplishmentMetadata({ category: definition?.category, kind: 'record' }),
  };
}

function leadershipAccomplishment(row: LeadershipRow): FlightAccomplishment {
  const verb = row.eventType === 'took' ? 'Took' : 'Reclaimed';
  return {
    id: row.id,
    achievementKey: row.eventType === 'took' ? 'took_lead_in_arena' : 'reclaimed_lead_in_arena',
    title: `${verb} the Lead in ${row.arenaName}`,
    description: `${verb} the lead in ${row.arenaName}.`,
    ...accomplishmentMetadata({ category: 'leadership', kind: 'special' }),
    arenaName: row.arenaName,
    arenaPath: arenaPath({ sourceId: Number(row.arenaSourceId), name: row.arenaName, countryCode: row.arenaCountryCode }),
  };
}

/** Load the exact accomplishment set and ordering shared by flight surfaces. */
export async function loadFlightAccomplishments(
  database: Database,
  sourceFlightIds: readonly string[],
): Promise<Map<string, FlightAccomplishment[]>> {
  const result = new Map<string, FlightAccomplishment[]>();
  const ordered = new Map<string, Array<{ item: FlightAccomplishment; at: Date; id: string }>>();
  if (sourceFlightIds.length === 0) return result;
  const ids = JSON.stringify([...new Set(sourceFlightIds)]);
  const flightIds = sql`SELECT value::uuid AS flight_id FROM jsonb_array_elements_text(${ids}::jsonb) AS value`;
  const achievementRows = await database.execute<AchievementRow>(sql`
    WITH flight_ids AS (${flightIds})
    SELECT earned.id, earned.source_flight_id AS "sourceFlightId", earned.achievement_type AS "achievementType",
           earned.achievement_key AS "achievementKey", earned.earned_at AS "earnedAt", earned.details,
           achievement_arena.id AS "arenaId", achievement_arena.name AS "arenaName",
           achievement_arena.source_id AS "arenaSourceId", achievement_arena.country_code AS "arenaCountryCode"
    FROM achievements earned
    INNER JOIN flight_ids ON flight_ids.flight_id = earned.source_flight_id
    LEFT JOIN arenas achievement_arena ON achievement_arena.id = CASE
      WHEN earned.details->>'arenaId' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      THEN (earned.details->>'arenaId')::uuid
      ELSE NULL
    END
    ORDER BY earned.earned_at ASC, earned.id ASC
  `);
  const recordRows = await database.execute<RecordEventRow>(sql`
    WITH flight_ids AS (${flightIds})
    SELECT event.id, event.source_flight_id AS "sourceFlightId", record.record_key AS "recordKey",
           event.value, event.earned_at AS "earnedAt", event.details
    FROM achievement_record_events event
    INNER JOIN achievement_records record ON record.id = event.record_id
    INNER JOIN flight_ids ON flight_ids.flight_id = event.source_flight_id
    ORDER BY event.earned_at ASC, event.id ASC
  `);
  const leadershipRows = await database.execute<LeadershipRow>(sql`
    WITH flight_ids AS (${flightIds})
    SELECT event.id, event.source_flight_id AS "sourceFlightId", event.event_type AS "eventType",
           event.claim_timestamp AS "claimTimestamp", arena.id AS "arenaId", arena.name AS "arenaName",
           arena.source_id AS "arenaSourceId", arena.country_code AS "arenaCountryCode"
    FROM arena_leadership_events event
    INNER JOIN flight_ids ON flight_ids.flight_id = event.source_flight_id
    INNER JOIN arenas arena ON arena.id = event.arena_id
    WHERE event.event_type IN ('took', 'reclaimed')
    ORDER BY event.claim_timestamp ASC, event.id ASC
  `);
  const leadershipKeys = new Set(leadershipRows.rows.map((row) => {
    const type = row.eventType === 'took' ? 'took_lead_in_arena' : 'reclaimed_lead_in_arena';
    return `${row.sourceFlightId}:${type}:${row.arenaId}`;
  }));
  for (const row of achievementRows.rows) {
    const isLeadership = row.achievementKey === 'took_lead_in_arena' || row.achievementKey === 'reclaimed_lead_in_arena';
    const arenaId = typeof detailsObject(row.details).arenaId === 'string' ? detailsObject(row.details).arenaId : '';
    if (isLeadership && arenaId && leadershipKeys.has(`${row.sourceFlightId}:${row.achievementKey}:${arenaId}`)) continue;
    const list = ordered.get(row.sourceFlightId) ?? [];
    list.push({ item: achievementAccomplishment(row), at: storedTimestamp(row.earnedAt), id: row.id });
    ordered.set(row.sourceFlightId, list);
  }
  for (const row of recordRows.rows) {
    const list = ordered.get(row.sourceFlightId) ?? [];
    list.push({ item: recordAccomplishment(row), at: storedTimestamp(row.earnedAt), id: row.id });
    ordered.set(row.sourceFlightId, list);
  }
  for (const row of leadershipRows.rows) {
    const list = ordered.get(row.sourceFlightId) ?? [];
    list.push({ item: leadershipAccomplishment(row), at: storedTimestamp(row.claimTimestamp), id: row.id });
    ordered.set(row.sourceFlightId, list);
  }
  for (const [flightId, list] of ordered) {
    list.sort((left, right) => left.at.getTime() - right.at.getTime() || left.id.localeCompare(right.id));
    result.set(flightId, list.map((entry) => entry.item));
  }
  return result;
}
