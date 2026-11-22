-- Adds 'device' to what `items.located_by` is allowed to mean. No DDL: the
-- column is text and already holds this vocabulary, so this only records the
-- new value in the database itself, where the next person to open a psql
-- prompt will find it. Optional to run, and safe to run twice.
--
-- The gap it fills: this tool calls itself a field archive made on foot, and
-- the one thing a person standing in the street could not do was say "it is
-- here". They had to find the spot on a map by eye and tap it, which was
-- recorded as 'surveyed' - a claim of unknown precision - even while they
-- stood on it. For a photograph the camera answers. For a sound, a smell or
-- the feel of a wall there is no file to read, and those are exactly the
-- things that can only be recorded by being there.
--
-- A reading taken from the device while someone stands on the spot is a
-- measurement, in the same sense a camera's GPS is: an instrument reported a
-- position. So it is drawn the same way, as a filled circle, and the form
-- stops asking what the pin means - the question has been answered better
-- than a tired student could answer it.
--
-- The application only writes this value when the device admits to an
-- accuracy of 40 metres or better. A looser fix still places the point,
-- because a rough centre beats scrolling across a city, but it arrives as an
-- ordinary hand-placed one. A 1200-metre "fix" stored as a measurement would
-- put the project's most confident mark on a coordinate nobody measured.
--
-- Nothing is backfilled. No existing row was placed this way.

comment on column items.located_by is
  $$How this item came to be where it is.

'photo'    - the coordinates came out of the photograph's own GPS; the camera
             stood here, to within a few metres. Drawn as a filled circle.
'device'   - the device measured the position while someone stood there, with
             no photograph to carry the reading. Written only for a fix of 40m
             or better. A measurement, like 'photo'. Filled circle.
'moved'    - began as one of those two and was then moved by hand. The reading
             still vouches for the material, not for the place. Hollow circle.
'surveyed' - someone states they were here. A claim rather than a
             measurement, but an explicit one. Filled square.
'about'    - the coordinate is the item's SUBJECT, not its origin: an article
             about this street, written elsewhere. Dashed square, and
             excluded from the derived project perimeter.
null       - unknown. Every item recorded before this was tracked. Claiming a
             precision nobody can vouch for is the worse mistake.$$;
