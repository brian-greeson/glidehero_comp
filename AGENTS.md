# Agent instructions

## WorkTrees

worktrees are created in the .worktrees directory in the project root. The environment setup scripts create an isolated db per worktree. Use npm run db:push to update changes in the worktree database. The db is shared between agents working in the same worktree.

## Drizzle

This project uses the Drizzle ORM and Drizzle Kit 1.0 release candidates. When working with Drizzle, use documentation and APIs for version 1.0 or later. Do not rely on documentation, examples, or behavior from pre-1.0 versions, as those may be incompatible.

## View Templates

- Common components like, forms, tables, and cards should be reusable templates.
- Prefer breaking views into individual files for reuse later
- Only create a new component if an existing component for that feature does not exists or would have to be modified so drastically that it would require significate refactoring of existing views.

## Postgresql

The db is postgresql with the postgis extension installed.

## Local admin authentication

Use these development-only credentials when an authenticated admin UI flow must be reproduced or verified locally:

- Email: `dev@example.com`
- Password: `abc123`

These credentials are for the local development environment only and must not be used for production.

## Implementation guidelines

- Understand the existing implementation before changing architecture.
- Prefer following established patterns of services, domain, routes, views
- Prefer small, targeted changes over broad refactors.
- Reuse existing utilities, components, and patterns before creating new abstractions.
- Do not add dependencies unless they provide a clear advantage over the existing stack.
- Do not change unrelated code.
- Preserve existing behavior unless the task explicitly requires changing it.
- Work in vertical slices of functionality. Fore example

## Implement features as thin vertical slices

When a feature spans multiple architectural layers, implement it as a sequence of small, end to end vertical slices.

Do not complete an entire layer before moving to the next layer.

For a feature that follows a path such as:

`endpoint -> service -> data access -> database`

first establish the smallest complete path through every required layer.

Example:

1. Add the endpoint or other entry point.
2. Add the minimal service method it calls.
3. Add the minimal repository, query, getter, or data access function the service requires.
4. Connect the path to the database or final dependency.
5. Return the smallest real result that proves the complete path works.

The first slice should be thin, but it should be integrated and executable. Avoid disconnected stubs, large blocks of speculative code, or implementing substantial logic in one layer before the rest of the path exists.

After the initial path works, add functionality incrementally.

For each additional behavior:

1. Define one small, observable behavior.
2. Implement only the changes required at the entry point.
3. Propagate that behavior through the service layer.
4. Add the required data access or persistence behavior.
5. Add or update tests for that behavior.
6. Verify the complete end to end path before starting the next behavior.

Each slice should leave the system in a coherent state.

Prefer:

1. Minimal endpoint -> minimal service -> minimal query -> database.
2. Verify the path.
3. Add one behavior through the entire stack.
4. Verify it.
5. Repeat.

Avoid:

1. Building all endpoints.
2. Then building all services.
3. Then building all data access code.
4. Then connecting and debugging everything at the end.

Do not add placeholder abstractions merely to satisfy the layering pattern. Follow the existing architecture and introduce only the interfaces, methods, and abstractions required by the current slice.

When a temporary minimal implementation is necessary, keep it explicit and replace it as part of the next slice. Do not leave disconnected TODO implementations behind.

The goal is continuous integration of the feature. At each meaningful step, there should be a small but working path through every affected layer, with complexity added incrementally rather than accumulated separately.

## When requirements are unclear

- Inspect the existing code, tests, and documentation first.
- When implementation details are still genuinely ambiguous, state the assumption being made rather than silently inventing product behavior.
- Ask for clarification until a shared understanding of the requirements becomes clear


## Project Architecture
>> Where to put files
parse `docs/architecture.md` for a description of the app architecture
