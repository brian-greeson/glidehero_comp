# Thermal data operations

GlideHero uses Thermal.kk's historical thermal raster as a passive planning
layer. It is historical activity data, not a weather forecast or safety aid.

## Cache-aside delivery

Authenticated map requests use GlideHero's tile endpoint. Each request first
looks for the raster in the private Space named by `BUCKET_TILES_NAME`. A miss
is fetched from Thermal.kk, returned to the user, and stored at:

```text
{z}/{x}/{tms-y}.png
```

Thermal keys are rooted directly in their dedicated bucket. They do not use
the shared `BUCKET_FOLDER` prefix, a source-layer folder, or an additional
`thermal_tiles` folder.

MapLibre requests XYZ coordinates; Thermal.kk and the object key use TMS Y
coordinates. Keep that conversion at the HTTP boundary.

Native zoom-12 cache entries are marked for vector processing. Lower zooms are
cached for display but are not vectorized.

## Dedicated worker

The thermal worker uses the same PostgreSQL connection, Spaces endpoint, and
Spaces credentials as the web process. Thermal raster reads and writes use the
dedicated `BUCKET_TILES_NAME` bucket; flight uploads and thumbnails continue to
use `BUCKET_NAME`. When the dedicated machine keeps those settings in
`.env.production`, run it with:

```bash
npm run prod:thermal-worker
```

For local development, use `npm run dev:thermal-worker`. To validate a single
unit of work, run `npm run dev:thermal-worker -- --once`.

In a deployment environment that injects variables directly, build once and use
`npm run thermal-worker` to run the compiled entry point.

The worker prioritizes already-cached rasters, then claims one tile from a
running admin crawl. Claims use short database leases so an interrupted worker
can be safely replaced. Raster processing replaces a tile's areas in one
transaction and records the raster checksum and processing version.

## Admin targeting

Admins can open `/admin/thermal`, name a crawl, and draw one bounded polygon.
The job expands that polygon into intersecting native zoom-12 tiles. Jobs are
limited to 20,000 tiles and can be paused, resumed, or cancelled.

## Activity bands

Vectorization stores four relative bands derived from the source colors:

- dark blue: lowest relative activity
- cyan: higher relative activity
- yellow/orange: stronger relative activity
- red: strongest relative activity

These are relative historical bands. They deliberately have no probability,
hover, tap, or hotspot-click behavior in the Plan UI.
