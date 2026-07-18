DO $$
DECLARE
  active_cell_sizes integer;
  stored_cell_size integer;
  configured_cell_size_text text;
BEGIN
  SELECT COUNT(DISTINCT cell_size), MIN(cell_size)
  INTO active_cell_sizes, stored_cell_size
  FROM launch_area_cells;

  IF active_cell_sizes > 1 THEN
    RAISE EXCEPTION 'Arena migration aborted: launch_area_cells contains more than one active cell size';
  END IF;

  configured_cell_size_text := current_setting('glidehero.grid_claim_cell_size', true);
  IF active_cell_sizes = 1 AND configured_cell_size_text IS NOT NULL
    AND configured_cell_size_text <> '' AND configured_cell_size_text::integer <> stored_cell_size THEN
    RAISE EXCEPTION 'Arena migration aborted: stored cell size % differs from configured size %',
      stored_cell_size, configured_cell_size_text;
  END IF;

  IF EXISTS (
    SELECT 1 FROM launch_areas area
    WHERE area.area IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM launch_area_cells cell WHERE cell.launch_area_id = area.id)
  ) THEN
    RAISE EXCEPTION 'Arena migration aborted: a visible Arena has no membership cells';
  END IF;

  IF EXISTS (SELECT 1 FROM launch_areas GROUP BY source_id HAVING COUNT(*) > 1) THEN
    RAISE EXCEPTION 'Arena migration aborted: duplicate source IDs exist';
  END IF;

  IF EXISTS (SELECT 1 FROM launch_areas WHERE area IS NOT NULL AND (ST_IsEmpty(area) OR NOT ST_IsValid(area))) THEN
    RAISE EXCEPTION 'Arena migration aborted: an existing cached area is empty or invalid';
  END IF;
END $$;
--> statement-breakpoint
CREATE TEMP TABLE arena_migration_baseline ON COMMIT DROP AS
SELECT
  COUNT(*)::bigint AS arena_count,
  md5(COALESCE(string_agg(id::text, ',' ORDER BY id), '')) AS id_hash,
  md5(COALESCE(string_agg(source_id::text, ',' ORDER BY source_id), '')) AS source_id_hash
FROM launch_areas;
--> statement-breakpoint
CREATE TYPE "arena_definition_type" AS ENUM('grid', 'polygon');
--> statement-breakpoint
ALTER SEQUENCE "custom_launch_area_source_id_seq" RENAME TO "arena_source_id_seq";
--> statement-breakpoint
ALTER TABLE "launch_areas" RENAME TO "arenas";
--> statement-breakpoint
ALTER TABLE "arenas" RENAME CONSTRAINT "launch_areas_pkey" TO "arenas_pkey";
--> statement-breakpoint
ALTER TABLE "arenas" RENAME CONSTRAINT "launch_areas_source_id_unique" TO "arenas_source_id_unique";
--> statement-breakpoint
ALTER INDEX "launch_areas_area_gist_idx" RENAME TO "arenas_area_gist_idx";
--> statement-breakpoint
ALTER TABLE "arenas" ADD COLUMN "definition_type" "arena_definition_type";
--> statement-breakpoint
ALTER TABLE "arenas" ADD COLUMN "external_source" text;
--> statement-breakpoint
ALTER TABLE "arenas" ADD COLUMN "external_id" text;
--> statement-breakpoint
ALTER TABLE "arenas" ALTER COLUMN "state" DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE "arenas" ALTER COLUMN "city" DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE "arenas" ALTER COLUMN "location" DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE "arenas" ALTER COLUMN "altitude_meters" DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE "arenas" ALTER COLUMN "timezone" DROP NOT NULL;
--> statement-breakpoint
WITH rebuilt AS (
  SELECT
    cell.launch_area_id,
    ST_Multi(ST_CollectionExtract(ST_UnaryUnion(ST_Collect(
      ST_MakeEnvelope(
        cell.x * cell.cell_size,
        cell.y * cell.cell_size,
        (cell.x + 1) * cell.cell_size,
        (cell.y + 1) * cell.cell_size,
        6933
      )
    )), 3))::geometry(multipolygon, 6933) AS area
  FROM launch_area_cells cell
  GROUP BY cell.launch_area_id
)
UPDATE arenas arena
SET area = rebuilt.area, definition_type = 'grid'
FROM rebuilt
WHERE rebuilt.launch_area_id = arena.id;
--> statement-breakpoint
DO $$
DECLARE baseline arena_migration_baseline%ROWTYPE;
BEGIN
  SELECT * INTO baseline FROM arena_migration_baseline;
  IF (SELECT COUNT(*) FROM arenas) <> baseline.arena_count
    OR (SELECT md5(COALESCE(string_agg(id::text, ',' ORDER BY id), '')) FROM arenas) <> baseline.id_hash
    OR (SELECT md5(COALESCE(string_agg(source_id::text, ',' ORDER BY source_id), '')) FROM arenas) <> baseline.source_id_hash THEN
    RAISE EXCEPTION 'Arena migration aborted: Arena count, UUIDs, or source IDs changed';
  END IF;

  IF EXISTS (
    SELECT 1 FROM arenas
    WHERE area IS NULL OR ST_IsEmpty(area) OR NOT ST_IsValid(area) OR GeometryType(area) <> 'MULTIPOLYGON'
  ) THEN
    RAISE EXCEPTION 'Arena migration aborted: rebuilt Arena geometry is missing, empty, invalid, or not MultiPolygon';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM launch_area_cells cell
    INNER JOIN arenas arena ON arena.id = cell.launch_area_id
    WHERE NOT ST_Covers(arena.area, ST_SetSRID(ST_MakePoint(
      (cell.x + 0.5) * cell.cell_size,
      (cell.y + 0.5) * cell.cell_size
    ), 6933))
  ) THEN
    RAISE EXCEPTION 'Arena migration aborted: a formerly selected cell center is not covered';
  END IF;
END $$;
--> statement-breakpoint
ALTER TABLE "arenas" ALTER COLUMN "definition_type" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "arenas" ALTER COLUMN "area" SET NOT NULL;
--> statement-breakpoint
DROP INDEX "arenas_area_gist_idx";
--> statement-breakpoint
CREATE INDEX "arenas_area_gist_idx" ON "arenas" USING gist ("area");
--> statement-breakpoint
CREATE UNIQUE INDEX "arenas_external_source_external_id_unique"
  ON "arenas" ("external_source", "external_id")
  WHERE "external_source" IS NOT NULL AND "external_id" IS NOT NULL;
--> statement-breakpoint
SELECT setval(
  'arena_source_id_seq',
  GREATEST(10000, COALESCE((SELECT MAX(source_id) + 1 FROM arenas), 10000)),
  false
);
--> statement-breakpoint
DROP TABLE "launch_area_cells";
