ALTER TABLE "arena_current_leaders" DROP CONSTRAINT "arena_current_leaders_decisive_cell_size_positive";--> statement-breakpoint
ALTER TABLE "arena_leadership_events" DROP CONSTRAINT "arena_leadership_events_cell_size_positive";--> statement-breakpoint
ALTER TABLE "arena_current_leaders" DROP COLUMN "decisive_cell_size";--> statement-breakpoint
ALTER TABLE "arena_leadership_events" DROP COLUMN "cell_size";