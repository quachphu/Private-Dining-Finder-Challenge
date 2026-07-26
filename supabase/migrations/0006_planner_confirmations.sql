-- Community verification: when a planner calls a venue and gets a real answer,
-- they can push that figure back into the shared catalog.
--
-- This creates a tier *above* 'verified'. Everything else in this system is
-- inferred from what a venue publishes; this is a human who phoned and asked.
-- That's the strongest evidence available, so it ranks highest and is placed
-- first in the enum's ordering.
--
-- Note: Postgres forbids using a newly added enum value in the same
-- transaction that adds it, so nothing below references 'confirmed_by_planner'
-- as a default or literal. The server action writes it in a later transaction.
alter type trust_level add value if not exists 'confirmed_by_planner' before 'verified';

-- Confirmations are kept as their own append-only record rather than only
-- overwriting the room, so a figure always carries its provenance: who
-- reported it, which workspace they belong to, and when. A capacity confirmed
-- two years ago should not read the same as one confirmed last week.
create table if not exists venue_confirmations (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references venues(id) on delete cascade,
  -- Nullable: a planner may confirm a venue-level fact (minimum spend) without
  -- it belonging to any single room. Set null on room delete rather than
  -- cascading, so re-scraping a venue's rooms never destroys call history.
  room_id uuid references venue_rooms(id) on delete set null,
  company_id uuid not null references companies(id) on delete cascade,
  -- Matches the existing no-auth model: a display name inside a workspace,
  -- not a verified identity.
  confirmed_by text not null,
  confirmed_max_capacity integer check (confirmed_max_capacity is null or confirmed_max_capacity > 0),
  confirmed_min_spend_usd integer check (confirmed_min_spend_usd is null or confirmed_min_spend_usd >= 0),
  note text,
  created_at timestamptz not null default now(),
  -- A confirmation that reports nothing is meaningless.
  constraint confirmation_has_a_figure check (
    confirmed_max_capacity is not null or confirmed_min_spend_usd is not null
  )
);

create index if not exists venue_confirmations_venue_idx on venue_confirmations(venue_id, created_at desc);

-- Same model as every other table here: RLS is on, access is gated in the app
-- by possession of the workspace's shared code rather than by a real auth
-- identity (see 0001_init.sql).
alter table venue_confirmations enable row level security;

create policy "confirmations readable" on venue_confirmations for select using (true);
create policy "confirmations writable" on venue_confirmations for insert with check (true);
