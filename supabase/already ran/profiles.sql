-- Display names.
--
-- Magic-link auth gives us an email and nothing else, so authorship on items
-- read as "Added by dorior@gmail.com". A profile lets someone pick a nickname
-- to be shown instead - friendlier to read next to a colleague's fieldwork,
-- and it keeps email addresses off a map that eventually gets published.

create table if not exists profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  updated_at timestamptz default now()
);

alter table profiles enable row level security;

-- Readable by any signed-in user. Restricting reads to "shares a project with
-- me" would mean a membership check on every lookup for no real privacy gain:
-- a self-chosen nickname is less identifying than the email it replaces, and
-- project members can already see each other's emails on the settings page.
drop policy if exists "profiles_select_authenticated" on profiles;
create policy "profiles_select_authenticated" on profiles
  for select to authenticated using (true);

drop policy if exists "profiles_insert_self" on profiles;
create policy "profiles_insert_self" on profiles
  for insert to authenticated with check (user_id = auth.uid());

drop policy if exists "profiles_update_self" on profiles;
create policy "profiles_update_self" on profiles
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- Return type changes, so the old signature has to go first.
drop function if exists get_project_members(uuid);

create function get_project_members(p_project_id uuid)
returns table(user_id uuid, email text, role text, display_name text)
language sql
security definer
set search_path = public
stable
as $$
  select pm.user_id, u.email::text, pm.role, p.display_name
  from project_members pm
  join auth.users u on u.id = pm.user_id
  left join profiles p on p.user_id = pm.user_id
  where pm.project_id = p_project_id
    and is_project_member(p_project_id)
  order by pm.role, coalesce(p.display_name, u.email::text);
$$;

grant execute on function get_project_members(uuid) to authenticated;
