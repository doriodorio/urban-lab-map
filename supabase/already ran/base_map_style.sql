-- Remember which base map a project was arranged on, so the published view
-- opens on the same map the group built it on rather than a global default.
--
-- Nullable on purpose: a project that predates this, or one nobody has touched
-- the picker on, falls back to the app's default. There is no CHECK constraint
-- because the list of styles lives in src/lib/base-maps.ts and the server
-- action validates against it - a constraint here would mean a migration every
-- time a base map is added or renamed.
--
-- get_public_project() returns `to_jsonb(p) - 'created_by'`, so this column
-- reaches the public viewer with no change to the function.

alter table projects
  add column if not exists base_map_style text;
