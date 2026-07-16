CREATE TABLE "launch_area_cells" (
	"launch_area_id" uuid,
	"cell_size" integer,
	"x" integer,
	"y" integer,
	CONSTRAINT "launch_area_cells_pkey" PRIMARY KEY("launch_area_id","cell_size","x","y")
);
--> statement-breakpoint
CREATE TABLE "launch_areas" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"source_id" bigint NOT NULL CONSTRAINT "launch_areas_source_id_unique" UNIQUE,
	"name" text NOT NULL,
	"country" text NOT NULL,
	"state" text NOT NULL,
	"city" text NOT NULL,
	"location" geometry(point,4326) NOT NULL,
	"altitude_meters" integer NOT NULL,
	"timezone" text NOT NULL,
	"area" geometry(multipolygon,6933)
);
--> statement-breakpoint
CREATE INDEX "launch_area_cells_cell_idx" ON "launch_area_cells" ("cell_size","x","y","launch_area_id");--> statement-breakpoint
CREATE INDEX "launch_areas_area_gist_idx" ON "launch_areas" USING gist ("area") WHERE "area" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "launch_area_cells" ADD CONSTRAINT "launch_area_cells_launch_area_id_launch_areas_id_fkey" FOREIGN KEY ("launch_area_id") REFERENCES "launch_areas"("id") ON DELETE CASCADE;