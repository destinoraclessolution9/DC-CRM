-- H1 (destructive, owner-approved): drop the plaintext password shadow column.
-- All app write paths (agent create/reset, self change, settings) now removed;
-- real auth lives in GoTrue. Applied after those changes went live.
alter table public.users drop column if exists password;
