# Onboarding enclosure animation

## Goal

Make the "Close the loop" walkthrough illustration show the same claim order as the
game: cells crossed by the flight are claimed as the glider draws the loop, and cells
inside the loop are claimed only after the loop closes.

## Design

The loop SVG will contain a separate set of boundary-cell rectangles in addition to
the existing interior-cell rectangles. The boundary cells will use the direct-claim
animation with staggered delays aligned to the loop-drawing duration. Interior cells
will retain a separate enclosure animation, but its visible phase will start after
the loop stroke reaches its closed state. The direct cells remain visible while the
interior cells fill, so the final frame shows the completed claim.

This is a template-and-stylesheet-only change. It does not alter grid-claim service
semantics, onboarding navigation, or reduced-motion behavior. Reduced motion will
continue to render both boundary and enclosed cells as already claimed.

## Verification

Add stylesheet contract coverage for the loop boundary animation and its timing, and
run the focused onboarding tests plus the project test suite where practical.
