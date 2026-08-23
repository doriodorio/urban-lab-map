-- Fixes a chicken-and-egg RLS problem: creating a project via a plain client
-- insert().select() chain fails, because Postgres enforces the SELECT policy
-- on the RETURNING row too, and the creator isn't a project_members row yet
-- at that instant (that insert happens second). Bundling both inserts into
-- one SECURITY DEFINER function sidesteps it — both rows are created in the
-- same statement, before any RLS check on reading the project back applies.
create or replace function create_project(p_name text, p_description text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  new_id uuid;
begin
  insert into projects (name, description, created_by)
  values (p_name, p_description, auth.uid())
  returning id into new_id;

  insert into project_members (project_id, user_id)
  values (new_id, auth.uid());

  return new_id;
end;
$$;

grant execute on function create_project(text, text) to authenticated;

-- Restore the real insert policy (it was temporarily set to `with check (true)`
-- while diagnosing the issue above — that's not safe to leave in place, since
-- it would let any authenticated user create a project claiming any
-- created_by. The app no longer inserts into projects directly for creation
-- (it calls create_project() instead), but this policy stays as defense in
-- depth for any other direct insert path.
drop policy if exists "projects_insert_authenticated" on projects;
create policy "projects_insert_authenticated" on projects
  for insert
  to authenticated
  with check (auth.uid() is not null and created_by = auth.uid());

-- Clean up the debug function from troubleshooting.
drop function if exists debug_whoami();
