# Database changes

Everything here is run by hand, in the Supabase SQL editor. There is no
migration runner: for one database and a handful of changes a term, a folder
and a convention beat a tool.

## The convention

**A new `.sql` file goes in this folder.** Once it has been run against the
database, it moves into `already ran/`. So anything sitting loose here is
outstanding — that is the whole point of the split, and the only thing you
have to remember.

## Running one

Supabase dashboard → your project → **SQL Editor** → New query → paste →
**Run**. Supabase warns about pasting SQL you have not read; the file's own
comments say what it does and why.

Most files use `if not exists` / `create or replace`, so running one twice is
harmless. The exceptions are called out below.

## What is in `already ran/`

Two of these are not migrations and are worth keeping open:

- **`schema.sql`** — the current shape of every table, with the reasoning.
  The reference, not a one-time script.
- **`rls.sql`** — who can read and write what. `is_project_member()` lives
  here, and almost every policy routes through it, so it is the first place to
  look when something is unexpectedly permitted or refused.

One is a one-off that should not be run again:

- **`split_shushan_project.sql`** — moved the Shushan material into its own
  project. Re-running it would try to create a second one, but it checks that
  it found exactly four layers to move and aborts if not, so a second run
  fails cleanly rather than making a mess.

The rest are ordinary migrations, in roughly the order they were applied:
`create_project`, `storage`, `functions`, `week5_links`, `profiles`,
`purge_items`, `soft_delete`, `base_map_style`, `project_statement`,
`project_trash`.

## Order

Only where one file depends on another. `project_trash.sql` redefines
`get_public_project()` including the `items.deleted_at` filter that
`soft_delete.sql` introduced, so it has to come after it. Everything else is
independent.
