CREATE TYPE "pilot_group_membership_status" AS ENUM('pending', 'accepted');--> statement-breakpoint
CREATE TABLE "pilot_group_memberships" (
	"group_id" uuid,
	"user_id" uuid,
	"status" "pilot_group_membership_status" NOT NULL,
	"invited_at" timestamp with time zone DEFAULT now() NOT NULL,
	"accepted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pilot_group_memberships_pkey" PRIMARY KEY("group_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "pilot_groups" (
	"group_id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"owner_user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "user_onboarding_state" ADD COLUMN "groups_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "pilot_group_memberships_user_status_idx" ON "pilot_group_memberships" ("user_id","status");--> statement-breakpoint
CREATE INDEX "pilot_group_memberships_group_status_idx" ON "pilot_group_memberships" ("group_id","status");--> statement-breakpoint
CREATE INDEX "pilot_groups_owner_user_id_idx" ON "pilot_groups" ("owner_user_id");--> statement-breakpoint
ALTER TABLE "pilot_group_memberships" ADD CONSTRAINT "pilot_group_memberships_group_id_pilot_groups_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "pilot_groups"("group_id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "pilot_group_memberships" ADD CONSTRAINT "pilot_group_memberships_user_id_users_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("user_id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "pilot_groups" ADD CONSTRAINT "pilot_groups_owner_user_id_users_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "users"("user_id") ON DELETE CASCADE;