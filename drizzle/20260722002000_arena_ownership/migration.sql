ALTER TABLE "arenas"
  ADD CONSTRAINT "arenas_state_country_external_id_required"
  CHECK ("arena_type" NOT IN ('state', 'country') OR ("external_id" IS NOT NULL AND btrim("external_id") <> ''));--> statement-breakpoint
CREATE UNIQUE INDEX "arenas_arena_type_external_id_state_country_unique"
  ON "arenas" ("arena_type", "external_id")
  WHERE "arena_type" IN ('state', 'country');
