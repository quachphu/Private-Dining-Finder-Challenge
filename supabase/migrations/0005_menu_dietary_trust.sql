-- The venues table already stores menu_url and dietary_notes, but with no way
-- to say how reliable either one is. Every other surfaced fact in this app
-- carries its own trust label; these two were the exceptions.
--
-- They need *separate* labels rather than sharing one: a venue commonly links
-- a menu PDF (a concrete artifact we found) while only vaguely gesturing at
-- dietary accommodations in prose, so the two facts genuinely differ in
-- confidence and must not inherit each other's label — or capacity's.
alter table venues
  add column if not exists menu_trust trust_level not null default 'unverified',
  add column if not exists dietary_trust trust_level not null default 'unverified';

comment on column venues.menu_trust is
  'Confidence in menu_url. verified = link found on the venue''s own private-dining/events page.';
comment on column venues.dietary_trust is
  'Confidence in dietary_notes. likely = accommodation phrases matched on the venue''s own pages; ai_extracted = summarized by an LLM from that page text.';
