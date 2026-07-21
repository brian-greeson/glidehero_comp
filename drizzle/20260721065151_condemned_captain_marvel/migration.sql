CREATE TABLE "achievement_record_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"record_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"source_flight_id" uuid,
	"value" integer NOT NULL,
	"earned_at" timestamp with time zone NOT NULL,
	"details" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "achievement_record_events_value_nonnegative" CHECK ("value" > 0)
);
--> statement-breakpoint
CREATE TABLE "achievement_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"user_id" uuid NOT NULL,
	"record_key" text NOT NULL,
	"best_value" integer NOT NULL,
	"source_flight_id" uuid,
	"earned_at" timestamp with time zone NOT NULL,
	"details" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "achievement_records_user_id_record_key_unique" UNIQUE("user_id","record_key"),
	CONSTRAINT "achievement_records_best_value_nonnegative" CHECK ("best_value" > 0)
);
--> statement-breakpoint
CREATE INDEX "achievement_record_events_record_id_earned_at_idx" ON "achievement_record_events" ("record_id","earned_at");--> statement-breakpoint
CREATE INDEX "achievement_record_events_user_id_earned_at_idx" ON "achievement_record_events" ("user_id","earned_at");--> statement-breakpoint
CREATE INDEX "achievement_records_user_id_updated_at_idx" ON "achievement_records" ("user_id","updated_at");--> statement-breakpoint
ALTER TABLE "achievement_record_events" ADD CONSTRAINT "achievement_record_events_record_id_achievement_records_id_fkey" FOREIGN KEY ("record_id") REFERENCES "achievement_records"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "achievement_record_events" ADD CONSTRAINT "achievement_record_events_user_id_users_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("user_id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "achievement_record_events" ADD CONSTRAINT "achievement_record_events_mXcKlmLnUibx_fkey" FOREIGN KEY ("source_flight_id") REFERENCES "flights"("flight_id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "achievement_records" ADD CONSTRAINT "achievement_records_user_id_users_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("user_id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "achievement_records" ADD CONSTRAINT "achievement_records_source_flight_id_flights_flight_id_fkey" FOREIGN KEY ("source_flight_id") REFERENCES "flights"("flight_id") ON DELETE SET NULL;
