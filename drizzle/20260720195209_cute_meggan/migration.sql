CREATE TABLE "achievements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"user_id" uuid NOT NULL,
	"achievement_type" text NOT NULL,
	"achievement_key" text NOT NULL,
	"source_flight_id" uuid,
	"earned_at" timestamp with time zone NOT NULL,
	"details" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "achievements_user_id_achievement_key_unique" UNIQUE("user_id","achievement_key")
);
--> statement-breakpoint
CREATE INDEX "achievements_user_id_earned_at_idx" ON "achievements" ("user_id","earned_at");--> statement-breakpoint
ALTER TABLE "achievements" ADD CONSTRAINT "achievements_user_id_users_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("user_id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "achievements" ADD CONSTRAINT "achievements_source_flight_id_flights_flight_id_fkey" FOREIGN KEY ("source_flight_id") REFERENCES "flights"("flight_id") ON DELETE SET NULL;