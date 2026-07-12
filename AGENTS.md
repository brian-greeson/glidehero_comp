# Agent instructions

## WorkTrees

worktrees are created in the .worktrees directory in the project root.

## Drizzle

This project uses the Drizzle ORM and Drizzle Kit 1.0 release candidates. When working with Drizzle, use documentation and APIs for version 1.0 or later. Do not rely on documentation, examples, or behavior from pre-1.0 versions, as those may be incompatible.

## Templates

when building views or UI, common components like, forms, tables, and cards should be reusable templates. only create a new component if an existing component for that feature does not exists or would have to be modified so drastically that it would require significate refactoring of existing views.

## Postgresql

The db is postgresql with the postgis extension installed. 