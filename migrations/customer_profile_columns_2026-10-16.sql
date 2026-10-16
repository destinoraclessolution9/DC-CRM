-- Customer becomes the single editable record after conversion (2026-10-16).
--
-- These person-profile columns existed only on `prospects`, so approving a sale
-- dropped them: a converted customer lost the business details, lead source,
-- CPS form, interests / pain points and the free-text notes the prospect had.
-- Same names + types as the prospects columns so the conversion copy
-- (window._dataHelpers.customerFieldsFromProspect) is a straight field copy.
--
-- Additive only. Sales-pipeline fields (pipeline_stage, protection_deadline,
-- deal_value, close_probability, cooldown_until, manual_grade, ...) stay on the
-- prospect as frozen history — they mean nothing for a customer.
alter table public.customers add column if not exists is_own_business      boolean;
alter table public.customers add column if not exists business_name        text;
alter table public.customers add column if not exists business_industry    text;
alter table public.customers add column if not exists business_area        text;
alter table public.customers add column if not exists business_title_role  text;
alter table public.customers add column if not exists business_started     date;
alter table public.customers add column if not exists company_size         text;
alter table public.customers add column if not exists source               text;
alter table public.customers add column if not exists original_source      text;
alter table public.customers add column if not exists cps_interest         text;
alter table public.customers add column if not exists cps_form_url         text;
alter table public.customers add column if not exists cps_form_name        text;
alter table public.customers add column if not exists cps_form_date        date;
alter table public.customers add column if not exists cps_attachment       jsonb;
alter table public.customers add column if not exists notes                text;
alter table public.customers add column if not exists interests            text;
alter table public.customers add column if not exists pain_points          text;
alter table public.customers add column if not exists budget_range         text;
alter table public.customers add column if not exists decision_maker       text;
alter table public.customers add column if not exists tags                 text[];

notify pgrst, 'reload schema';
