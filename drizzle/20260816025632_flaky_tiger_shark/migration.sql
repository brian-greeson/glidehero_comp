CREATE TABLE "flight_map_features" (
	"flight_id" uuid PRIMARY KEY,
	"projection_version" integer NOT NULL,
	"full_track" geometry(MultiLineString,4326) NOT NULL,
	"west" double precision NOT NULL,
	"south" double precision NOT NULL,
	"east" double precision NOT NULL,
	"north" double precision NOT NULL,
	"crosses_antimeridian" boolean NOT NULL,
	"landing_latitude" double precision NOT NULL,
	"landing_longitude" double precision NOT NULL,
	"source_point_count" integer NOT NULL,
	"projected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "flight_map_features_projection_version_positive" CHECK ("projection_version" > 0),
	CONSTRAINT "flight_map_features_source_point_count_valid" CHECK ("source_point_count" >= 2),
	CONSTRAINT "flight_map_features_latitude_bounds_valid" CHECK ("south" >= -90 AND "north" <= 90 AND "south" <= "north"),
	CONSTRAINT "flight_map_features_longitude_bounds_valid" CHECK ("west" >= -180 AND "west" <= 180 AND "east" >= -180 AND "east" <= 180)
);
--> statement-breakpoint
CREATE TABLE "flight_map_geometry_lods" (
	"flight_id" uuid,
	"projection_version" integer,
	"min_zoom" integer,
	"max_zoom" integer NOT NULL,
	"tolerance_meters" double precision NOT NULL,
	"geometry" geometry(MultiLineString,4326) NOT NULL,
	"point_count" integer NOT NULL,
	CONSTRAINT "flight_map_geometry_lods_pkey" PRIMARY KEY("flight_id","projection_version","min_zoom"),
	CONSTRAINT "flight_map_geometry_lods_projection_version_positive" CHECK ("projection_version" > 0),
	CONSTRAINT "flight_map_geometry_lods_zoom_range_valid" CHECK ("min_zoom" >= 0 AND "max_zoom" >= "min_zoom"),
	CONSTRAINT "flight_map_geometry_lods_tolerance_positive" CHECK ("tolerance_meters" > 0),
	CONSTRAINT "flight_map_geometry_lods_point_count_valid" CHECK ("point_count" >= 2)
);
--> statement-breakpoint
CREATE INDEX "flight_map_features_full_track_gist_idx" ON "flight_map_features" USING gist ("full_track");--> statement-breakpoint
CREATE INDEX "flight_map_geometry_lods_geometry_gist_idx" ON "flight_map_geometry_lods" USING gist ("geometry");--> statement-breakpoint
CREATE INDEX "flight_map_geometry_lods_zoom_idx" ON "flight_map_geometry_lods" ("min_zoom","max_zoom");--> statement-breakpoint
ALTER TABLE "flight_map_features" ADD CONSTRAINT "flight_map_features_flight_id_flights_flight_id_fkey" FOREIGN KEY ("flight_id") REFERENCES "flights"("flight_id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "flight_map_geometry_lods" ADD CONSTRAINT "flight_map_geometry_lods_flight_id_flights_flight_id_fkey" FOREIGN KEY ("flight_id") REFERENCES "flights"("flight_id") ON DELETE CASCADE;