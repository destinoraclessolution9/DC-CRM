-- Freeze a converted prospect's PROFILE (2026-10-16).
--
-- After conversion the customer row is the one editable record (customer
-- profile → Edit). The app no longer opens a converted prospect's profile or its
-- edit form, but a stale screen / offline replay / old cached bundle could still
-- PATCH it and silently fork the two records. This trigger rejects profile-field
-- changes on a converted prospect coming from app users (PostgREST roles).
--
-- Deliberately NOT frozen:
--   * sales / history stores keyed to the prospect, which the customer profile
--     still drives: closing_record, closing_records_history, pre2025_purchases,
--     feng_shui_audits, conversion_* (incl. the failed-create rollback);
--   * responsible_agent_id (reassignment cascades), tags/notes/score and other
--     system-maintained columns;
--   * clearing phone / email to NULL (Data Quality → phone/email de-duplication);
--   * a write that moves the row OUT of converted in the same statement
--     (conversion rollback);
--   * SQL run as the owner / service role (admin backfills, SECURITY DEFINER RPCs).
--
-- errcode 42501 so the client's sync queue classifies it as permanent (parked),
-- not transient (retried forever).
create or replace function public.prospects_freeze_converted_profile()
returns trigger
language plpgsql
as $$
declare
    f text;
    frozen text[] := array[
        'title','full_name','nickname','gender','nationality','phone','email',
        'ic_number','date_of_birth','lunar_birth','life_chart_type','ming_gua',
        'occupation','company_name','income_range','address','city','state','postal_code',
        'marital_status','children','spouse_name','country','cps_interest',
        'referred_by','referred_by_id','referred_by_type','referral_relationship'
    ];
    o jsonb;
    n jsonb;
begin
    if current_user not in ('authenticated', 'anon') then
        return new;
    end if;
    if coalesce(old.status, '') <> 'converted' and coalesce(old.conversion_status, '') <> 'approved' then
        return new;
    end if;
    if coalesce(new.status, '') <> 'converted' and coalesce(new.conversion_status, '') <> 'approved' then
        return new; -- conversion rollback
    end if;
    o := to_jsonb(old);
    n := to_jsonb(new);
    foreach f in array frozen loop
        if (o -> f) is distinct from (n -> f) then
            if f in ('phone', 'email') and (n -> f = 'null'::jsonb or n ->> f = '') then
                continue; -- de-duplication clears are allowed
            end if;
            raise exception 'Prospect % is now a customer — its profile is frozen; edit the customer profile instead (field: %)', old.id, f
                using errcode = '42501';
        end if;
    end loop;
    return new;
end;
$$;

drop trigger if exists prospects_freeze_converted_profile on public.prospects;
create trigger prospects_freeze_converted_profile
    before update on public.prospects
    for each row execute function public.prospects_freeze_converted_profile();
