@AGENTS.md

# Build Brief: Urban Lab Map Tool — v1

**For:** Claude Code, building this from scratch
**Companion doc:** `docs/PRD.md` (full product rationale — read it if you need context beyond what's here; this file is the executable version of it)
**Deadline:** October 18, 2026 (next semester start) — this brief assumes an 8-week build starting ~August 25, 2026
**Owner:** Dori Oryan (dorior@gmail.com), for the Urban Lab track at Bezalel Academy, course "Ideation Workshop 1: Human Research and Design Management"

---

## 1. What to build, in one paragraph

A map-based tool where ~6 student groups per semester each run a research project: they place items on a map (photos, long-form notes/philosophical reflections, quotes, interview audio/video with transcripts, documents/citations, small data points, or a composite of these) anchored to a point, drawn line, or drawn region. Items belong to custom layers a group defines itself. Items can link to each other regardless of location. Groups can order a subset of items into a guided "thread" (a tour). A finished project publishes to a public, link-based, read-only view. Instructors get access the same way a student does — added as a member of a group's project — no separate admin surface needed for v1.

---

## 2. Stack (decided — do not re-litigate unless something concrete blocks it)

- **Frontend:** Next.js (App Router, TypeScript, React)
- **Map rendering:** MapLibre GL JS — open-source, supports custom raster overlays (needed for a georeferenced historical/custom base-map image), no vendor key required
- **Backend, DB, auth, file storage:** Supabase (Postgres + Row Level Security for group-scoped access, built-in email/magic-link auth, Storage buckets for images/audio/video)
- **Hosting:** Vercel (frontend) + Supabase (backend), both on free/low-cost tiers — appropriate for ~6 groups of a few students each

Why this stack: it minimizes custom infrastructure code (auth, file upload, permissions) so build time goes into the actual content model and map UI, which is the part that matters for this project and has no off-the-shelf equivalent.

---

## 3. Data model

Postgres via Supabase. Use `jsonb` for geometry rather than PostGIS — v1 doesn't need spatial queries (joins, distance calculations), just storage and rendering of points/lines/polygons.

```sql
-- Auth: use Supabase's built-in auth.users table. Don't build custom auth.

create table projects (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  base_map_image_url text,       -- optional custom georeferenced base image
  base_map_bounds jsonb,          -- [[lat,lng],[lat,lng]] corners, if base_map_image_url is set
  public_slug text unique,        -- for the link-based public viewer; null = not published
  created_by uuid references auth.users(id),
  created_at timestamptz default now()
);

create table project_members (
  project_id uuid references projects(id) on delete cascade,
  user_id uuid references auth.users(id),
  role text not null default 'member',  -- 'member' | 'instructor' — both can edit in v1; role is informational only, no permission split yet
  primary key (project_id, user_id)
);

create table layers (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references projects(id) on delete cascade,
  name text not null,
  color text,                     -- hex, for map styling
  created_at timestamptz default now()
);

create table items (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references projects(id) on delete cascade,
  layer_id uuid references layers(id) on delete set null,
  type text not null,             -- 'image' | 'text' | 'quote' | 'interview' | 'document' | 'data' | 'composite'
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

create table item_links (
  id uuid primary key default gen_random_uuid(),
  item_a uuid references items(id) on delete cascade,
  item_b uuid references items(id) on delete cascade,
  note text,
  created_at timestamptz default now()
);

create table threads (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references projects(id) on delete cascade,
  name text not null,
  description text,
  created_at timestamptz default now()
);

create table thread_items (
  thread_id uuid references threads(id) on delete cascade,
  item_id uuid references items(id) on delete cascade,
  order_index int not null,
  narration text,                 -- per-step text shown in guided "play" mode
  primary key (thread_id, item_id)
);
```

Row Level Security: a user can read/write `projects`, `layers`, `items`, `item_links`, `threads`, `thread_items` only where they're in `project_members` for that `project_id`. The public viewer route reads by `public_slug` through a separate, unauthenticated read-only query (e.g., a Postgres function or a service-role edge function) — don't expose the tables directly to anonymous users.

---

## 4. Screens

1. **`/login`** — Supabase auth (magic link is simplest for students; no need to build password reset flows)
2. **`/projects`** — workspace dashboard: list of projects the logged-in user belongs to, "new project" button
3. **`/projects/new`** — create project (name, description)
4. **`/projects/[id]`** — the main map editor:
   - Map canvas (MapLibre), pan/zoom, layer toggle panel
   - Toolbar to add a new item (choose anchor type: point/line/polygon, then type)
   - Item detail panel (opens on click): edit all fields, upload media, set tags/dates, link to other items (searchable picker), see items already linked to it
   - Layer manager: create/rename/color/delete layers
   - Search bar: filter items by text/tag
   - Timeline strip: filter items by date range
5. **`/projects/[id]/threads`** — list threads, create/edit a thread (drag-to-order items, add narration text per step), "preview" the play mode
6. **`/p/[public_slug]`** — public read-only viewer, no login: guided-tour mode (plays the project's default/first thread) by default, with a toggle to free-explore the full map with layer/tag/date filters

---

## 5. Build order (targeting Oct 18)

| Weeks | Focus |
|---|---|
| 1 (Aug 25–31) | Repo scaffold, Supabase project + schema above + RLS policies, Next.js shell, magic-link auth, deploy pipeline (Vercel) working end to end with a "hello world" page |
| 2 (Sept 1–7) | Project CRUD, `/projects` dashboard, `project_members` (add self on create; add others by email) |
| 3 (Sept 8–14) | Map canvas renders, custom base-map image upload + georeferencing, layer CRUD, place a point item with title/body/image |
| 4 (Sept 15–21) | Remaining item types (quote, interview with audio/video upload + transcript field, document/citation, data, composite), line/polygon anchors, tagging, timeline filter |
| 5 (Sept 22–28) | Item-to-item linking (create/remove links, show linked items in detail panel), search |
| 6 (Sept 29–Oct 5) | Thread builder + play mode, public viewer route + publish/unpublish toggle |
| 7 (Oct 6–12) | Import last year's group material as a real test project; fix whatever breaks under real content (long transcripts, many images, messy tags) |
| 8 (Oct 13–18) | Buffer, polish, walkthrough with Dori, launch |

If the timeline slips, cut in this order: composite item type → data item type → line/polygon anchors (points only) → thread play-mode polish. Do not cut: item linking, custom layers, publish link — those are the confirmed must-haves.

---

## 6. Explicit non-goals for v1

Do not build these, even if they seem easy to add along the way — they were deliberately deferred:

- Cross-group / instructor dashboard (instructors just join a project as a member)
- Milestone or checkpoint tracking
- Relationship *graph visualization* (the underlying links must work; a visual graph view does not)
- Auto-transcription of audio/video
- Citation export (BibTeX/Zotero)
- Crowdsourced/public contribution mode
- Comparison mode (two projects or time periods side by side)
- Multi-language UI
- Fine-grained roles/permissions beyond the single `member`/`instructor` label (both can edit everything in v1)
- Real-time multi-cursor collaborative editing (last-write-wins is fine for v1)

---

## 7. Open items Claude Code should flag back to Dori, not decide alone

- ~~Whether last year's group material is already in digital form ready to import~~ — **answered Aug 25, 2026:** it isn't; Dori is collecting it. Week 7 can't start until that material exists.
- ~~Whether a single custom base-map image per project is sufficient~~ — **answered Aug 25, 2026:** one per project is enough for v1. Matches what's built; no change made.
- Supabase/Vercel account creation and billing — these are account-level decisions, not code
