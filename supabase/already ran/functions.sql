-- Week 2: helper functions for inviting members by email.
-- auth.users isn't exposed to PostgREST, so these SECURITY DEFINER functions
-- provide narrow, deliberate access to it.

-- Resolve an email to a user id, for the "invite by email" flow. Any
-- authenticated user can call this; it only leaks whether an email has an
-- account, not any other profile data, and existing RLS on project_members
-- still governs who can actually be added to a project.
create or replace function get_user_id_by_email(target_email text)
returns uuid
language sql
security definer
set search_path = public
stable
as $$
  select id from auth.users where email = target_email limit 1;
$$;

grant execute on function get_user_id_by_email(text) to authenticated;

-- List a project's members with email + role, for the project detail page.
-- Returns nothing unless the caller is themself a member of the project.
create or replace function get_project_members(p_project_id uuid)
returns table(user_id uuid, email text, role text)
language sql
security definer
set search_path = public
stable
as $$
  select pm.user_id, u.email, pm.role
  from project_members pm
  join auth.users u on u.id = pm.user_id
  where pm.project_id = p_project_id
    and is_project_member(p_project_id)
  order by pm.role, u.email;
$$;

grant execute on function get_project_members(uuid) to authenticated;
