CREATE TYPE "plan_routing_priority" AS ENUM('shorter', 'balanced', 'thermal');--> statement-breakpoint
CREATE TABLE "plans" (
	"plan_id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"owner_user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"turnpoints" jsonb NOT NULL,
	"generated_route" jsonb NOT NULL,
	"routing_priority" "plan_routing_priority" NOT NULL,
	"is_private" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "plans_name_normalized" CHECK ("name" = btrim("name")),
	CONSTRAINT "plans_name_length" CHECK (char_length("name") BETWEEN 1 AND 80)
);
--> statement-breakpoint
CREATE INDEX "plans_owner_user_id_updated_at_plan_id_idx" ON "plans" ("owner_user_id","updated_at","plan_id");--> statement-breakpoint
ALTER TABLE "plans" ADD CONSTRAINT "plans_owner_user_id_users_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "users"("user_id") ON DELETE CASCADE;