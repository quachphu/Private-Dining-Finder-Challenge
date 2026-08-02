-- The host's decision, and the event conversation that follows it.
--
-- Until now the shortlist was the end of the funnel: a set of candidates to
-- compare. Actually running the dinner needs one more step — the host picks a
-- venue, then everyone attending has to be asked what they can and can't eat —
-- which is what the three changes below support.

-- 1. Which shortlisted venue the host actually chose.
alter table shortlist_items
  add column is_selected boolean not null default false;

-- One chosen venue per workspace, enforced in the database rather than in
-- application code so two people deciding at the same moment can't both win.
create unique index if not exists shortlist_items_one_selected_per_company
  on shortlist_items(company_id)
  where is_selected;

-- 2. Separates the planning conversation from the event conversation.
-- Both stay in shortlist_messages so Realtime (0007), attachments and the
-- storage policies (0008) keep applying unchanged — only the audience differs:
-- 'planning' is the handful of colleagues choosing a venue, 'event' is
-- everyone who is actually coming to dinner. Defaulting to 'planning' leaves
-- every existing row meaning exactly what it meant before.
alter table shortlist_messages
  add column channel text not null default 'planning'
    check (channel in ('planning', 'event'));

create index if not exists shortlist_messages_channel_idx
  on shortlist_messages(shortlist_item_id, channel, created_at);

-- 3. The dietary roster read back out of the event conversation.
--
-- Stored rather than recomputed on every page view: it costs an LLM call, and
-- the host needs a stable artifact they can re-read, correct and hand to the
-- venue — not a list that quietly reworded itself on refresh. Keeping every
-- generation (rather than overwriting one row) means a host can always see
-- what they sent, even after more replies arrive.
create table if not exists dietary_summaries (
  id uuid primary key default gen_random_uuid(),
  shortlist_item_id uuid not null references shortlist_items(id) on delete cascade,
  company_id uuid not null references companies(id) on delete cascade,
  -- Structured roster: { people[], aggregate[], unclear[], orderNote }.
  summary jsonb not null,
  -- How many messages it was built from, so the page can say plainly when
  -- replies have landed since — the summary is a snapshot, not live state.
  message_count integer not null default 0,
  generated_by text,
  created_at timestamptz not null default now()
);

create index if not exists dietary_summaries_item_idx
  on dietary_summaries(shortlist_item_id, created_at desc);

alter table dietary_summaries enable row level security;

create policy "dietary summaries readable" on dietary_summaries for select using (true);
-- Same rationale as 0007's insert policy: writes actually go through a server
-- action on the service role, which bypasses RLS entirely. This exists so the
-- table's access is deliberately configured rather than an implicit deny.
create policy "dietary summaries writable" on dietary_summaries for insert with check (true);

grant select on dietary_summaries to anon, authenticated;
grant select, insert on dietary_summaries to service_role;
