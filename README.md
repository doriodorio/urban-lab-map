# Urban Lab Map Tool

Build brief: [`CLAUDE.md`](./CLAUDE.md). Product spec: [`docs/PRD.md`](./docs/PRD.md).

## Local setup

1. Create a Supabase project (free tier is fine).
2. In the Supabase SQL editor, run [`supabase/schema.sql`](./supabase/schema.sql), then [`supabase/rls.sql`](./supabase/rls.sql).
3. In Supabase → Authentication → Providers, confirm Email (magic link) is enabled. Under Authentication → URL Configuration, add `http://localhost:3000/auth/callback` as a redirect URL (and your production URL once deployed).
4. Copy `.env.local.example` to `.env.local` and fill in the two values from Supabase → Project Settings → API (`Project URL` and `anon public` key).
5. `npm install`
6. `npm run dev` — open [http://localhost:3000](http://localhost:3000), sign in with a magic link, and confirm you land on `/projects`.

## Deploying (Vercel)

1. Import this repo into Vercel.
2. Set the same two env vars (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`) in the Vercel project settings.
3. Add the deployed URL's `/auth/callback` path to Supabase's allowed redirect URLs.
4. Deploy.

## Stack

Next.js (App Router) + MapLibre GL JS + Supabase (Postgres, RLS, auth, storage) + Vercel. See [`CLAUDE.md`](./CLAUDE.md) for the full rationale and build order.
