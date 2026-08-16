ALTER TABLE "flights" ADD COLUMN "launch_id" bigint;--> statement-breakpoint
ALTER TABLE "flights" ADD COLUMN "launch_match_version" integer;--> statement-breakpoint
CREATE INDEX "flights_launch_id_idx" ON "flights" ("launch_id");--> statement-breakpoint
CREATE INDEX "flights_launch_match_version_idx" ON "flights" ("launch_match_version");--> statement-breakpoint
CREATE INDEX "launches_location_geography_gist_idx" ON "launches" USING gist ((ST_SetSRID(ST_MakePoint("longitude", "latitude"), 4326)::geography));--> statement-breakpoint
ALTER TABLE "flights" ADD CONSTRAINT "flights_launch_id_launches_id_fkey" FOREIGN KEY ("launch_id") REFERENCES "launches"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "flights" ADD CONSTRAINT "flights_launch_match_version_positive" CHECK ("launch_match_version" IS NULL OR "launch_match_version" > 0);