CREATE TYPE "thermal_activity_band" AS ENUM('dark_blue', 'cyan', 'yellow_orange', 'red');--> statement-breakpoint
CREATE TYPE "thermal_crawl_job_status" AS ENUM('pending', 'running', 'paused', 'complete', 'cancelled', 'failed');--> statement-breakpoint
CREATE TYPE "thermal_crawl_tile_status" AS ENUM('pending', 'cached', 'empty', 'failed');--> statement-breakpoint
CREATE TYPE "thermal_tile_processing_status" AS ENUM('pending', 'processing', 'complete', 'empty', 'failed');--> statement-breakpoint
CREATE TABLE "thermal_areas" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"raster_tile_id" uuid NOT NULL,
	"component_index" integer NOT NULL,
	"activity_band" "thermal_activity_band" NOT NULL,
	"relative_score" double precision NOT NULL,
	"geometry" geometry(MultiPolygon,4326) NOT NULL,
	"area_square_meters" double precision NOT NULL,
	"raster_checksum" text NOT NULL,
	"processing_version" integer NOT NULL,
	"generated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "thermal_areas_tile_version_component_unique" UNIQUE("raster_tile_id","processing_version","activity_band","component_index"),
	CONSTRAINT "thermal_areas_component_nonnegative" CHECK ("component_index" >= 0),
	CONSTRAINT "thermal_areas_score_range" CHECK ("relative_score" > 0 AND "relative_score" <= 1),
	CONSTRAINT "thermal_areas_area_positive" CHECK ("area_square_meters" > 0)
);
--> statement-breakpoint
CREATE TABLE "thermal_crawl_job_tiles" (
	"job_id" uuid,
	"zoom" integer DEFAULT 12,
	"tile_x" integer,
	"tms_y" integer,
	"status" "thermal_crawl_tile_status" DEFAULT 'pending'::"thermal_crawl_tile_status" NOT NULL,
	"raster_tile_id" uuid,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "thermal_crawl_job_tiles_pkey" PRIMARY KEY("job_id","zoom","tile_x","tms_y"),
	CONSTRAINT "thermal_crawl_job_tiles_zoom_12" CHECK ("zoom" = 12),
	CONSTRAINT "thermal_crawl_job_tiles_coordinates_nonnegative" CHECK ("tile_x" >= 0 AND "tms_y" >= 0),
	CONSTRAINT "thermal_crawl_job_tiles_attempts_nonnegative" CHECK ("attempt_count" >= 0)
);
--> statement-breakpoint
CREATE TABLE "thermal_crawl_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"name" text NOT NULL,
	"source_layer_key" text DEFAULT 'thermals_all_all' NOT NULL,
	"target_geometry" geometry(MultiPolygon,4326) NOT NULL,
	"status" "thermal_crawl_job_status" DEFAULT 'pending'::"thermal_crawl_job_status" NOT NULL,
	"created_by" uuid NOT NULL,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "thermal_raster_tiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"source_layer_key" text DEFAULT 'thermals_all_all' NOT NULL,
	"zoom" integer NOT NULL,
	"tile_x" integer NOT NULL,
	"tms_y" integer NOT NULL,
	"bucket_key" text NOT NULL,
	"checksum" text NOT NULL,
	"byte_size" integer NOT NULL,
	"content_type" text DEFAULT 'image/png' NOT NULL,
	"processing_status" "thermal_tile_processing_status",
	"processing_version" integer DEFAULT 1 NOT NULL,
	"lease_owner" text,
	"lease_expires_at" timestamp with time zone,
	"processing_attempts" integer DEFAULT 0 NOT NULL,
	"last_processing_error" text,
	"cached_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "thermal_raster_tiles_source_coordinates_unique" UNIQUE("source_layer_key","zoom","tile_x","tms_y"),
	CONSTRAINT "thermal_raster_tiles_zoom_supported" CHECK ("zoom" >= 0 AND "zoom" <= 12),
	CONSTRAINT "thermal_raster_tiles_coordinates_nonnegative" CHECK ("tile_x" >= 0 AND "tms_y" >= 0),
	CONSTRAINT "thermal_raster_tiles_byte_size_positive" CHECK ("byte_size" > 0),
	CONSTRAINT "thermal_raster_tiles_attempts_nonnegative" CHECK ("processing_attempts" >= 0),
	CONSTRAINT "thermal_raster_tiles_processing_zoom" CHECK (("zoom" = 12 AND "processing_status" IS NOT NULL) OR ("zoom" <> 12 AND "processing_status" IS NULL))
);
--> statement-breakpoint
CREATE INDEX "thermal_areas_geometry_idx" ON "thermal_areas" USING gist ("geometry");--> statement-breakpoint
CREATE INDEX "thermal_areas_score_idx" ON "thermal_areas" ("relative_score");--> statement-breakpoint
CREATE INDEX "thermal_areas_tile_idx" ON "thermal_areas" ("raster_tile_id");--> statement-breakpoint
CREATE INDEX "thermal_crawl_job_tiles_queue_idx" ON "thermal_crawl_job_tiles" ("status","job_id","tile_x","tms_y");--> statement-breakpoint
CREATE INDEX "thermal_crawl_jobs_status_created_idx" ON "thermal_crawl_jobs" ("status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "thermal_raster_tiles_bucket_key_idx" ON "thermal_raster_tiles" ("bucket_key");--> statement-breakpoint
CREATE INDEX "thermal_raster_tiles_processing_queue_idx" ON "thermal_raster_tiles" ("processing_status","lease_expires_at","cached_at");--> statement-breakpoint
ALTER TABLE "thermal_areas" ADD CONSTRAINT "thermal_areas_raster_tile_id_thermal_raster_tiles_id_fkey" FOREIGN KEY ("raster_tile_id") REFERENCES "thermal_raster_tiles"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "thermal_crawl_job_tiles" ADD CONSTRAINT "thermal_crawl_job_tiles_job_id_thermal_crawl_jobs_id_fkey" FOREIGN KEY ("job_id") REFERENCES "thermal_crawl_jobs"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "thermal_crawl_job_tiles" ADD CONSTRAINT "thermal_crawl_job_tiles_EcQUqDLn5342_fkey" FOREIGN KEY ("raster_tile_id") REFERENCES "thermal_raster_tiles"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "thermal_crawl_jobs" ADD CONSTRAINT "thermal_crawl_jobs_created_by_users_user_id_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("user_id") ON DELETE RESTRICT;
