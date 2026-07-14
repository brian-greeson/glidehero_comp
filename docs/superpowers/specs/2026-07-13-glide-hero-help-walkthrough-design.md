# Glide Hero Help Walkthrough Design

## Goal

Add an on-demand, three-step dashboard walkthrough that explains grid-cell claims and enclosed-area claims without changing backend behavior or storing completion state.

## Scope

- Replace the authenticated dashboard's disabled `?` stub with an enabled help trigger.
- Render a reusable Vento onboarding component only for authenticated users.
- Present three steps in a native `<dialog>`:
  1. “Welcome to Glide Hero!” — “Every flight is a chance to paint the map. Here’s how your track turns into territory.”
  2. “Claim cells as you fly” — “Your flight track claims every new cell it crosses. Explore new lines and watch the sky fill with your color.”
  3. “Close the loop” — “When your flight path forms a closed loop, every grid cell inside it becomes yours.”
- Use the existing Glide Hero logo and the signed-in pilot's territory color.
- Animate an inline SVG flight track that claims crossed cells in sequence and an inline SVG closed loop that fills every enclosed cell.
- Provide Back, Next, Done, close, Escape, backdrop-click, progress, focus-trap, and focus-restoration behavior.
- Use a side-by-side composition at widths of 700px and wider. Below 700px, place the animation before the copy and allow the dialog body to scroll on short screens.

## Non-goals

- No automatic opening, completion persistence, API, database, session, upload, or MapLibre changes.
- No runtime dependencies or new media assets.
- The walkthrough does not replace or alter the currently implemented free-polygon claim system; it previews the planned grid-cell system.
- Progress indicators are status-only and are not direct navigation controls.

## Architecture

`src/views/components/onboarding.vto` owns the reusable semantic dialog and both decorative inline SVG demonstrations. `src/views/pages/index.vto` owns the dashboard trigger and includes the component only inside the authenticated branch, passing the current user's territory color through a component-level CSS custom property.

`public/scripts/onboarding.js` exports `initializeOnboarding({ documentRef })`. It discovers the component through data hooks, returns without side effects when the trigger or required dialog markup is absent, resets to the first step whenever opened, updates active-step and navigation state, closes through every supported dismissal path, traps Tab within the visible dialog controls, and restores focus to the element that opened the dialog. `public/scripts/dashboard.js` imports and invokes it without coupling onboarding state to the map or account controls.

`public/styles/app.css` defines the dialog presentation, responsive breakpoint, visible focus, 44px controls, orange flight-track drawing and territory-color fill sequences, completed-state pauses, and reduced-motion final states. Hidden steps do not animate because animation selectors require the active-step data attribute. The visual remains on the left and the lesson remains on the right throughout the wide-screen walkthrough.

## Accessibility and failure behavior

- The dialog uses `aria-labelledby`, each step has a heading, decorative SVGs are hidden from assistive technology, and the progress list has an accessible label.
- The native modal dialog supplies page-level modality; the controller additionally wraps Tab and Shift+Tab among visible dialog controls.
- Escape is handled through the dialog's `cancel` event. The close button, Done, backdrop click, and Escape converge on `dialog.close()` and the same focus-restoration path.
- If onboarding markup is missing, initialization is a no-op. If CSS animation is unavailable, the copy and SVG markup remain usable. Under `prefers-reduced-motion: reduce`, both demonstrations render their completed state without animation.

## Testing and validation

- Renderer tests verify the component is authenticated-only, the help trigger is enabled, all steps and controller hooks render, and `--territory-color` receives the signed-in user's escaped value.
- Controller tests use lightweight DOM fakes to cover open/reset, forward/back, Done, close button, Escape, backdrop click, focus trap/restoration, reopening, active-step animation state, and missing-markup safety.
- A stylesheet contract test verifies the 700px breakpoint, short-screen scrolling, active-only animations, reduced-motion final state, visible focus, and 44px controls.
- Manual browser validation covers 375×667, 390×844, short landscape, widths immediately below and at 700px, and desktop.
- Final verification runs `npm test`, `npm run typecheck`, and `npm run build`.
