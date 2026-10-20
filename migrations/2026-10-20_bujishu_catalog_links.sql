-- Bujishu Catalogue in every product picker (2026-10-20). Additive only.
-- Pickers store a clean text label: "<name> · <option>" with [ ] , | replaced
-- (the potential text format uses [Group] markers + commas). These columns +
-- triggers turn that label back into exact catalogue ids, so Won / Bought /
-- 汇集 / reports match by item, not by guessing names.

alter table public.pipeline_deals
    add column if not exists catalog text not null default 'dc',
    add column if not exists catalog_item_id bigint,
    add column if not exists catalog_option_id bigint;
alter table public.audit_prescriptions
    add column if not exists catalog text not null default 'dc',
    add column if not exists catalog_item_id bigint,
    add column if not exists catalog_option_id bigint;
alter table public.purchases
    add column if not exists bujishu_catalog_id bigint,
    add column if not exists bujishu_option_id bigint;
create index if not exists purchases_bujishu_catalog_idx on public.purchases (bujishu_catalog_id) where bujishu_catalog_id is not null;

-- Same cleaning the client applies to catalogue names / option labels.
create or replace function public.bjc_clean(t text) returns text
language sql immutable as $$
    select btrim(regexp_replace(translate(coalesce(t, ''), '[],|', '()，/'), '\s+', ' ', 'g'))
$$;

-- Label → (catalog_id, option_id). Exact match on the cleaned name, optionally
-- followed by " · <cleaned option label>". Optional leading "🛋️ " is ignored.
create or replace function public.bjc_resolve(p_label text, out catalog_id bigint, out option_id bigint)
language plpgsql stable security definer set search_path = public as $$
declare v text := public.bjc_clean(regexp_replace(coalesce(p_label, ''), '^\s*🛋️?\s*', ''));
        r record;
begin
    if v = '' then return; end if;
    select c.id into catalog_id from public.bujishu_catalog c where public.bjc_clean(c.name) = v limit 1;
    if catalog_id is not null then return; end if;
    for r in select c.id, public.bjc_clean(c.name) as n from public.bujishu_catalog c
              where v like public.bjc_clean(c.name) || ' · %' order by length(c.name) desc limit 3 loop
        select o.id into option_id from public.bujishu_catalog_options o
         where o.catalog_id = r.id and public.bjc_clean(o.option_label) = btrim(substr(v, length(r.n) + 4)) limit 1;
        catalog_id := r.id;
        return;
    end loop;
end $$;

create or replace function public.purchases_bjc_fill() returns trigger
language plpgsql security definer set search_path = public as $$
declare r record;
begin
    if new.bujishu_catalog_id is null and coalesce(new.item, '') <> '' then
        select * into r from public.bjc_resolve(new.item);
        new.bujishu_catalog_id := r.catalog_id;
        new.bujishu_option_id := r.option_id;
    end if;
    return new;
exception when others then return new;
end $$;
drop trigger if exists trg_purchases_bjc_fill on public.purchases;
create trigger trg_purchases_bjc_fill before insert or update of item on public.purchases
    for each row execute function public.purchases_bjc_fill();

create or replace function public.catalog_link_fill() returns trigger
language plpgsql security definer set search_path = public as $$
declare r record;
begin
    if new.catalog_item_id is null and coalesce(new.product, '') <> '' then
        select * into r from public.bjc_resolve(new.product);
        if r.catalog_id is not null then
            new.catalog := 'bujishu';
            new.catalog_item_id := r.catalog_id;
            new.catalog_option_id := r.option_id;
        end if;
    end if;
    return new;
exception when others then return new;
end $$;
drop trigger if exists trg_pipeline_deals_catalog_fill on public.pipeline_deals;
create trigger trg_pipeline_deals_catalog_fill before insert or update of product on public.pipeline_deals
    for each row execute function public.catalog_link_fill();
drop trigger if exists trg_audit_prescriptions_catalog_fill on public.audit_prescriptions;
create trigger trg_audit_prescriptions_catalog_fill before insert or update of product on public.audit_prescriptions
    for each row execute function public.catalog_link_fill();

-- Sale ↔ potential: same catalogue item (and option when both sides have one)
-- OR the existing name rule.
create or replace function public.pipeline_item_match(p_item text, p_cat bigint, p_opt bigint,
                                                      p_product text, p_pcat bigint, p_popt bigint) returns boolean
language sql immutable as $$
    select case
        when p_cat is not null and p_pcat is not null
            then p_cat = p_pcat and (p_opt is null or p_popt is null or p_opt = p_popt)
        else public.pipeline_name_match(p_item, p_product)
    end
$$;

create or replace function public.pipeline_deal_autowon() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_pid bigint; v_audit bigint; d_id bigint;
begin
    v_pid := new.prospect_id;
    if v_pid is null and new.customer_id is not null then
        select converted_from_prospect_id into v_pid from public.customers where id = new.customer_id;
    end if;
    if v_pid is null then return new; end if;

    for v_audit in
        update public.audit_prescriptions
           set status = 'bought', purchase_id = new.id, bought_at = now(), updated_at = now()
         where prospect_id = v_pid and status in ('proposed','accepted')
           and public.pipeline_item_match(new.item, new.bujishu_catalog_id, new.bujishu_option_id, product, catalog_item_id, catalog_option_id)
        returning audit_id
    loop
        perform public.pipeline_sync_prescription(v_pid, v_audit);
    end loop;

    if not found then
        select id into d_id from public.pipeline_deals
         where prospect_id = v_pid and audit_id is null and stage in ('interested','proposal','prescribed','closing')
         order by (case when public.pipeline_item_match(new.item, new.bujishu_catalog_id, new.bujishu_option_id, product, catalog_item_id, catalog_option_id) then 0 else 1 end),
                  expected_close_date, id
         limit 1;
        if d_id is not null then
            update public.pipeline_deals set stage = 'won', purchase_id = new.id, won_at = now(), updated_at = now() where id = d_id;
        end if;
    end if;
    return new;
exception when others then
    return new;
end $$;
-- BEFORE trigger (ids) runs before this AFTER trigger, so new.bujishu_* are set.

-- Backfill the new id columns on existing rows (fills NULL columns only).
update public.purchases p set bujishu_catalog_id = r.catalog_id, bujishu_option_id = r.option_id
  from (select id, (public.bjc_resolve(item)).* from public.purchases where bujishu_catalog_id is null and coalesce(item, '') <> '') r
 where p.id = r.id and r.catalog_id is not null;
update public.pipeline_deals d set catalog = 'bujishu', catalog_item_id = r.catalog_id, catalog_option_id = r.option_id
  from (select id, (public.bjc_resolve(product)).* from public.pipeline_deals where catalog_item_id is null) r
 where d.id = r.id and r.catalog_id is not null;
