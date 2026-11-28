-- The board: where an item sits when it is being thought about rather than
-- found somewhere.
--
-- Run this once. Safe to run twice.
--
-- WHY THIS EXISTS
--
-- Counted on 27 November 2026, the archive held 463 items: 449 photographs,
-- 6 notes, 3 documents. Not one item had a body longer than 200 characters,
-- and 8 links existed across 4 of 13 projects. A week in which the groups
-- read articles, wrote out concepts and built comparisons left almost nothing
-- here; it went to Miro instead.
--
-- The reason is in the schema as much as the interface. `geometry` is where
-- an item is, and until now an item without one had nowhere to be at all -
-- it appeared in a strip at the edge of the map, which is somewhere to put a
-- leftover, not somewhere to work. An article about a street is not a
-- leftover. It is often the thing the fieldwork is answering.
--
-- WHAT IT IS, AND WHAT IT IS NOT
--
-- `canvas` is {"x": <number>, "y": <number>, "w": <number>}: a position and a
-- display width on the project's board, in board units. Null means the item
-- is not on the board.
--
-- It is NOT a location, and nothing may ever read it as one. A coordinate in
-- `geometry` says where in the world something was; a coordinate in `canvas`
-- says where on a page somebody dragged it, which carries no claim about
-- anywhere. The whole discipline of `located_by` exists to stop exactly that
-- confusion, and this column is the one most able to reintroduce it.
--
-- Three consequences follow, and they are the reason this comment is longer
-- than the DDL:
--
--   * The GeoJSON export must never emit `canvas` as a geometry. An unplaced
--     item keeps "geometry": null however it is arranged on the board.
--   * The derived project perimeter must never see it. The perimeter is the
--     extent of the fieldwork, not of the reading.
--   * Nothing is backfilled wholesale. An item that has never been put on
--     the board has no position on it, and inventing a grid for 449
--     photographs would fill the board with material nobody chose to
--     arrange.
--
--     One position is written on a group's behalf, and only one: when a card
--     is put on the board, everything linked to it is placed with it (see
--     src/app/projects/[id]/board/place-connected.ts). That is not the
--     backfill this warns about - it is bounded by links the group made
--     themselves and triggered by them placing a card - but it is the only
--     exception, it never runs on a mere page load, and it touches nothing
--     but this column.
--
-- An item may have both: a photograph can be on the map and also pulled onto
-- the board to sit beside the article that explains it. The two are
-- independent, which is the point.

alter table items add column if not exists canvas jsonb;

comment on column items.canvas is
  $$Where this item sits on the project's board: {"x","y","w"} in board
units, or null when it is not on the board.

A layout fact, never a location. `geometry` says where in the world the item
was; this says where on a page somebody put it. The export, the perimeter and
every map query must ignore it.$$;

-- Only the rows actually on a board, which is the only query this column
-- serves: "draw the board". Partial, because the overwhelming majority of
-- rows are photographs that have never been near it.
create index if not exists items_canvas_idx
  on items (project_id)
  where canvas is not null;
