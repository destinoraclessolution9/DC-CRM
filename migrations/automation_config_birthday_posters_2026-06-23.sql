-- Automation config — singleton holding admin-managed automation assets.
-- First use: the two birthday posters (navy = male, pink = female) sent with
-- the birthday WhatsApp wish. Admin re-uploads them yearly from
-- Marketing ▸ Automation ▸ Birthday Posters; the mobile calendar reads the URLs
-- and prefetches the images for a gesture-safe Web Share file send.
-- Additive DDL (pre-authorized). Poster images live in the existing public
-- `attachments` storage bucket (path birthday_posters/...) — only the URLs are
-- stored here, so no new bucket/policy is needed.

create table if not exists public.automation_config (
  id                          integer primary key default 1,
  birthday_poster_male_url    text,
  birthday_poster_female_url  text,
  updated_at                  timestamptz default now(),
  updated_by                  bigint,
  constraint automation_config_singleton check (id = 1)
);

insert into public.automation_config (id) values (1) on conflict (id) do nothing;

grant select, insert, update on public.automation_config to authenticated;

alter table public.automation_config enable row level security;

-- Everyone signed in can READ (agents need the poster URLs to send the wish).
drop policy if exists automation_config_sel on public.automation_config;
create policy automation_config_sel on public.automation_config
  for select to authenticated using (true);

-- Only admin / marketing-manager (level <= 2) may CHANGE the posters.
drop policy if exists automation_config_ins on public.automation_config;
create policy automation_config_ins on public.automation_config
  for insert to authenticated with check (current_user_level() <= 2);

drop policy if exists automation_config_upd on public.automation_config;
create policy automation_config_upd on public.automation_config
  for update to authenticated
  using (current_user_level() <= 2) with check (current_user_level() <= 2);
