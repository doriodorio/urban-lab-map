-- Row Level Security for the Urban Lab Map Tool.
-- Rule: a user can read/write projects/layers/items/item_links/threads/thread_items
-- only where they're in project_members for that project_id.
-- Anonymous (public) access is NOT granted here on purpose — the public viewer
-- reads via a separate SECURITY DEFINER function (see bottom of this file) so
-- the base tables stay closed to anon.

alter table projects enable row level security;
alter table project_members enable row level security;
alter table layers enable row level security;
alter table items enable row level security;
alter table item_links enable row level security;
alter table threads enable row level security;
alter table thread_items enable row level security;

-- Helper: is the current user a member of a given project?
create or replace function is_project_member(p_project_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from project_members
    where project_id = p_project_id
      and user_id = auth.uid()
  );
$$;

-- projects: members can read; any authenticated user can create (they become
-- a member via a follow-up insert into project_members, done in the same
-- transaction/request from the app); only members can update.
create policy "projects_select_members" on projects
  for select using (is_project_member(id));

create policy "projects_insert_authenticated" on projects
  for insert with check (auth.uid() is not null and created_by = auth.uid());

create policy "projects_update_members" on projects
  for update using (is_project_member(id));

create policy "projects_delete_members" on projects
  for delete using (is_project_member(id));

-- project_members: a member can see the roster of any project they belong to.
-- Inserts: a user can add themself (creating a project), or an existing
-- member can add someone else (inviting by email, resolved to user_id by the app).
create policy "project_members_select_members" on project_members
  for select using (is_project_member(project_id));

create policy "project_members_insert_self_or_member" on project_members
  for insert with check (
    user_id = auth.uid() or is_project_member(project_id)
  );

create policy "project_members_delete_members" on project_members
  for delete using (is_project_member(project_id));

-- layers
create policy "layers_all_members" on layers
  for all using (is_project_member(project_id))
  with check (is_project_member(project_id));

-- items
create policy "items_all_members" on items
  for all using (is_project_member(project_id))
  with check (is_project_member(project_id));

-- item_links: membership is derived from the linked items' project.
create policy "item_links_select_members" on item_links
  for select using (
    exists (
      select 1 from items
      where items.id = item_links.item_a
        and is_project_member(items.project_id)
    )
  );

create policy "item_links_insert_members" on item_links
  for insert with check (
    exists (
      select 1 from items
      where items.id = item_a and is_project_member(items.project_id)
    )
    and exists (
      select 1 from items
      where items.id = item_b and is_project_member(items.project_id)
    )
  );

create policy "item_links_delete_members" on item_links
  for delete using (
    exists (
      select 1 from items
      where items.id = item_links.item_a
        and is_project_member(items.project_id)
    )
  );

-- threads
create policy "threads_all_members" on threads
  for all using (is_project_member(project_id))
  with check (is_project_member(project_id));

-- thread_items: membership derived from the parent thread's project.
create policy "thread_items_all_members" on thread_items
  for all using (
    exists (
      select 1 from threads
      where threads.id = thread_items.thread_id
        and is_project_member(threads.project_id)
    )
  )
  with check (
    exists (
      select 1 from threads
      where threads.id = thread_id
        and is_project_member(threads.project_id)
    )
  );

-- ---------------------------------------------------------------------------
-- Public read-only viewer access (/p/[public_slug]): a SECURITY DEFINER
-- function that bypasses RLS deliberately, scoped to a single published
-- project looked up by its public_slug. The app calls this via
-- supabase.rpc('get_public_project', { slug }) with the anon key — the
-- underlying tables remain inaccessible to anon directly.
-- ---------------------------------------------------------------------------

create or replace function get_public_project(slug text)
returns jsonb
language sql
security definer
set search_path = public
stable
as $$
  select jsonb_build_object(
    'project', to_jsonb(p) - 'created_by',
    'layers', coalesce((select jsonb_agg(l) from layers l where l.project_id = p.id), '[]'::jsonb),
    'items', coalesce((select jsonb_agg(to_jsonb(i) - 'created_by') from items i where i.project_id = p.id), '[]'::jsonb),
    'threads', coalesce((select jsonb_agg(t) from threads t where t.project_id = p.id), '[]'::jsonb),
    'thread_items', coalesce(
      (select jsonb_agg(ti) from thread_items ti
        join threads t on t.id = ti.thread_id
        where t.project_id = p.id),
      '[]'::jsonb
    )
  )
  from projects p
  where p.public_slug = slug;
$$;

grant execute on function get_public_project(text) to anon, authenticated;
