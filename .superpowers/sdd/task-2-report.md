# Task 2 — Pure, segmented IGC parser report

## Scope

Implemented the requested six dependency-free parser modules and a behavior test suite in the isolated worktree:

- `src/domain/igc/types.ts`
- `src/domain/igc/errors.ts`
- `src/domain/igc/fix.ts`
- `src/domain/igc/timestamp.ts`
- `src/domain/igc/distance.ts`
- `src/domain/igc/parseIgcFlight.ts`
- `test/unit/parseIgcFlight.test.ts`

No S3, Drizzle, or web-layer code was changed.

## RED evidence

Command:

```sh
npx vitest run test/unit/parseIgcFlight.test.ts
```

Result: failed as expected before production code existed. Vitest could not resolve `../../src/domain/igc/errors.js`, because the requested parser modules had not yet been created.

## Resolution and GREEN evidence

Command:

The initial focused run had 6 passing tests and 1 failing test. The failing assertion was the brief's `distanceMeters < 90` expectation, while the correct implementation returns `140.07098702118256` meters.

The acceptance criteria were then clarified: duplicate and arbitrarily close valid fixes must parse; zero total distance is valid. The sample expectation was corrected to 135–145 m and a duplicate-fix zero-distance behavior test was added.

Command:

```sh
npx vitest run test/unit/parseIgcFlight.test.ts
```

Result: PASS — 1 test file, 8 tests.

## Final verification evidence

Command:

```sh
npm test
```

Result: the full suite could not complete green because five existing `test/unit/webRouter.test.ts` HTTP tests timed out at their configured 5 seconds. A verbose, single-worker rerun identified all five failures as web-router tests; the parser test file was not among them. No parser code was modified while investigating these failures.

Command:

```sh
npm run typecheck
```

Result: PASS (exit code 0).

## Resolved semantic issue

The representative fixed-width records differ by `00060` thousandths of a minute in *both* latitude and longitude:

```text
B2359584000000N10500000WA0123401234
B0000024000060N10500060WA0123501235
```

In IGC B records, `600`? No: the `060` fields are 0.060 minutes, not 0.060 thousandths of a degree. At latitude 40°, the latitude change is approximately 111.2 m and the longitude change approximately 85.2 m. Their Haversine distance is approximately 140.07 m. Therefore the requested 70–90 m range is incompatible with correct IGC fixed-width decoding and Haversine calculation.

The fixture expectation was corrected without changing the fixed-width decoding or Haversine calculation. A separate regression test proves that identical valid fixes parse successfully with a distance of zero.
