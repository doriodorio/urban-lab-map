-- Invite someone who has never signed in.
--
-- Adding a member looked up the email in auth.users and refused if it was not
-- there: "they need to sign in once before they can be added". That is the
-- wrong way round for a course. Groups are formed before term starts, from a
-- list of addresses, and nobody wants to chase six groups of students to log
-- in first so they can then be added.
--
-- An invitation is now recorded against the email, and is claimed the moment
-- that person first signs in.

create table if not exists project_invitations (
  project_id uuid references projects(id) on delete cascade,
  email text not null,
  role text not null default 'member',
  invited_by uuid references auth.users(id),
  created_at timestamptz default now(),
  primary key (project_id, email)
);

create index if not exists project_invitations_email_idx
  on project_invitations(email);

alter table project_invitations enable row level security;

-- Same rule as membership itself: if you belong to the project you can see and
-- manage who has been asked to join it. is_project_member() also answers true
-- for an administrator, so they inherit this without a second policy.
drop policy if exists "invitations_select_members" on project_invitations;
create policy "invitations_select_members" on project_invitations
  for select to authenticated using (is_project_member(project_id));

drop policy if exists "invitations_insert_members" on project_invitations;
create policy "invitations_insert_members" on project_invitations
  for insert to authenticated with check (is_project_member(project_id));

drop policy if exists "invitations_delete_members" on project_invitations;
create policy "invitations_delete_members" on project_invitations
  for delete to authenticated using (is_project_member(project_id));

/*
 * Turn this person's invitations into memberships.
 *
 * The email is read from auth.users by auth.uid() rather than taken as an
 * argument. That is the whole security of this function: a caller cannot claim
 * an invitation addressed to someone else, because they cannot say who they
 * are - the database looks it up. Magic-link sign-in means the address is
 * verified by definition, since receiving the mail is how you got in.
 *
 * Safe to call on every sign-in: it claims what is there and does nothing when
 * there is nothing.
 */
create or replace function claim_project_invitations()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  my_email text;
  claimed int;
begin
  select lower(email) into my_email from auth.users where id = auth.uid();
  if my_email is null then
    return 0;
  end if;

  insert into project_members (project_id, user_id, role)
  select i.project_id, auth.uid(), i.role
  from project_invitations i
  where lower(i.email) = my_email
  -- Already a member by another route: drop the invitation rather than fail.
  on conflict (project_id, user_id) do nothing;

  get diagnostics claimed = row_count;

  delete from project_invitations where lower(email) = my_email;

  return claimed;
end;
$$;

grant execute on function claim_project_invitations() to authenticated;
