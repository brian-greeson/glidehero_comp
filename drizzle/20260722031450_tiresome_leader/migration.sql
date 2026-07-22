CREATE TABLE "activities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"actor_user_id" uuid NOT NULL,
	"activity_type" text DEFAULT 'flight' NOT NULL,
	"source_flight_id" uuid UNIQUE,
	"published_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "activities_id_actor_user_id_unique" UNIQUE("id","actor_user_id"),
	CONSTRAINT "activities_flight_source_required" CHECK ("activity_type" <> 'flight' OR "source_flight_id" IS NOT NULL)
);
--> statement-breakpoint
CREATE INDEX "activities_actor_user_id_published_at_id_idx" ON "activities" ("actor_user_id","published_at","id");--> statement-breakpoint
CREATE INDEX "activities_activity_type_source_flight_id_idx" ON "activities" ("activity_type","source_flight_id");--> statement-breakpoint
ALTER TABLE "activities" ADD CONSTRAINT "activities_actor_user_id_users_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("user_id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "activities" ADD CONSTRAINT "activities_source_flight_id_flights_flight_id_fkey" FOREIGN KEY ("source_flight_id") REFERENCES "flights"("flight_id") ON DELETE CASCADE;