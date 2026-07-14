CREATE TYPE "flight_processing_status" AS ENUM('processing', 'completed', 'failed');--> statement-breakpoint
CREATE TABLE "app_sessions" (
	"session_id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "flight_areas" (
	"flight_area_id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"flight_id" uuid NOT NULL,
	"geometry" geometry(polygon,4326) NOT NULL,
	"area_square_meters" double precision NOT NULL
);
--> statement-breakpoint
CREATE TABLE "flights" (
	"flight_id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"user_id" uuid NOT NULL,
	"igc_file_id" uuid NOT NULL CONSTRAINT "flights_igc_file_id_unique" UNIQUE,
	"processing_status" "flight_processing_status" DEFAULT 'processing'::"flight_processing_status" NOT NULL,
	"processing_error" text,
	"started_at" timestamp with time zone,
	"ended_at" timestamp with time zone,
	"duration_seconds" integer,
	"distance_meters" double precision,
	"launch_latitude" double precision,
	"launch_longitude" double precision,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "igc_files" (
	"igc_file_id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"user_id" uuid NOT NULL,
	"original_filename" text NOT NULL,
	"content_type" text NOT NULL,
	"byte_size" integer NOT NULL,
	"bucket_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "personal_territories" (
	"user_id" uuid PRIMARY KEY,
	"geojson" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"user_id" uuid NOT NULL UNIQUE,
	"display_name" text NOT NULL,
	"territory_color" text DEFAULT '#1769AA' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "track_points" (
	"track_point_id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"flight_id" uuid NOT NULL,
	"sequence_number" integer NOT NULL,
	"recorded_at" timestamp with time zone NOT NULL,
	"latitude" double precision NOT NULL,
	"longitude" double precision NOT NULL,
	"gps_altitude_meters" integer NOT NULL,
	"pressure_altitude_meters" integer NOT NULL,
	CONSTRAINT "track_points_flight_id_sequence_number_unique" UNIQUE("flight_id","sequence_number")
);
--> statement-breakpoint
CREATE TABLE "user_grid_claims" (
	"cell_size" integer,
	"x" integer,
	"y" integer,
	"claim_flight" uuid NOT NULL,
	"claim_user" uuid NOT NULL,
	"claim_timestamp" timestamp with time zone NOT NULL,
	CONSTRAINT "user_grid_claims_pkey" PRIMARY KEY("cell_size","x","y")
);
--> statement-breakpoint
CREATE TABLE "user_passwords" (
	"user_id" uuid PRIMARY KEY,
	"password_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"user_id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"email" text NOT NULL UNIQUE,
	"last_login" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "app_sessions_user_id_idx" ON "app_sessions" ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "app_sessions_token_hash_idx" ON "app_sessions" ("token_hash");--> statement-breakpoint
CREATE INDEX "flight_areas_flight_id_idx" ON "flight_areas" ("flight_id");--> statement-breakpoint
CREATE INDEX "flight_areas_geometry_gist_idx" ON "flight_areas" USING gist ("geometry");--> statement-breakpoint
CREATE INDEX "flights_user_id_idx" ON "flights" ("user_id");--> statement-breakpoint
CREATE INDEX "flights_igc_file_id_idx" ON "flights" ("igc_file_id");--> statement-breakpoint
CREATE INDEX "igc_files_user_id_idx" ON "igc_files" ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "igc_files_bucket_key_idx" ON "igc_files" ("bucket_key");--> statement-breakpoint
CREATE INDEX "profiles_user_id_idx" ON "profiles" ("user_id");--> statement-breakpoint
CREATE INDEX "track_points_flight_id_sequence_number_idx" ON "track_points" ("flight_id","sequence_number");--> statement-breakpoint
CREATE INDEX "user_grid_claims_claim_user_cell_size_idx" ON "user_grid_claims" ("claim_user","cell_size");--> statement-breakpoint
CREATE INDEX "user_grid_claims_claim_flight_idx" ON "user_grid_claims" ("claim_flight");--> statement-breakpoint
ALTER TABLE "app_sessions" ADD CONSTRAINT "app_sessions_user_id_users_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("user_id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "flight_areas" ADD CONSTRAINT "flight_areas_flight_id_flights_flight_id_fkey" FOREIGN KEY ("flight_id") REFERENCES "flights"("flight_id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "flights" ADD CONSTRAINT "flights_user_id_users_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("user_id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "flights" ADD CONSTRAINT "flights_igc_file_id_igc_files_igc_file_id_fkey" FOREIGN KEY ("igc_file_id") REFERENCES "igc_files"("igc_file_id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "igc_files" ADD CONSTRAINT "igc_files_user_id_users_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("user_id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "personal_territories" ADD CONSTRAINT "personal_territories_user_id_users_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("user_id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_user_id_users_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("user_id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "track_points" ADD CONSTRAINT "track_points_flight_id_flights_flight_id_fkey" FOREIGN KEY ("flight_id") REFERENCES "flights"("flight_id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "user_grid_claims" ADD CONSTRAINT "user_grid_claims_claim_flight_flights_flight_id_fkey" FOREIGN KEY ("claim_flight") REFERENCES "flights"("flight_id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "user_grid_claims" ADD CONSTRAINT "user_grid_claims_claim_user_users_user_id_fkey" FOREIGN KEY ("claim_user") REFERENCES "users"("user_id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "user_passwords" ADD CONSTRAINT "user_passwords_user_id_users_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("user_id") ON DELETE CASCADE;