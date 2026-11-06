-- Extends what `items.located_by` is allowed to mean. No DDL: the column is
-- already text and already nullable, so this only records the vocabulary in
-- the database itself, where the next person to open a psql prompt will find
-- it. Optional to run, and safe to run twice.
--
-- The original column was written with this in mind - "deliberately not a
-- boolean; 'located by what' leaves room for a third answer" - and two
-- answers have now been added.
--
-- The one that matters is 'about'. A pin asserts something, and until now it
-- asserted the same thing whatever put it there: a photograph's GPS and an
-- article about a neighbourhood were drawn as equally located. That is what
-- makes density stop being evidence - twelve articles dropped around one
-- street read as twelve findings standing in it. 'about' says the coordinate
-- is the item's subject rather than its origin, which is a true and useful
-- thing to record, and the application excludes those items from the project
-- perimeter so a group's study area stays "where we walked".
--
-- Nothing is backfilled. Existing rows are null, which already means "placed
-- by hand, origin unknown", and that is the honest reading of them.

comment on column items.located_by is
  $$How this item came to be where it is.

'photo'    - the coordinates came out of the photograph's own GPS; the camera
             stood here, to within a few metres. Drawn as a filled circle.
'moved'    - began as one of those and was then moved by hand. The photograph
             still vouches for the picture, not for the place. Hollow circle.
'surveyed' - someone states they were here. A claim rather than a
             measurement, but an explicit one. Filled square.
'about'    - the coordinate is the item's SUBJECT, not its origin: an article
             about this street, written elsewhere. Dashed square, and
             excluded from the derived project perimeter.
null       - unknown. Every item recorded before this was tracked. Claiming a
             precision nobody can vouch for is the worse mistake.$$;
