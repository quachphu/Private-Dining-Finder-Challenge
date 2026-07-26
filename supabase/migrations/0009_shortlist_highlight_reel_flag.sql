-- Distinguishes a generated highlight reel (0008's attachments, compiled by
-- ShortlistHighlightReel from everything posted in the thread) from an
-- ordinary uploaded video, so the shortlist and venue pages can pick the
-- latest reel out and embed it directly — visible to everyone who opens the
-- page, not just people who scroll the chat or download the file.
alter table shortlist_messages
  add column is_highlight_reel boolean not null default false;
