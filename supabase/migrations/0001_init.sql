-- Private Dining Finder — initial schema
-- Trust labels are modeled as a Postgres enum so every "confidence" field
-- (capacity, price) is constrained to the same verified/likely/unverified
-- vocabulary the product spec requires.
create extension if not exists "pgcrypto";

create type trust_level as enum ('verified', 'likely', 'unverified');
create type commute_mode as enum ('walk', 'drive');
create type room_style as enum ('seated', 'reception', 'either');

-- A "company workspace" is joined by a shared, human-typeable code
-- (e.g. NOWADAYS-4F2A) instead of email/password auth — anyone with the
-- code sees the same saved addresses, search history, and shortlist.
create table companies (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  code text not null unique,
  created_at timestamptz not null default now()
);

create table saved_addresses (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  label text not null,
  formatted_address text not null,
  lat double precision not null,
  lng double precision not null,
  created_by text,
  created_at timestamptz not null default now()
);
create index saved_addresses_company_idx on saved_addresses(company_id);

create table searches (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  saved_address_id uuid references saved_addresses(id) on delete set null,
  origin_label text not null,
  origin_lat double precision not null,
  origin_lng double precision not null,
  headcount integer not null check (headcount > 0),
  max_commute_minutes integer not null check (max_commute_minutes > 0),
  commute_mode commute_mode not null,
  style room_style,
  created_by text,
  created_at timestamptz not null default now()
);
create index searches_company_idx on searches(company_id);

-- Venues are populated two ways: a hand-curated fallback set (source =
-- 'curated_seed', written once via the service-role seed script so the 3
-- required demo scenarios always have data) and the live discovery pipeline
-- (source = 'auto_discovered', written by a server action when a planner
-- searches an address with no fresh nearby coverage). place_source_id
-- dedupes re-discovery of the same venue (Google place_id / OSM id);
-- last_checked_at drives the cache TTL so we don't re-scrape a venue on
-- every search.
create table venues (
  id uuid primary key default gen_random_uuid(),
  source text not null default 'auto_discovered' check (source in ('curated_seed', 'auto_discovered')),
  place_source_id text,
  name text not null,
  formatted_address text not null,
  lat double precision not null,
  lng double precision not null,
  city_slug text not null,
  category text not null,
  neighborhood text,
  price_tier text,
  price_tier_trust trust_level not null default 'unverified',
  min_spend_usd numeric,
  min_spend_trust trust_level not null default 'unverified',
  phone text,
  email text,
  website text,
  description text,
  dietary_notes text,
  menu_url text,
  source_note text,
  last_checked_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index venues_city_idx on venues(city_slug);
create index venues_geo_idx on venues(lat, lng);
create index venues_last_checked_idx on venues(last_checked_at);
create unique index venues_place_source_idx on venues(place_source_id) where place_source_id is not null;

create table venue_rooms (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references venues(id) on delete cascade,
  room_name text not null,
  min_capacity integer,
  max_capacity integer not null,
  style room_style not null default 'either',
  capacity_trust trust_level not null default 'unverified',
  notes text
);
create index venue_rooms_venue_idx on venue_rooms(venue_id);

create table venue_photos (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references venues(id) on delete cascade,
  url text not null,
  alt_text text,
  sort_order integer not null default 0,
  is_primary boolean not null default false
);
create index venue_photos_venue_idx on venue_photos(venue_id);
create unique index venue_photos_one_primary_idx on venue_photos(venue_id) where is_primary;

create table shortlist_items (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  venue_id uuid not null references venues(id) on delete cascade,
  search_id uuid references searches(id) on delete set null,
  added_by text,
  note text,
  created_at timestamptz not null default now(),
  unique (company_id, venue_id)
);
create index shortlist_items_company_idx on shortlist_items(company_id);

-- RLS -----------------------------------------------------------------
-- No Supabase Auth in this challenge build: the company "code" acts as a
-- shared-link secret (like a Google Doc share link), checked in the app
-- layer. Company-scoped tables are open to the anon key so the browser
-- client can read/write directly; venue catalog tables are read-only from
-- the client and are only written by the service-role seed script.
-- A production version would swap this for Supabase Auth + auth.uid()-based
-- policies scoping every row to a real signed-in member of the company.
alter table companies enable row level security;
alter table saved_addresses enable row level security;
alter table searches enable row level security;
alter table venues enable row level security;
alter table venue_rooms enable row level security;
alter table venue_photos enable row level security;
alter table shortlist_items enable row level security;

create policy "companies are readable for code lookup" on companies for select using (true);
create policy "anyone can create a company workspace" on companies for insert with check (true);

create policy "saved addresses readable" on saved_addresses for select using (true);
create policy "saved addresses writable" on saved_addresses for insert with check (true);
create policy "saved addresses deletable" on saved_addresses for delete using (true);

create policy "searches readable" on searches for select using (true);
create policy "searches writable" on searches for insert with check (true);

create policy "venues are public read" on venues for select using (true);
create policy "venue rooms are public read" on venue_rooms for select using (true);
create policy "venue photos are public read" on venue_photos for select using (true);

create policy "shortlist readable" on shortlist_items for select using (true);
create policy "shortlist writable" on shortlist_items for insert with check (true);
create policy "shortlist deletable" on shortlist_items for delete using (true);

-- Grants ---------------------------------------------------------------
-- RLS policies above only govern row *visibility*; Postgres also requires
-- an explicit table-level GRANT before the PostgREST roles can touch a
-- table at all. The app talks to Postgres exclusively via the service-role
-- key server-side (see src/lib/supabase/server.ts), so service_role needs
-- full CRUD; anon/authenticated get read access to the public venue
-- catalog and write access to the company-scoped tables in case a future
-- browser-side client is added, matching the RLS policies above.
grant usage on schema public to anon, authenticated, service_role;

grant select, insert on companies to anon, authenticated, service_role;
grant select, insert, delete on saved_addresses to anon, authenticated, service_role;
grant select, insert on searches to anon, authenticated, service_role;
grant select, insert, delete on shortlist_items to anon, authenticated, service_role;

grant select on venues, venue_rooms, venue_photos to anon, authenticated;
grant select, insert, update, delete on venues, venue_rooms, venue_photos to service_role;
