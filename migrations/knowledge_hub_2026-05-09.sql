-- Knowledge HQ — Personal Knowledge Hub
-- Single content type "entry" with deferred classification, links, and daily notes.
-- 2026-05-09

-- ============================================================
-- knowledge_entries
-- ============================================================
create table if not exists public.knowledge_entries (
  id           uuid primary key default gen_random_uuid(),
  owner_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title        text not null check (char_length(title) <= 200),
  content      text default '',
  type         text check (type in ('idea','task','case_study','note','reference')),
  status       text default 'draft' check (status in ('draft','active','waiting','done','archived')),
  priority     text check (priority in ('low','med','high')),
  due_date     date,
  tags         text[] default '{}',
  search_tsv   tsvector generated always as
               (to_tsvector('simple', coalesce(title,'') || ' ' || coalesce(content,''))) stored,
  created_at   timestamptz default now(),
  updated_at   timestamptz default now()
);

create index if not exists ke_owner_type_status_idx on public.knowledge_entries (owner_id, type, status);
create index if not exists ke_owner_created_idx     on public.knowledge_entries (owner_id, created_at desc);
create index if not exists ke_search_idx            on public.knowledge_entries using gin (search_tsv);
create index if not exists ke_tags_idx              on public.knowledge_entries using gin (tags);

-- ============================================================
-- knowledge_links (directed; backlinks = reverse query)
-- ============================================================
create table if not exists public.knowledge_links (
  from_entry_id uuid not null references public.knowledge_entries(id) on delete cascade,
  to_entry_id   uuid not null references public.knowledge_entries(id) on delete cascade,
  owner_id      uuid not null references auth.users(id) on delete cascade,
  created_at    timestamptz default now(),
  primary key (from_entry_id, to_entry_id)
);
create index if not exists kl_to_idx on public.knowledge_links (to_entry_id);

-- ============================================================
-- knowledge_daily_notes (one markdown blob per (owner, date))
-- ============================================================
create table if not exists public.knowledge_daily_notes (
  id         uuid primary key default gen_random_uuid(),
  owner_id   uuid not null references auth.users(id) on delete cascade,
  note_date  date not null,
  content    text default '',
  updated_at timestamptz default now(),
  unique (owner_id, note_date)
);

-- ============================================================
-- RLS
-- ============================================================
alter table public.knowledge_entries     enable row level security;
alter table public.knowledge_links       enable row level security;
alter table public.knowledge_daily_notes enable row level security;

drop policy if exists ke_owner on public.knowledge_entries;
drop policy if exists kl_owner on public.knowledge_links;
drop policy if exists kd_owner on public.knowledge_daily_notes;

create policy ke_owner on public.knowledge_entries
  for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());

create policy kl_owner on public.knowledge_links
  for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());

create policy kd_owner on public.knowledge_daily_notes
  for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());

-- ============================================================
-- Triggers (touch updated_at)
-- ============================================================
create or replace function public.knowledge_touch_updated_at() returns trigger as $$
begin new.updated_at := now(); return new; end;
$$ language plpgsql;

drop trigger if exists ke_touch on public.knowledge_entries;
create trigger ke_touch before update on public.knowledge_entries
  for each row execute function public.knowledge_touch_updated_at();

drop trigger if exists kd_touch on public.knowledge_daily_notes;
create trigger kd_touch before update on public.knowledge_daily_notes
  for each row execute function public.knowledge_touch_updated_at();

-- ============================================================
-- Full-text search RPC
-- ============================================================
create or replace function public.knowledge_search(q text default '')
returns setof public.knowledge_entries
language sql stable security invoker as $$
  select * from public.knowledge_entries
  where owner_id = auth.uid()
    and (coalesce(q,'') = '' or search_tsv @@ websearch_to_tsquery('simple', q))
  order by created_at desc
  limit 200;
$$;

grant execute on function public.knowledge_search(text) to authenticated;
