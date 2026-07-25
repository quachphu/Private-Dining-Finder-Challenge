-- Every workspace now requires the creator's name, so a workspace can be
-- identified by its organizer (surfaced in the nav bar).
alter table companies add column created_by text;
