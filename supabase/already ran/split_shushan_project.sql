-- One-off: split the Shushan material out of the test project into its own.
--
-- Run this in the Supabase SQL editor, once. It is not part of the app - the
-- app has no "move items between projects" feature, and does not need one for
-- a class of six groups.
--
-- WHAT IT DOES
--   Creates a project called "שושן" owned by, and shared with, everyone who is
--   already a member of the source project. Recreates these four layers in it,
--   keeping their names and colours:
--
--     ראיונות · shushan - video · shushan - articles · shushan - בור
--
--   Then MOVES every item in those layers - 27 at the time of writing - out of
--   the source project and into the new one. The originals do not stay behind.
--
-- WHAT THIS CHANGES THAT YOU MIGHT NOT EXPECT
--   * The source project's published link loses those 27 items. It keeps its
--     other 25 (musrara, charity boxes, zdaka images) and its guided tour,
--     whose three stops are all items that stay.
--   * The new project is NOT published. Publish it from its own Settings when
--     you want a link.
--   * Photographs keep working. Their files stay in the old project's storage
--     folder, but items store absolute public URLs, so nothing breaks. The
--     files are simply filed under the old project's id - harmless, and only
--     worth knowing if you ever delete the source project, which would take
--     its storage folder with it.
--   * Any item-to-item link between a moved item and one left behind will now
--     span two projects. Nothing breaks; the link just will not be reachable
--     from either side's picker.
--
-- SAFE TO STOP: everything is in one transaction, so if any statement fails
-- nothing at all is applied.

begin;

do $$
declare
  source_project uuid;
  new_project uuid;
  moved int;
  layer_names text[] := array[
    'ראיונות',
    'shushan - video',
    'shushan - articles',
    'shushan - בור'
  ];
begin
  -- Identified by its published slug rather than a pasted id, so this cannot
  -- be pointed at the wrong project by a copy-paste slip.
  select id into source_project
  from projects
  where public_slug = 'test-edited-608cd91c';

  if source_project is null then
    raise exception 'Source project not found. Check the slug.';
  end if;

  insert into projects (name, description, created_by)
  select 'שושן',
         'רחוב שושן, ירושלים — הבור והזיכרון החומרי',
         created_by
  from projects
  where id = source_project
  returning id into new_project;

  -- Everyone who could see the material before can still see it. Doing this
  -- from the source project's membership rather than a single owner means a
  -- group does not lose access to its own work.
  insert into project_members (project_id, user_id, role)
  select new_project, user_id, role
  from project_members
  where project_id = source_project;

  -- Recreate the layers, remembering which new layer replaces which old one.
  create temporary table layer_move on commit drop as
  select l.id as old_id, gen_random_uuid() as new_id, l.name, l.color
  from layers l
  where l.project_id = source_project
    and l.name = any(layer_names);

  if (select count(*) from layer_move) <> array_length(layer_names, 1) then
    raise exception 'Expected % layers, found %. Names may have changed again.',
      array_length(layer_names, 1), (select count(*) from layer_move);
  end if;

  insert into layers (id, project_id, name, color)
  select new_id, new_project, name, color from layer_move;

  -- The move itself. Items keep their ids, so item_links, thread_items and
  -- anything else pointing at them stays pointing at them.
  update items i
  set project_id = new_project,
      layer_id = m.new_id,
      updated_at = now()
  from layer_move m
  where i.layer_id = m.old_id
    and i.project_id = source_project;

  get diagnostics moved = row_count;

  -- The old, now-empty layers go with them; leaving them behind would show
  -- the source project four layers that can never contain anything.
  delete from layers where id in (select old_id from layer_move);

  raise notice 'Created project % and moved % items into it.', new_project, moved;
end $$;

commit;

-- Check afterwards: the new project should hold 27 items across 4 layers.
-- select p.name, count(i.id)
-- from projects p left join items i on i.project_id = p.id
-- where p.name in ('שושן', 'test - edited')
-- group by p.name;
