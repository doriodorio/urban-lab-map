-- Soft delete for items.
--
-- Every member of a project can delete any item in it, regardless of who
-- created it (see the `items_all_members` policy in rls.sql — that flat
-- permission model is deliberate for v1). Hard deletes made that
-- unforgiving: one accidental click could destroy another student's
-- fieldwork with no way back. Items are now marked deleted instead, and can
-- be restored from the editor's Trash panel.
--
-- The DELETE policy stays in place so a genuine purge is still possible via
-- SQL/admin; the app just doesn't use it.

alter table items add column if not exists deleted_at timestamptz;

-- Every app query filters on `deleted_at is null`, so index the live rows.
create index if not exists items_project_live_idx
  on items(project_id)
  where deleted_at is null;

-- Keep the public viewer from serving deleted items. Same definition as in
-- rls.sql, plus the deleted_at filter on the items aggregate.
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
  where p.public_slug = slug;
$$;

grant execute on function get_public_project(text) to anon, authenticated;
