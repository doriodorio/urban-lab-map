-- How an item came to be where it is.
--
-- 'photo' — the coordinates came out of the photograph's own GPS, so the point
--           is where the camera stood, to within a few metres. Drawn as a
--           filled circle.
-- 'moved' — it began as one of those and was then moved by hand. The
--           photograph vouches for the picture but no longer for the place.
--           Drawn as a hollow circle.
--
-- Null is everything else: placed by hand, or a photograph that carried no GPS
-- at all. Drawn as a square. Every item that existed before this column is
-- null, and claiming a precision nobody can vouch for is the worse mistake.
--
-- Deliberately not a boolean. "Located by what" leaves room for a third
-- answer - an address lookup, a point traced off a survey - where
-- "is_precise" would have to be argued about.

alter table items
  add column if not exists located_by text;
