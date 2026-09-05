-- Week 3: storage for item images and custom base-map images.
-- Objects are stored as "{project_id}/{filename}" so RLS can scope access
-- by project membership using the path's first folder segment.

insert into storage.buckets (id, name, public)
values ('project-media', 'project-media', true)
on conflict (id) do nothing;

create policy "project_media_read_public" on storage.objects
  for select
  using (bucket_id = 'project-media');

create policy "project_media_insert_members" on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'project-media'
    and is_project_member((storage.foldername(name))[1]::uuid)
  );

create policy "project_media_delete_members" on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'project-media'
    and is_project_member((storage.foldername(name))[1]::uuid)
  );
