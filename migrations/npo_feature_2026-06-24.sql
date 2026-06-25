-- =====================================================================
-- NPO (installment-package deal type) — schema foundation
-- Date: 2026-06-24      STATUS: DRAFT — NOT YET APPLIED (held for owner review)
--
-- NPO is a 4th deal type alongside Full Payment (DO) / POP / Pre-on. It is a
-- configurable installment PACKAGE: admin pre-sets named/versioned plans
-- ("NPO 1.0", "NPO 2.0"); each plan has fixed TIERS (e.g. 45K / 55K / 65K) with
-- a fixed first payment + monthly x tenure, and a whitelist of eligible products
-- drawn from the existing `products` catalog.
--
-- CONFIRMED RULES (owner, 2026-06-24):
--  * Tier/overage: the cart total must be >= the chosen tier ("only over, never
--    below"). The agent picks the LARGEST tier <= cart_total; the excess
--    (cart_total - tier_amount) is added to the first payment / deposit.
--    e.g. cart 70K -> 65K tier, +5K -> deposit. Cart below the lowest tier (45K)
--    is not eligible for NPO.
--  * Products come from the existing `products` catalog (per-plan whitelist).
--  * Multiple products per invoice; one lump-sum package.
--  * Fulfillment mode is chosen PER SALE: 'all_within_period' (receive all goods
--    within e.g. 12 months while still paying) vs 'full_payment_first' (receive
--    only after the plan is fully paid).
--  * Per-item redemption timing ("Flexy after 4 month", "mattress 6 month") is
--    captured per sale line (redeem_after_months).
--  * Per-item DELIVERY status (goods arrive separately).
--  * Installments are tracked monthly; a payment can LAPSE; a payment SLIP
--    (proof of transfer) must be storable per installment, including a manual
--    transfer slip used to clear a lapsed payment ("resubmit").
--  * Reporting: NPO counts under PORT (PO bucket), NOT RMT (full payment).
--
-- OPEN (flagged for owner before the SALE flow is built — Phase 2):
--  * Are tier terms (first_payment/monthly/tenure) LOCKED to the tier, or can an
--    agent override per sale? (Schema assumes locked + snapshot-on-sale.)
--  * LTV / customer purchase value at sale = full plan amount, or collected-to-
--    date? (Affects reporting/LTV in Phase 5, not these tables.)
--
-- VERIFY BEFORE APPLY: products.id and customers.id are bigint (FK types below
-- assume bigint identity, the project convention). RLS policies below are a
-- first cut — review the access model (admin-only config writes; agent-scoped
-- sales) before applying.
-- =====================================================================

begin;

-- ── Phase 1: plan configuration (admin "pre-setting") ───────────────────────

create table if not exists public.npo_plans (
  id          bigint generated always as identity primary key,
  name        text    not null,                 -- "NPO 1.0", "Standard 45/55/65"
  description text,
  is_active   boolean not null default true,
  -- who a package may be sold to: existing customers only / new customers only / both
  customer_eligibility text not null default 'both'
    check (customer_eligibility in ('existing','new','both')),
  created_at  timestamptz not null default now(),
  created_by  bigint
);

create table if not exists public.npo_plan_tiers (
  id            bigint generated always as identity primary key,
  plan_id       bigint  not null references public.npo_plans(id) on delete cascade,
  tier_amount   numeric(12,2) not null,         -- 45000
  first_payment numeric(12,2) not null,         -- 9045  (base deposit for the tier)
  monthly_amount numeric(12,2) not null,        -- 799
  tenure_months int    not null,                -- 45
  sort_order    int    not null default 0,
  note          text,
  check (tier_amount > 0 and first_payment >= 0 and monthly_amount >= 0 and tenure_months > 0)
);
create index if not exists idx_npo_plan_tiers_plan on public.npo_plan_tiers(plan_id);

create table if not exists public.npo_plan_products (
  id          bigint generated always as identity primary key,
  plan_id     bigint not null references public.npo_plans(id) on delete cascade,
  product_id  bigint not null,                  -- references public.products(id)
  default_redeem_after_months int,              -- optional default (e.g. Flexy=4, mattress=6)
  unique (plan_id, product_id)
);
create index if not exists idx_npo_plan_products_plan on public.npo_plan_products(plan_id);

-- ── Phase 2: the NPO sale / invoice (schema staged; flow built after sign-off) ─

create table if not exists public.npo_sales (
  id            bigint generated always as identity primary key,
  customer_id   bigint,                          -- references public.customers(id); null when a brand-new customer
  customer_name text,                             -- captured name when customer_id is null (new customer)
  plan_id       bigint references public.npo_plans(id),
  tier_id       bigint references public.npo_plan_tiers(id),
  cart_total    numeric(12,2) not null,
  tier_amount   numeric(12,2) not null,          -- snapshot of chosen tier
  overage       numeric(12,2) not null default 0 check (overage >= 0),
  first_payment numeric(12,2) not null,          -- tier.first_payment + overage (deposit collected)
  monthly_amount numeric(12,2) not null,         -- snapshot
  tenure_months int    not null,                 -- snapshot
  fulfillment_mode text not null
    check (fulfillment_mode in ('all_within_period','full_payment_first')),
  redemption_period_months int,                  -- e.g. 12, when all_within_period
  start_date    date   not null,
  status        text   not null default 'active'
    check (status in ('active','completed','lapsed','cancelled')),
  responsible_agent_id bigint,                    -- for visibility scoping
  created_at    timestamptz not null default now(),
  created_by    bigint
);
create index if not exists idx_npo_sales_customer on public.npo_sales(customer_id);

create table if not exists public.npo_sale_items (
  id            bigint generated always as identity primary key,
  sale_id       bigint not null references public.npo_sales(id) on delete cascade,
  product_id    bigint,                           -- references public.products(id)
  product_name  text,                             -- snapshot at sale
  qty           int    not null default 1,
  unit_price    numeric(12,2),
  line_total    numeric(12,2),
  redeem_after_months int,                         -- per-item redemption timing (per sale)
  delivery_status text not null default 'pending'
    check (delivery_status in ('pending','ordered','in_transit','delivered','redeemed')),
  delivered_date date
);
create index if not exists idx_npo_sale_items_sale on public.npo_sale_items(sale_id);

create table if not exists public.npo_installments (
  id            bigint generated always as identity primary key,
  sale_id       bigint not null references public.npo_sales(id) on delete cascade,
  seq           int    not null,                  -- 1..tenure
  due_date      date   not null,
  amount        numeric(12,2) not null,
  status        text   not null default 'due'
    check (status in ('due','paid','lapsed','waived')),
  paid_date     date,
  slip_url      text,                             -- payment-proof upload (per installment)
  is_manual_transfer boolean not null default false, -- manual transfer (e.g. clearing a lapse)
  note          text,
  unique (sale_id, seq)
);
create index if not exists idx_npo_installments_sale on public.npo_installments(sale_id);

-- ── RLS (first cut — review before apply) ───────────────────────────────────
-- Config tables: any authenticated user may READ; only admins (level <= 2) WRITE.
-- Sale tables: authenticated read/write (app/BFF applies agent scoping like the
-- rest of the CRM). current_user_level() is the existing helper used elsewhere.

alter table public.npo_plans          enable row level security;
alter table public.npo_plan_tiers     enable row level security;
alter table public.npo_plan_products  enable row level security;
alter table public.npo_sales          enable row level security;
alter table public.npo_sale_items     enable row level security;
alter table public.npo_installments   enable row level security;

do $$
begin
  -- read for all authenticated
  perform 1;
  execute 'create policy npo_plans_read on public.npo_plans for select to authenticated using (true)';
  execute 'create policy npo_tiers_read on public.npo_plan_tiers for select to authenticated using (true)';
  execute 'create policy npo_prod_read on public.npo_plan_products for select to authenticated using (true)';
  -- admin-only write on config
  execute 'create policy npo_plans_admin on public.npo_plans for all to authenticated using (public.current_user_level() <= 2) with check (public.current_user_level() <= 2)';
  execute 'create policy npo_tiers_admin on public.npo_plan_tiers for all to authenticated using (public.current_user_level() <= 2) with check (public.current_user_level() <= 2)';
  execute 'create policy npo_prod_admin on public.npo_plan_products for all to authenticated using (public.current_user_level() <= 2) with check (public.current_user_level() <= 2)';
  -- sales: authenticated read/write (finer scope enforced app-side / BFF)
  execute 'create policy npo_sales_rw on public.npo_sales for all to authenticated using (true) with check (true)';
  execute 'create policy npo_items_rw on public.npo_sale_items for all to authenticated using (true) with check (true)';
  execute 'create policy npo_inst_rw on public.npo_installments for all to authenticated using (true) with check (true)';
exception when duplicate_object then null;
end $$;

commit;

-- VERIFY AFTER APPLY:
--   select table_name from information_schema.tables
--   where table_schema='public' and table_name like 'npo_%' order by 1;  -- expect 6
