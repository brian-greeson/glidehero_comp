CREATE TABLE "user_onboarding_state" (
	"user_id" uuid PRIMARY KEY,
	"first_flight_id" uuid,
	"first_flight_completed_at" timestamp with time zone,
	"personal_map_viewed_at" timestamp with time zone,
	"followed_three_pilots_at" timestamp with time zone,
	"glider_added_at" timestamp with time zone,
	"history_import_completed_at" timestamp with time zone,
	"dismissed_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "user_onboarding_state" ADD CONSTRAINT "user_onboarding_state_user_id_users_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("user_id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "user_onboarding_state" ADD CONSTRAINT "user_onboarding_state_first_flight_id_flights_flight_id_fkey" FOREIGN KEY ("first_flight_id") REFERENCES "flights"("flight_id") ON DELETE SET NULL;