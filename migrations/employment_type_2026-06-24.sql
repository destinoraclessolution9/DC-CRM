-- Agent employment type (part-time / full-time) for weekly operating-hours tracking.
-- Additive + backward-compatible: nullable column with a default, so every
-- existing row reads as 'full-time' until an admin edits the agent. No existing
-- read/write path references this column, so adding it breaks nothing.
--
-- Weekly hour targets are DERIVED in the app (not stored), so they can be tuned
-- without a migration: full-time = 45h/week, part-time = 20h/week.
--
-- Apply on live project remuwhxvzkzjtgbzqjaa (Supabase SQL Editor or PAT).
-- MUST be applied BEFORE the matching saveAgent code ships — PostgREST rejects
-- writes that include an unknown column.

alter table public.users
    add column if not exists employment_type text not null default 'full-time';

-- Constrain to the two supported values. Guarded so re-running is a no-op.
do $$
begin
    if not exists (
        select 1 from pg_constraint where conname = 'users_employment_type_chk'
    ) then
        alter table public.users
            add constraint users_employment_type_chk
            check (employment_type in ('full-time', 'part-time'));
    end if;
end $$;

-- 2026-06-29: widen to allow 'na' (Not applicable) for L12-15 roles
-- (传福大使 / customer / referrer / stock-take) where weekly hours don't apply.
-- Drop + re-add so the new value is accepted; idempotent.
alter table public.users
    drop constraint if exists users_employment_type_chk;
alter table public.users
    add constraint users_employment_type_chk
    check (employment_type in ('full-time', 'part-time', 'na'));
