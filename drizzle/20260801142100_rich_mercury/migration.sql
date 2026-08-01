ALTER TYPE "thermal_crawl_tile_status" ADD VALUE 'processing' BEFORE 'cached';--> statement-breakpoint
ALTER TABLE "thermal_crawl_job_tiles" ADD COLUMN "lease_owner" text;--> statement-breakpoint
ALTER TABLE "thermal_crawl_job_tiles" ADD COLUMN "lease_expires_at" timestamp with time zone;