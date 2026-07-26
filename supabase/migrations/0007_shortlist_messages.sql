-- Live discussion thread per shortlisted venue, replacing the single
-- overwritable "note" field with something everyone in the workspace can
-- contribute to. Kept as its own append-only table (same shape as
-- venue_confirmations in 0006) rather than reusing shortlist_items.note, since
-- a conversation needs multiple authors and a timeline, not one mutable field.
create table if not exists shortlist_messages (
  id uuid primary key default gen_random_uuid(),
  shortlist_item_id uuid not null references shortlist_items(id) on delete cascade,
  company_id uuid not null references companies(id) on delete cascade,
  -- Same no-auth model as everywhere else: a display name inside a workspace,
  -- not a verified identity.
  author text not null,
  message text not null check (length(trim(message)) > 0),
  created_at timestamptz not null default now()
);

create index if not exists shortlist_messages_item_idx on shortlist_messages(shortlist_item_id, created_at);

alter table shortlist_messages enable row level security;

create policy "shortlist messages readable" on shortlist_messages for select using (true);
-- Writes go through the server action (service role), same pattern as every
-- other mutation in this app — this policy exists so RLS is deliberately
-- configured rather than left as an implicit deny, matching 0006's approach.
create policy "shortlist messages writable" on shortlist_messages for insert with check (true);

grant select on shortlist_messages to anon, authenticated;
grant select, insert on shortlist_messages to service_role;

-- Without this, postgres_changes subscriptions never fire — the table is
-- otherwise invisible to Supabase Realtime regardless of the RLS policies
-- above, which only govern REST/client reads, not the replication stream.
alter publication supabase_realtime add table shortlist_messages;
