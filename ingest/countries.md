# Country Arena source

`countries.geojson` is a checked-in, curated derivative of Natural Earth's
**1:10m Admin-0 Sovereignty** dataset, version **5.1.1**.

- Source download: <https://naciscdn.org/naturalearth/10m/cultural/ne_10m_admin_0_sovereignty.zip>
- Dataset page: <https://www.naturalearthdata.com/downloads/10m-cultural-vectors/10m-admin-0-details/>
- Retrieved: 2026-07-20
- Coordinate reference system: WGS 84 (EPSG:4326)
- License: Natural Earth data is public domain under its terms of use:
  <https://www.naturalearthdata.com/about/terms-of-use/>

The upstream FeatureCollection contains 209 records. The curation accepts only
records whose upstream `TYPE` is `Sovereignty` or `Sovereign country`, then
requires a Polygon/MultiPolygon and a two-letter ISO code. This removes the 11
`Indeterminate`, one `Breakaway`, and one `Disputed` record (including
Antarctica, Kosovo, and Western Sahara); Natural Earth's sovereignty layer
already omits dependency, lease, and constituent-country map-unit records.
Two contested records labelled `Sovereign country` (Somaliland and Northern
Cyprus) have no ISO-2 code and are also excluded. The result is exactly 194
features.

Properties are mapped from the source shapefile fields as follows:

- `sovereign_id` = `SOV_A3`
- `source_id` = numeric `NE_ID`
- `iso_code` = valid `ISO_A2_EH`, falling back to valid `ISO_A2`
- `name` = `ADMIN` (falling back to `NAME_EN`/`NAME`)

The two source exceptions are explicit: `SOV_A3` `GB1` is overridden to `GB`
and `IS1` to `IL` because the source ISO exception field is unusable. Palestine
is not a separate sovereignty-layer feature under Natural Earth's de-facto
policy (it is represented within Israel); Kosovo is `TYPE=Disputed`; Western
Sahara is `TYPE=Indeterminate`; and Somaliland/Northern Cyprus are omitted as
contested records without ISO-2 identities.

Each feature carries a stable Natural Earth sovereign identifier (`sovereign_id`),
Natural Earth numeric feature identifier (`source_id`), uppercase ISO-2 code
(`iso_code`), and display name (`name`).
