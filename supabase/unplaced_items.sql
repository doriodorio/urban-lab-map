-- Lets an item exist without a coordinate.
--
-- Until now every item carried a point, a line or a region, because the
-- column would not accept anything else. That forced a student holding an
-- article about urban renewal into one of two bad answers: invent a location,
-- or don't record the source at all. Inventing is the worse of the two,
-- because it is invisible - the map shows a pin and nothing says it was a
-- guess.
--
-- An item with a null geometry is drawn in the margin beside the map rather
-- than on it: a column just outside the project perimeter, in the white
-- space, in the order the group gathered them. It is clickable and linkable
-- like any other item, which is the whole point - "this article explains that
-- photograph" is often the finding.
--
-- The position of that column is computed when the map is drawn and is never
-- stored. Writing the perimeter's corner into the row would put a tight
-- cluster of coordinates at one spot, which reads to anything else that opens
-- the data - QGIS, a GeoJSON export - as a real concentration of findings.
-- That is the exact falsehood this is meant to avoid, so the honest value is
-- no value.
--
-- Safe to run twice. Nothing existing changes: every current row has a
-- geometry and keeps it.

alter table items
  alter column geometry drop not null;
