-- Projects get a trash, and a named administrator who can reach into it.
--
-- Before this, `delete from projects` was final and any member could do it:
-- the policy asked only `is_project_member(id)`, cascades removed every layer,
-- item, link, thread and membership, and the uploaded files were left behind
-- unreachable forever. A student could end a semester's work in two clicks.

-- ---------------------------------------------------------------------------
-- Administrators
--
-- A table rather than a hardcoded address, so a second teacher can be added
-- without a code change - Yona co-teaches this course.
-- ---------------------------------------------------------------------------
create table if not exists administrators (
  user_id uuid primary key references auth.users(id) on delete cascade,
  added_at timestamptz default now()
);

alter table administrators enable row level security;

-- Readable by signed-in users so the app can ask "am I one?"; never writable
-- through the API. Adding an administrator is a deliberate act done here, in
-- the SQL editor, not something the app can be talked into.
drop policy if exists "administrators_select" on administrators;
create policy "administrators_select" on administrators
  for select to authenticated using (true);

insert into administrators (user_id)
select id from auth.users where email = 'dorior@gmail.com'
on conflict (user_id) do nothing;

create or replace function is_administrator()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (select 1 from administrators where user_id = auth.uid());
$$;

grant execute on function is_administrator() to authenticated;

-- ---------------------------------------------------------------------------
-- The administrator belongs to every project
--
-- Extending this one function rather than editing a dozen policies: every
-- policy on projects, layers, items, links and threads already routes through
-- it, so they all gain the administrator at once and cannot drift apart.
-- ---------------------------------------------------------------------------
create or replace function is_project_member(p_project_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select
    exists (
      select 1 from project_members
      where project_id = p_project_id
        and user_id = auth.uid()
    )
    or is_administrator();
$$;

-- ---------------------------------------------------------------------------
-- The trash itself
-- ---------------------------------------------------------------------------
alter table projects
  add column if not exists deleted_at timestamptz;

-- A deleted project stops being public immediately. Restoring it brings the
-- same link back, because the slug is untouched - which is the behaviour you
-- want after an accident.
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
    'items', coalesce(
      (select jsonb_agg(to_jsonb(i) - 'created_by')
        from items i
        where i.project_id = p.id
          and i.deleted_at is null),
      '[]'::jsonb
    ),
    'threads', coalesce((select jsonb_agg(t) from threads t where t.project_id = p.id), '[]'::jsonb),
    'thread_items', coalesce(
      (select jsonb_agg(ti) from thread_items ti
        join threads t on t.id = ti.thread_id
        where t.project_id = p.id),
      '[]'::jsonb
    )
  )
  from projects p
  where p.public_slug = slug
    and p.deleted_at is null;
$$;

grant execute on function get_public_project(text) to anon, authenticated;

-- Permanent removal is the administrator's alone. Restoring is any member's -
-- an accident should be undoable by whoever had it - but the step that
-- actually destroys work, and the files with it, is not.
drop policy if exists "projects_delete_members" on projects;
create policy "projects_delete_administrator" on projects
  for delete using (is_administrator());
