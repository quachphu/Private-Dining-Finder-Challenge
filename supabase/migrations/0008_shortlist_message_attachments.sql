-- Lets a shortlist discussion message (0007) carry a photo or video instead
-- of (or alongside) text. Attachments live in a public Storage bucket so
-- <img>/<video> tags can read them straight from their public URL — same
-- no-auth trust model as the rest of the app (a display name inside a
-- workspace, not a verified identity), and consistent with writes going
-- through the server action's service-role client while reads stay public.
alter table shortlist_messages
  drop constraint shortlist_messages_message_check;

alter table shortlist_messages
  add column attachment_url text,
  add column attachment_type text check (attachment_type in ('image', 'video'));

alter table shortlist_messages
  add constraint shortlist_messages_message_or_attachment_check
    check (length(trim(message)) > 0 or attachment_url is not null);

insert into storage.buckets (id, name, public)
values ('shortlist-media', 'shortlist-media', true)
on conflict (id) do nothing;

create policy "shortlist media publicly readable"
  on storage.objects for select
  using (bucket_id = 'shortlist-media');

-- Same rationale as 0007's insert policy: uploads actually go through the
-- server action (service role, which bypasses this entirely), so this just
-- keeps RLS deliberately configured rather than an implicit deny.
create policy "shortlist media writable"
  on storage.objects for insert
  with check (bucket_id = 'shortlist-media');
