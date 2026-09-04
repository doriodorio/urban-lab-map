-- The public view opens with an argument for the project, not with the map.
--
-- Yona's sequence, from the teaching side: a statement, then a one-minute
-- film, then the material grouped so a reader can see what kind of work it is,
-- and only then the guided tour. These columns carry the first two.
--
-- All nullable: a project with none of them simply opens on its map the way it
-- does today, so nothing that exists now breaks.
--
-- get_public_project() returns `to_jsonb(p) - 'created_by'`, so these reach the
-- public viewer with no change to the function.

alter table projects
  add column if not exists statement text,          -- up to ~2 paragraphs
  add column if not exists cover_image_url text,    -- shown beside the statement
  add column if not exists doco_url text;           -- the one-minute film

-- Whether an item is theory or field.
--
-- Nullable, and null means "work it out from the item's type" - which is what
-- makes this usable on a project that already has items. It is only written
-- when someone disagrees with the guess. See src/lib/categories.ts, which owns
-- both the default and the list of valid values.
alter table items
  add column if not exists category text;
