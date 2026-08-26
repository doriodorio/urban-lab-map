-- Urban Lab Map Tool — v1 schema
-- Run this in the Supabase SQL editor (or via `supabase db push`) on a fresh project.
-- Auth: uses Supabase's built-in auth.users table. Don't build custom auth.

create table if not exists projects (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  base_map_image_url text,       -- optional custom georeferenced base image
  base_map_bounds jsonb,          -- [[lat,lng],[lat,lng]] corners, if base_map_image_url is set
  public_slug text unique,        -- for the link-based public viewer; null = not published
  created_by uuid references auth.users(id),
  created_at timestamptz default now()
);

create table if not exists project_members (
  project_id uuid references projects(id) on delete cascade,
  user_id uuid references auth.users(id),
  role text not null default 'member',  -- 'member' | 'instructor' — both can edit in v1; role is informational only, no permission split yet
  primary key (project_id, user_id)
);

create table if not exists layers (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references projects(id) on delete cascade,
  name text not null,
  color text,                     -- hex, for map styling
  created_at timestamptz default now()
);

create table if not exists items (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references projects(id) on delete cascade,
  layer_id uuid references layers(id) on delete set null,
  type text not null,             -- 'image' | 'text' | 'quote' | 'interview' | 'document' | 'data' | 'link' | 'video' | 'composite'
                                  -- No CHECK constraint: the app validates against VALID_TYPES in
                                  -- map-actions.ts, so adding a type needs no migration.
  geometry jsonb not null,        -- GeoJSON Point, LineString, or Polygon
  title text,
  body text,                      -- markdown/rich text for notes, quotes, transcripts
  media jsonb default '[]',       -- array of {url, type, caption, credit}
  tags text[] default '{}',
  date_start date,
  date_end date,
  attribution text,               -- interviewee name, source, citation, etc.
  created_by uuid references auth.users(id),
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists item_links (
  id uuid primary key default gen_random_uuid(),
  item_a uuid references items(id) on delete cascade,
  item_b uuid references items(id) on delete cascade,
  note text,
  created_at timestamptz default now()
);

create table if not exists threads (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references projects(id) on delete cascade,
  name text not null,
  description text,
  created_at timestamptz default now()
);

create table if not exists thread_items (
  thread_id uuid references threads(id) on delete cascade,
  item_id uuid references items(id) on delete cascade,
  order_index int not null,
  narration text,                 -- per-step text shown in guided "play" mode
  primary key (thread_id, item_id)
);

create index if not exists items_project_id_idx on items(project_id);
create index if not exists items_layer_id_idx on items(layer_id);
create index if not exists layers_project_id_idx on layers(project_id);
create index if not exists project_members_user_id_idx on project_members(user_id);
create index if not exists item_links_item_a_idx on item_links(item_a);
create index if not exists item_links_item_b_idx on item_links(item_b);
create index if not exists thread_items_thread_id_idx on thread_items(thread_id);
