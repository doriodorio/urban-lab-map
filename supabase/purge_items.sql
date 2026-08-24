-- Permanent deletion of items, restricted to whoever created them.
--
-- Soft delete (see soft_delete.sql) means nothing ever leaves the Trash, so
-- items and their uploaded files accumulate forever. This adds a real purge -
-- but a narrow one: only the person who added an item can destroy it for
-- good. Everyone in a project can still soft-delete anything (the flat
-- permission model is deliberate for v1); that stays undoable by anyone.
--
-- `items_all_members` covered every command including DELETE, so it's split
-- here: read/insert/update stay open to members, DELETE narrows to the
-- creator. Without this the ownership rule would live only in the server
-- action, which a member could bypass by calling PostgREST directly.
--
-- Note: items created before created_by was populated have it null, and
-- `created_by = auth.uid()` is false for null - so those can't be purged by
-- anyone. That's the intended reading of "your own items"; clearing them out
-- needs a deliberate admin pass.
--
-- When instructors get purge rights later, extend the delete policy's using()
-- clause rather than reopening it to all members.

drop policy if exists "items_all_members" on items;

create policy "items_select_members" on items
  for select using (is_project_member(project_id));

create policy "items_insert_members" on items
  for insert with check (is_project_member(project_id));

create policy "items_update_members" on items
  for update
  using (is_project_member(project_id))
  with check (is_project_member(project_id));

create policy "items_delete_creator" on items
  for delete using (
    is_project_member(project_id)
    and created_by = auth.uid()
  );
