-- Phase 1 (#12) — import duplicate-check existence lookup. APPLIED to live 2026-06-14.
--
-- runDuplicateCheck() used to getAll(table) — download the ENTIRE prospects /
-- customers table into the browser just to dedup an import file against it. At
-- 500k rows that is a multi-MB transfer + full client-side map build on every
-- import preview. This RPC instead returns ONLY the existing rows whose
-- normalized phone/email/ic matches a key actually present in the import file.
-- A duplicate match requires key equality, so rows whose key is NOT in the
-- import set can never match — restricting to them is logically equivalent to
-- the whole-table scan, but the payload is just the real candidates.
--
-- Normalization MUST mirror the client exactly (chunks/script-import.js):
--   phone: strip [-\s()] then leading +60 -> 0      (normalisePhone)
--   email: lower(trim(...))
--   ic:    strip [-\s]
-- Whitelisted to prospects|customers — the only contact tables imported
-- (marketing list types dedup by name on small tables, left on the legacy path).

create or replace function public.import_existing_matches(
  p_table  text,
  p_phones text[] default '{}',
  p_emails text[] default '{}',
  p_ics    text[] default '{}'
)
returns table (
  id bigint, full_name text, phone text, email text, ic_number text,
  norm_phone text, norm_email text, norm_ic text
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_table not in ('prospects', 'customers') then
    raise exception 'import_existing_matches: table % not allowed', p_table;
  end if;

  return query execute format($f$
    with norm as (
      select t.id, t.full_name, t.phone, t.email, t.ic_number,
        regexp_replace(regexp_replace(coalesce(t.phone, ''), '[-\s()]', '', 'g'), '^\+60', '0') as norm_phone,
        lower(btrim(coalesce(t.email, ''))) as norm_email,
        regexp_replace(coalesce(t.ic_number, ''), '[-\s]', '', 'g') as norm_ic
      from %I t
    )
    select id, full_name, phone, email, ic_number, norm_phone, norm_email, norm_ic
    from norm
    where (norm_phone <> '' and norm_phone = any($1))
       or (norm_email <> '' and norm_email = any($2))
       or (norm_ic    <> '' and norm_ic    = any($3))
  $f$, p_table)
  using p_phones, p_emails, p_ics;
end;
$$;

-- Optional follow-up for true 500k scale (imports are infrequent, so the seq
-- scan + regex is acceptable today; add these if preview latency bites):
--   create index if not exists idx_prospects_norm_phone on prospects
--     (regexp_replace(regexp_replace(coalesce(phone,''),'[-\s()]','','g'),'^\+60','0'));
--   create index if not exists idx_customers_norm_phone on customers
--     (regexp_replace(regexp_replace(coalesce(phone,''),'[-\s()]','','g'),'^\+60','0'));

grant execute on function public.import_existing_matches to authenticated;
