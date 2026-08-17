CREATE TYPE "plan_visibility" AS ENUM('private', 'link', 'group');--> statement-breakpoint
ALTER TABLE "plans" ADD COLUMN "visibility" "plan_visibility" DEFAULT 'private'::"plan_visibility" NOT NULL;--> statement-breakpoint
ALTER TABLE "plans" ADD COLUMN "shared_group_id" uuid;--> statement-breakpoint
ALTER TABLE "plans" DROP COLUMN "is_private";--> statement-breakpoint
CREATE INDEX "plans_shared_group_id_idx" ON "plans" ("shared_group_id");--> statement-breakpoint
ALTER TABLE "plans" ADD CONSTRAINT "plans_shared_group_id_pilot_groups_group_id_fkey" FOREIGN KEY ("shared_group_id") REFERENCES "pilot_groups"("group_id");--> statement-breakpoint
ALTER TABLE "plans" ADD CONSTRAINT "plans_group_visibility_requires_shared_group" CHECK (("visibility" = 'group') = ("shared_group_id" IS NOT NULL));