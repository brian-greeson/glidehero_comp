CREATE TABLE "flight_progress" (
	"flight_id" uuid PRIMARY KEY,
	"user_id" uuid NOT NULL,
	"direct_cell_count" integer NOT NULL,
	"enclosed_cell_count" integer NOT NULL,
	"new_personal_cell_count" integer NOT NULL,
	"personal_cell_total_after" integer NOT NULL,
	"progression_version" integer DEFAULT 1 NOT NULL,
	"evaluated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "flight_progress_direct_cell_count_nonnegative" CHECK ("direct_cell_count" >= 0),
	CONSTRAINT "flight_progress_enclosed_cell_count_nonnegative" CHECK ("enclosed_cell_count" >= 0),
	CONSTRAINT "flight_progress_new_personal_cell_count_nonnegative" CHECK ("new_personal_cell_count" >= 0),
	CONSTRAINT "flight_progress_personal_cell_total_after_nonnegative" CHECK ("personal_cell_total_after" >= 0)
);
--> statement-breakpoint
CREATE INDEX "flight_progress_user_id_evaluated_at_idx" ON "flight_progress" ("user_id","evaluated_at");--> statement-breakpoint
ALTER TABLE "flight_progress" ADD CONSTRAINT "flight_progress_flight_id_flights_flight_id_fkey" FOREIGN KEY ("flight_id") REFERENCES "flights"("flight_id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "flight_progress" ADD CONSTRAINT "flight_progress_user_id_users_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("user_id") ON DELETE CASCADE;