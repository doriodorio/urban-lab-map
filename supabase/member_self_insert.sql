-- Close the self-join hole in project_members.
--
-- The insert policy written in week 2 read:
--
--   with check (user_id = auth.uid() or is_project_member(project_id))
--
-- The first branch was there so that whoever created a project could make
-- themselves its first member. But it says nothing about which project, so it
-- also said: any signed-in person may add themselves to any project at all.
-- One insert naming another group's project id, and they are a member of it -
-- and because every other policy in this schema routes through
-- is_project_member(), that is full read and write over that group's items,
-- layers, threads and uploads.
--
-- The project ids are not secret. A published project's own id is returned by
-- get_public_project() to anyone who opens its link, which is the point of a
-- published link. So the only thing standing between one group and another's
-- semester of fieldwork was that nobody had tried.
--
-- Nothing in the app needed that branch. Project creation goes through
-- create_project(), which is SECURITY DEFINER and inserts the membership
-- itself, outside RLS entirely. Invitations are claimed by
-- claim_project_invitations(), likewise. Adding a colleague - by hand or
-- through the roster import - is done by someone who is already a member, so
-- it matches the second branch.
--
-- The narrow case is kept anyway, as defence for any path that inserts
-- directly: you may add YOURSELF to a project YOU created. Both halves have
-- to hold, so naming someone else's project no longer qualifies.
--
-- Safe to run twice. No existing membership row is touched; this only governs
-- new inserts.

drop policy if exists "project_members_insert_self_or_member" on project_members;
drop policy if exists "project_members_insert_own_project_or_member" on project_members;

create policy "project_members_insert_own_project_or_member" on project_members
  for insert
  to authenticated
  with check (
    is_project_member(project_id)
    or (
      user_id = auth.uid()
      and exists (
        select 1 from projects p
        where p.id = project_id
          and p.created_by = auth.uid()
      )
    )
  );

-- A check on the way out, too. Nothing here changes it, but it is worth
-- knowing: any member may remove any other member, the whole group included.
-- That is the same flat permission model as deleting an item, and it is
-- deliberate for v1 - but unlike an item, a removed membership has no trash.
