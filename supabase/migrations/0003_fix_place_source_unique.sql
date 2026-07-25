-- The original venues_place_source_idx was a *partial* unique index
-- (`where place_source_id is not null`), which Postgres cannot use to
-- resolve a plain `ON CONFLICT (place_source_id)` clause — every
-- auto-discovery upsert failed with "no unique or exclusion constraint
-- matching the ON CONFLICT specification". The partial predicate was
-- unnecessary in the first place: a standard (non-partial) unique index
-- already permits unlimited NULLs in Postgres, since NULL is never equal
-- to NULL for uniqueness purposes — so a plain unique index gives the
-- same "curated_seed rows can all have NULL place_source_id" behavior
-- while actually being usable as an ON CONFLICT target.
drop index if exists venues_place_source_idx;
create unique index venues_place_source_idx on venues(place_source_id);
