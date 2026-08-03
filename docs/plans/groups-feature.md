# Groups feature implementation plan

## Product contract

Groups are private, shared, invite-only monthly competitions. They are distinct
from Following: Following is a unilateral Activity/map preference, while a group
requires accepted membership and has one shared roster and standings page.

- Owners create named groups, invite any registered pilot, remove members,
  cancel invitations, and delete the group after confirmation.
- Owners cannot leave or transfer ownership in the first release.
- Members may accept, decline, or leave. Membership changes take effect
  immediately.
- A group has at most 200 occupied places, counting the owner, accepted members,
  and pending invitations.
- Only accepted members may view a group page. Pending invitations appear only
  on the invited pilot's own profile.
- The first release exposes only the current competition `YYYY-MM`; each flight
  contributes according to its persisted launch-local competition month.
- Creating or joining during a month includes all qualifying flights from that
  month. Leaving or removal immediately removes the pilot from current results.
- The worldwide leaderboard ranks accepted members by distinct claimed cells,
  then best five-point distance. Exact ties share a rank. Members without a
  qualifying flight show `Not ranked yet`. Every exact longest-distance leader
  receives a trophy marker.
- The default group map shows accepted members' monthly competition territory.
  Selecting a pilot filters territory and flights to that pilot. Selecting a
  flight overlays only that track; changing/clearing the pilot clears the track.
- No archives, custom periods, email notifications, group images, descriptions,
  chat, posts, or primary Groups navigation item are included.

## Visual contract

The mockups in `docs/mockups/groups/` are the hierarchy and interaction
references, not raster assets to ship in the application.

- Current profile only: full-width Groups card above Recent Flights, membership
  rows with rank/cells/distance/trophy, and a separate pending-invitation panel.
- Desktop group page: compact identity header, standings beside the territory
  map, and paginated flights below.
- Mobile group page: identity, map, standings, then flights, preserving the
  existing header and bottom navigation.
- Selected pilot territory uses the pilot color, shared cells remain neutral,
  and the selected track uses a contrasting orange line.
- Initials provide group identity in the first release; custom artwork is not a
  product capability.

## Vertical slices

### 1. Persistence and membership foundation

Add `pilot_groups` and `pilot_group_memberships` plus ordered Drizzle migration.
Membership status is `pending` or `accepted`; one group/user row reserves a
place. Add indexes for group rosters, profile lookups, and monthly claims by
month/user/flight. Add a durable onboarding group-membership milestone. Preserve
completed legacy onboarding rows during migration.

Implement a group service with transactional create, delete, invite, cancel,
accept, decline, leave, remove, candidate search, private authorization, and
capacity enforcement under a group lock.

### 2. Profile and invitation loop

Add authenticated group creation and lifecycle routes. Extend only `/profile`
with accepted memberships, current rank summaries, and pending invitations.
Do not expose groups from `/pilots/:userId` and do not read or write
`pilot_follows` from group workflows.

### 3. Monthly standings

Start from all accepted members, left join distinct monthly competition claims,
derive each pilot's best five-point score from qualifying claimed flights, and
rank active pilots by cells then distance. Return top 25 plus the viewer when a
large group is initially rendered; paginate the remaining deterministic order.

### 4. Members-only page, map, and pilot filter

Add a dedicated authenticated Group page model/template/styles/script. Extend
the territory tile service with a group-scoped method that joins accepted
membership in PostgreSQL rather than sending pilot ID lists to the browser.
Keep claimant/shared-cell semantics global. Add private group tile and pilot
filter endpoints.

### 5. Flight list and selected track

Return distinct completed member flights for the selected month, newest first
with a stable flight-ID cursor. Render a group-specific table/card that includes
pilot, thumbnail, launch time, five-point distance, duration, detail link, and
track-selection action. Validate group/month eligibility before returning track
GeoJSON.

### 6. Onboarding

Add an eighth `groups` milestone under More ways to use GlideHero. It completes
durably when the pilot creates or accepts membership in a group. Correct the
Competitive Map instructions so followed pilots are never described as a
group. Existing completed onboarding must not reopen.

## Verification

- Schema and service integration coverage for constraints, cascades, capacity,
  lifecycle authorization, retroactive month behavior, ranking/ties/trophy,
  removal recalculation, group tiles, flight pagination, and track access.
- Focused router, renderer, browser-controller, and onboarding unit coverage.
- `npm run db:generate`, `npm run db:migrate`, focused tests,
  `npm run typecheck`, and `npm run build`.
- Authenticated responsive browser checks at 1200, 1024, 901, 390, and 320 px,
  including small/large, pending, unranked, selected-pilot, and selected-flight
  states. Report missing `TEST_DATABASE_URL` or sandbox constraints precisely.
- After implementation, run a dedicated code-review pass, resolve actionable
  findings, and rerun affected gates.
