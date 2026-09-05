-- Backfill: mark the two layers that were imported from geotagged photographs.
--
-- WHAT THIS IS BASED ON
--   Not on anything recorded in the database - nothing was, which is why the
--   column exists now. It rests on how these two layers were made: both came
--   through the bulk photo import, which only placed a photograph once it had
--   read GPS out of the file. Dori confirmed it.
--
--   So this is a considered claim, not a measurement. Two things it cannot
--   see, both worth knowing:
--
--   * If any item in these layers was dragged after import, this marks it
--     'photo' anyway, and it will draw as a filled circle when it deserves a
--     hollow one. From here on that cannot happen - dragging demotes to
--     'moved' by itself - but it is not retroactive.
--   * IMG_5296 was noticed sitting about six metres off its EXIF position
--     earlier in the build. Within what a filled circle promises, but it is
--     the kind of thing this backfill cannot check.
--
-- DELIBERATELY NOT INCLUDED
--   shushan - בור  — 22 WhatsApp images. WhatsApp strips EXIF, so these were
--                    placed by hand and a square is the honest mark.
--   Everything else — notes, citations, videos, links: never had a position
--                    to measure.

begin;

do $$
declare
  touched int;
begin
  update items i
  set located_by = 'photo'
  from layers l
  where i.layer_id = l.id
    and l.name in ('zdaka images', 'charity boxes')
    -- Only fill the blanks. Anything already answered was answered by the app
    -- knowing what it did, which beats a guess made here.
    and i.located_by is null;

  get diagnostics touched = row_count;
  raise notice 'Marked % items as located by photograph.', touched;
end $$;

commit;

-- Check afterwards:
-- select l.name, i.located_by, count(*)
-- from items i join layers l on l.id = i.layer_id
-- group by l.name, i.located_by
-- order by l.name;
