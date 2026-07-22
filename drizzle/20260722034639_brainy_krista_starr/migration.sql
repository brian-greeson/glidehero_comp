CREATE TABLE "activity_reactions" (
	"activity_id" uuid,
	"activity_owner_user_id" uuid NOT NULL,
	"reactor_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "activity_reactions_pkey" PRIMARY KEY("activity_id","reactor_user_id"),
	CONSTRAINT "activity_reactions_no_self_reaction" CHECK ("activity_owner_user_id" <> "reactor_user_id")
);
--> statement-breakpoint
CREATE INDEX "activity_reactions_reactor_user_id_idx" ON "activity_reactions" ("reactor_user_id");--> statement-breakpoint
ALTER TABLE "activity_reactions" ADD CONSTRAINT "activity_reactions_reactor_user_id_users_user_id_fkey" FOREIGN KEY ("reactor_user_id") REFERENCES "users"("user_id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "activity_reactions" ADD CONSTRAINT "activity_reactions_activity_owner_fkey" FOREIGN KEY ("activity_id","activity_owner_user_id") REFERENCES "activities"("id","actor_user_id") ON DELETE CASCADE;