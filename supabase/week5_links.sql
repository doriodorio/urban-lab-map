-- Week 5: item-to-item linking.
--
-- Links are undirected: "A relates to B" is the same fact as "B relates to A".
-- Rather than storing both rows and keeping them in sync, the pair is stored
-- in a canonical order (item_a < item_b, comparing uuids) and the app sorts
-- the two ids before inserting. That gives:
--   * one row per relationship, so an item's links are found with a single
--     `item_a = X or item_b = X`
--   * a unique index that actually prevents duplicates - without the ordering
--     rule, (A,B) and (B,A) would look like different rows to Postgres
--   * self-links rejected for free, since A < A is false

delete from item_links
where item_a is null
   or item_b is null
   or item_a = item_b;

-- Normalize any rows that predate the constraint (there shouldn't be any -
-- linking ships with this migration - but re-running must stay safe).
update item_links
set item_a = item_b, item_b = item_a
where item_a > item_b;

delete from item_links a
using item_links b
where a.ctid > b.ctid
  and a.item_a = b.item_a
  and a.item_b = b.item_b;

alter table item_links
  alter column item_a set not null,
  alter column item_b set not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'item_links_ordered'
  ) then
    alter table item_links
      add constraint item_links_ordered check (item_a < item_b);
  end if;
end $$;

create unique index if not exists item_links_pair_idx
  on item_links(item_a, item_b);
