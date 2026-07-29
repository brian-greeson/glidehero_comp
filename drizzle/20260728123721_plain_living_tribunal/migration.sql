CREATE TYPE "bulk_import_phase" AS ENUM('preparing', 'processing', 'replaying', 'completed', 'failed');--> statement-breakpoint
CREATE TYPE "upload_batch_status" AS ENUM('open', 'sealed');--> statement-breakpoint
CREATE TYPE "workflow_member_status" AS ENUM('pending', 'processing', 'completed', 'failed', 'skipped');--> statement-breakpoint
ALTER TYPE "flight_processing_status" ADD VALUE 'pending' BEFORE 'processing';--> statement-breakpoint
CREATE TABLE "bulk_import_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"import_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"flight_id" uuid NOT NULL,
	"upload_job_id" text,
	"started_at" timestamp with time zone NOT NULL,
	"status" "workflow_member_status" DEFAULT 'pending'::"workflow_member_status" NOT NULL,
	"claimed_at" timestamp with time zone,
	"failure_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bulk_import_members_import_flight_unique" UNIQUE("import_id","flight_id")
);
--> statement-breakpoint
CREATE TABLE "bulk_imports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"user_id" uuid NOT NULL,
	"phase" "bulk_import_phase" DEFAULT 'preparing'::"bulk_import_phase" NOT NULL,
	"replay_cursor" integer DEFAULT 0 NOT NULL,
	"replay_checkpoint_count" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "regular_upload_batches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"user_id" uuid NOT NULL,
	"status" "upload_batch_status" DEFAULT 'open'::"upload_batch_status" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "regular_upload_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"batch_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"flight_id" uuid NOT NULL CONSTRAINT "regular_upload_members_flight_unique" UNIQUE,
	"upload_job_id" text,
	"started_at" timestamp with time zone NOT NULL,
	"status" "workflow_member_status" DEFAULT 'pending'::"workflow_member_status" NOT NULL,
	"claimed_at" timestamp with time zone,
	"failure_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_workflow_state" (
	"user_id" uuid PRIMARY KEY,
	"dirty_achievement_boundary" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "bulk_import_members_upload_job_unique_idx" ON "bulk_import_members" ("upload_job_id");--> statement-breakpoint
CREATE INDEX "bulk_import_members_queue_idx" ON "bulk_import_members" ("import_id","status","started_at","flight_id");--> statement-breakpoint
CREATE UNIQUE INDEX "bulk_import_members_one_processing_idx" ON "bulk_import_members" ("import_id") WHERE "status" = 'processing';--> statement-breakpoint
CREATE INDEX "bulk_imports_user_phase_idx" ON "bulk_imports" ("user_id","phase");--> statement-breakpoint
CREATE UNIQUE INDEX "bulk_imports_one_active_per_user_idx" ON "bulk_imports" ("user_id") WHERE "phase" IN ('preparing', 'processing', 'replaying', 'failed');--> statement-breakpoint
CREATE INDEX "regular_upload_batches_user_created_idx" ON "regular_upload_batches" ("user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "regular_upload_members_upload_job_unique_idx" ON "regular_upload_members" ("upload_job_id");--> statement-breakpoint
CREATE INDEX "regular_upload_members_queue_idx" ON "regular_upload_members" ("user_id","status","started_at","flight_id");--> statement-breakpoint
CREATE UNIQUE INDEX "regular_upload_members_one_processing_per_user_idx" ON "regular_upload_members" ("user_id") WHERE "status" = 'processing';--> statement-breakpoint
ALTER TABLE "bulk_import_members" ADD CONSTRAINT "bulk_import_members_import_id_bulk_imports_id_fkey" FOREIGN KEY ("import_id") REFERENCES "bulk_imports"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "bulk_import_members" ADD CONSTRAINT "bulk_import_members_user_id_users_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("user_id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "bulk_import_members" ADD CONSTRAINT "bulk_import_members_flight_id_flights_flight_id_fkey" FOREIGN KEY ("flight_id") REFERENCES "flights"("flight_id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "bulk_imports" ADD CONSTRAINT "bulk_imports_user_id_users_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("user_id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "regular_upload_batches" ADD CONSTRAINT "regular_upload_batches_user_id_users_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("user_id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "regular_upload_members" ADD CONSTRAINT "regular_upload_members_batch_id_regular_upload_batches_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "regular_upload_batches"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "regular_upload_members" ADD CONSTRAINT "regular_upload_members_user_id_users_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("user_id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "regular_upload_members" ADD CONSTRAINT "regular_upload_members_flight_id_flights_flight_id_fkey" FOREIGN KEY ("flight_id") REFERENCES "flights"("flight_id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "user_workflow_state" ADD CONSTRAINT "user_workflow_state_user_id_users_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("user_id") ON DELETE CASCADE;