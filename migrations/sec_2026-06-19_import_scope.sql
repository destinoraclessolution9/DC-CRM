-- =====================================================================
-- SECURITY HARDENING — Phase 1 addendum: scope import_existing_matches (H6)
-- Date: 2026-06-19
--
-- import_existing_matches was EXECUTE-granted to PUBLIC + anon and returned
-- matched prospect/customer PII (name/phone/email/IC) for ANY supplied
-- phone/email/IC array, org-wide, unscoped -> an unauthenticated PII-harvest
-- oracle. Fix: revoke anon/public EXECUTE, and scope results to the caller's
-- visible-agent set (admins unrestricted). _fs_email_dupes: revoke anon/public.
-- =====================================================================

create or replace function public.import_existing_matches(
  p_table text, p_phones text[] default '{}', p_emails text[] default '{}', p_ics text[] default '{}')
returns table(id bigint, full_name text, phone text, email text, ic_number text,
              norm_phone text, norm_email text, norm_ic text)
language plpgsql security definer set search_path to 'public'
as $function$
declare v_admin boolean := coalesce(current_user_level(), 99) <= 2;
begin
  if p_table not in ('prospects', 'customers') then
    raise exception 'import_existing_matches: table % not allowed', p_table;
  end if;

  return query execute format($f$
    with vis as (select current_user_visible_ids() as vid),
    norm as (
      select t.id, t.full_name, t.phone, t.email, t.ic_number, t.responsible_agent_id,
        regexp_replace(regexp_replace(coalesce(t.phone, ''), '[-\s()]', '', 'g'), '^\+60', '0') as norm_phone,
        lower(btrim(coalesce(t.email, ''))) as norm_email,
        regexp_replace(coalesce(t.ic_number, ''), '[-\s]', '', 'g') as norm_ic
      from %I t
    )
    select id, full_name, phone, email, ic_number, norm_phone, norm_email, norm_ic
    from norm
    where ( $4 or responsible_agent_id in (select vid from vis) )
      and ( (norm_phone <> '' and norm_phone = any($1))
         or (norm_email <> '' and norm_email = any($2))
         or (norm_ic    <> '' and norm_ic    = any($3)) )
  $f$, p_table)
  using p_phones, p_emails, p_ics, v_admin;
end;
$function$;

revoke all on function public.import_existing_matches(text, text[], text[], text[]) from public, anon;
grant execute on function public.import_existing_matches(text, text[], text[], text[]) to authenticated;
revoke all on function public._fs_email_dupes() from public, anon;
