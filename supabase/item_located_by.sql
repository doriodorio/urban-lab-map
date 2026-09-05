-- How an item came to be where it is.
--
-- 'photo'  — the coordinates came out of the photograph's own GPS, so the
--            point is where the camera stood, to within a few metres.
-- 'manual' — someone put it there by hand, or dragged it. Close enough to
--            read, but not a measurement.
--
-- Null means we do not know, which is every item that existed before this
-- column. The map draws unknown the same as manual: claiming a precision we
-- cannot vouch for is the worse of the two mistakes.
--
-- Deliberately not a boolean. "Located by what" leaves room for a third
-- answer - an address lookup, a point traced off a survey - where
-- "is_precise" would have to be argued about.

alter table items
  add column if not exists located_by text;
