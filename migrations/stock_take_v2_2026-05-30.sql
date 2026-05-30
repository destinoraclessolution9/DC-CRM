-- ============================================================================
-- Stock Take v2: persistent shelf master + multi-store + multi-device sync
-- Date: 2026-05-30
-- ----------------------------------------------------------------------------
-- The v1 module persists everything in browser localStorage under
-- `stockTake.v1.*` keys. v2 introduces a Supabase-backed model that survives
-- device wipes, supports 2 tablets counting the same session in real time,
-- and adds a true Store -> Shelf hierarchy with QR-payload lookup so scanning
-- a shelf code resolves to the products expected on that shelf.
--
-- Schema:
--   st_stores             — 10 stores
--   st_shelves            — shelves, one QR payload each
--   st_product_master     — global product catalog
--   st_shelf_expected     — expected qty per (shelf, sku) — the source of truth
--   st_sessions           — stock take sessions, scoped to a store
--   st_counts             — every physical count row (append-only with soft-delete)
--   st_bulk_uploads       — per-session bulk Excel physical counts
--   st_exclusions         — global delisted SKU list (replaces local exclusions)
--   st_variance_reasons   — per-session SKU reasons captured in Summary
--
-- RLS: Super Admin / Marketing Manager only (current_user_level() <= 2), matching
--      the UI gate `isSystemAdmin(_currentUser)` already in place at script.js.
-- Realtime: st_counts is added to the supabase_realtime publication so the JS
--           layer can subscribe and live-merge counts from a second tablet.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Stores
-- ---------------------------------------------------------------------------
create table if not exists public.st_stores (
    id          uuid primary key default gen_random_uuid(),
    store_code  text not null unique,
    name        text not null,
    created_at  timestamptz not null default now(),
    updated_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Shelves
-- ---------------------------------------------------------------------------
create table if not exists public.st_shelves (
    id           uuid primary key default gen_random_uuid(),
    store_id     uuid not null references public.st_stores(id) on delete cascade,
    shelf_code   text not null,
    qr_payload   text not null unique,
    description  text default '',
    created_at   timestamptz not null default now(),
    updated_at   timestamptz not null default now(),
    unique (store_id, shelf_code)
);
create index if not exists st_shelves_store_idx on public.st_shelves (store_id);

-- ---------------------------------------------------------------------------
-- Product master (global SKU catalog)
-- ---------------------------------------------------------------------------
create table if not exists public.st_product_master (
    sku                text primary key,
    product_name       text default '',
    product_attribute  text default '',
    created_at         timestamptz not null default now(),
    updated_at         timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Expected inventory per shelf
-- ---------------------------------------------------------------------------
create table if not exists public.st_shelf_expected (
    shelf_id     uuid not null references public.st_shelves(id) on delete cascade,
    sku          text not null references public.st_product_master(sku) on delete cascade,
    expected_qty integer not null default 0 check (expected_qty >= 0),
    updated_at   timestamptz not null default now(),
    primary key (shelf_id, sku)
);
create index if not exists st_shelf_expected_sku_idx on public.st_shelf_expected (sku);

-- ---------------------------------------------------------------------------
-- Sessions
-- ---------------------------------------------------------------------------
create table if not exists public.st_sessions (
    id            uuid primary key default gen_random_uuid(),
    session_code  text not null unique,
    store_id      uuid references public.st_stores(id) on delete set null,
    status        text not null default 'open' check (status in ('open','closed')),
    tolerance     integer not null default 0 check (tolerance >= 0),
    created_by    text default '',
    created_at    timestamptz not null default now(),
    closed_at     timestamptz
);
create index if not exists st_sessions_store_idx on public.st_sessions (store_id, status);

-- ---------------------------------------------------------------------------
-- Counts (append-only with soft-delete via superseded_at)
-- ---------------------------------------------------------------------------
create table if not exists public.st_counts (
    id              uuid primary key default gen_random_uuid(),
    session_id      uuid not null references public.st_sessions(id) on delete cascade,
    shelf_id        uuid references public.st_shelves(id) on delete set null,
    location_label  text default '',
    shelf_text      text default '',
    sku             text not null,
    qty             integer not null check (qty >= 0),
    counter         text default '',
    is_recount      boolean not null default false,
    superseded_at   timestamptz,
    created_at      timestamptz not null default now()
);
create index if not exists st_counts_session_idx on public.st_counts (session_id, superseded_at);
create index if not exists st_counts_session_sku_idx on public.st_counts (session_id, sku);

-- ---------------------------------------------------------------------------
-- Bulk uploads
-- ---------------------------------------------------------------------------
create table if not exists public.st_bulk_uploads (
    id           uuid primary key default gen_random_uuid(),
    session_id   uuid not null references public.st_sessions(id) on delete cascade,
    sku          text not null,
    location     text default '',
    physical_qty integer not null check (physical_qty >= 0),
    file_name    text default '',
    uploaded_by  text default '',
    uploaded_at  timestamptz not null default now()
);
create index if not exists st_bulk_session_idx on public.st_bulk_uploads (session_id);

-- ---------------------------------------------------------------------------
-- Exclusions (global delisted SKU list)
-- ---------------------------------------------------------------------------
create table if not exists public.st_exclusions (
    sku        text primary key,
    reason     text default '',
    added_by   text default '',
    added_at   timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Variance reasons (per-session annotation captured in Final Summary)
-- ---------------------------------------------------------------------------
create table if not exists public.st_variance_reasons (
    session_id uuid not null references public.st_sessions(id) on delete cascade,
    sku        text not null,
    reason     text default '',
    updated_at timestamptz not null default now(),
    primary key (session_id, sku)
);

-- ===========================================================================
-- Touch updated_at triggers
-- ===========================================================================
create or replace function public.st_touch_updated_at() returns trigger as $$
begin new.updated_at := now(); return new; end;
$$ language plpgsql;

do $$
declare t text;
declare touched text[] := array[
    'st_stores','st_shelves','st_product_master','st_shelf_expected'
];
begin
    foreach t in array touched loop
        execute format('drop trigger if exists %I_touch on public.%I', t, t);
        execute format('create trigger %I_touch before update on public.%I for each row execute function public.st_touch_updated_at()', t, t);
    end loop;
end $$;

-- ===========================================================================
-- RLS — Super Admin / Marketing Manager only (current_user_level() <= 2),
-- matching the UI gate at script.js:49656 `isSystemAdmin(_currentUser)`.
-- Falls back to permissive auth_full_access if current_user_level() is null
-- (during tests / before users.role is wired up).
-- ===========================================================================
do $$
declare t text;
declare st_tables text[] := array[
    'st_stores','st_shelves','st_product_master','st_shelf_expected',
    'st_sessions','st_counts','st_bulk_uploads','st_exclusions','st_variance_reasons'
];
begin
    foreach t in array st_tables loop
        execute format('alter table public.%I enable row level security', t);
        execute format('drop policy if exists "st_admin_full" on public.%I', t);
        execute format(
            'create policy "st_admin_full" on public.%I for all to authenticated ' ||
            '  using  (coalesce(current_user_level(), 1) <= 2) ' ||
            '  with check (coalesce(current_user_level(), 1) <= 2)', t);
    end loop;
end $$;

-- ===========================================================================
-- Realtime: counts table is published so a second device sees new scans live
-- ===========================================================================
do $$
begin
    if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
        begin
            execute 'alter publication supabase_realtime add table public.st_counts';
        exception when duplicate_object then null;
        end;
        begin
            execute 'alter publication supabase_realtime add table public.st_sessions';
        exception when duplicate_object then null;
        end;
        begin
            execute 'alter publication supabase_realtime add table public.st_shelves';
        exception when duplicate_object then null;
        end;
    end if;
end $$;

-- ===========================================================================
-- Grants (anon client uses authenticated role after sign-in; explicit grants
-- so PostgREST exposes these tables even before role refresh)
-- ===========================================================================
grant usage on schema public to authenticated;
grant select, insert, update, delete on
    public.st_stores,
    public.st_shelves,
    public.st_product_master,
    public.st_shelf_expected,
    public.st_sessions,
    public.st_counts,
    public.st_bulk_uploads,
    public.st_exclusions,
    public.st_variance_reasons
to authenticated;

-- ===========================================================================
-- Verification queries (manual — run after applying):
-- select count(*) from st_stores;
-- select tablename from pg_tables where tablename like 'st_%';
-- select tablename, rowsecurity from pg_tables where tablename like 'st_%';
-- select polname, polrelid::regclass from pg_policy where polname = 'st_admin_full';
-- ===========================================================================
