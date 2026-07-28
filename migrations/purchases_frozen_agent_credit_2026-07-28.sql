-- purchases.agent_id — freeze sales credit at the moment of the sale, so
-- reassigning a customer stops rewriting their sales history.
--
-- THE BUG:
--   Every money surface attributes a purchase by joining the LIVE
--   customers.responsible_agent_id. Reassigning a customer therefore moves ALL
--   of that customer's past sales to the new owner — last month's leaderboard,
--   last quarter's target actuals and every historical drill-down silently
--   restate. The reassign UI does not promise this: it says the linked customer
--   moves "incl. FUTURE commission & renewal credit"
--   (chunks/script-import.js:1852). And the product already treats history as
--   something you opt into rewriting — the sibling activities toggle spells out
--   "past activities will flip … historical KPI credit rewrites" vs "Past
--   activity credit stays with <old agent> (KPI history preserved)". Money had
--   no such choice; it always rewrote.
--
-- THE FIX: stamp the credited agent onto the purchase row when the sale is
--   booked, and resolve attribution as coalesce(p.agent_id, c.responsible_agent_id)
--   everywhere. Past sales keep the agent who owned the customer then; the
--   customer's FUTURE sales follow the new owner, which is exactly what the UI
--   already promises.
--
-- THIS IS NOT CLOSER CREDIT. agent_id holds the OWNER at time of sale, not
--   whoever closed the deal. Owner attribution is unchanged by decision
--   (2026-07-27) — closers are recognised via the separate "Closed for others"
--   count on the Ranking board, which touches no money.
--
-- WHY THE OLD "do NOT add an agent column" COMMENT DOES NOT APPLY:
--   chunks/script-customers.js and three migration headers warn against
--   purchases.agent_id because of commit 7540fbe (2026-04-17), which WROTE and
--   READ that column without ever shipping a migration to create it. That caused
--   (a) a failed-insert + silent strip-retry on every save and (b) an
--   always-zero leaderboard. It was a phantom-column bug, never a double-count,
--   and the value it wrote was the owner anyway. The column is created here
--   FIRST, and every reader is switched in the same change.
--
-- THE BACKFILL IS A SEMANTIC NO-OP. Setting agent_id = the current owner makes
--   coalesce(p.agent_id, c.responsible_agent_id) identical to today's
--   c.responsible_agent_id for all 197 existing rows — every historical number
--   is byte-identical the moment this lands. It only FREEZES them going forward.
--
-- ✅ APPLIED to live (remuwhxvzkzjtgbzqjaa) 2026-07-28, verified: totals compared
--    before/after (identical) and pg_get_functiondef re-read.

-- ── 1. Column ────────────────────────────────────────────────────────────────
alter table public.purchases
  add column if not exists agent_id bigint;

comment on column public.purchases.agent_id is
  'Agent credited with this sale, frozen when the sale was booked (the customer''s responsible_agent_id at that moment). Reporting resolves attribution as coalesce(agent_id, customers.responsible_agent_id), so reassigning a customer no longer rewrites their sales history. NOT the closer — owner attribution is deliberate; see the "Closed for others" Ranking column for closer recognition. Intentionally no FK: deleting an agent must not cascade-delete money.';

create index if not exists idx_purchases_agent_date
  on public.purchases (agent_id, date desc)
  where agent_id is not null;

-- ── 2. Backfill (semantic no-op — see header) ────────────────────────────────
update public.purchases p
   set agent_id = c.responsible_agent_id
  from public.customers c
 where c.id = p.customer_id
   and p.agent_id is null
   and c.responsible_agent_id is not null;

-- ── 3. Readers — one authoritative basis: coalesce(p.agent_id, c.responsible_agent_id)
-- Only the PURCHASE-attribution expressions change. Counts that are about the
-- customer rather than the sale (kpi_target_comparison.new_customers,
-- kpi_user_summary.new_customers) stay on the live owner and are untouched, as is
-- kpi_user_summary entirely. purchase_sales_by_day / purchase_category_counts take
-- no agent parameter and are unaffected.

create or replace function public.agent_sales_by_period(
    p_cur_from date, p_cur_to date, p_prev_from date, p_prev_to date,
    p_agent_ids bigint[] default null::bigint[])
 returns table(agent_id bigint, current_sales numeric, prev_sales numeric)
 language sql
 security definer
 set search_path to 'public'
as $function$
  with scope as (
    select case when auth.uid() is null then p_agent_ids
                else public.bff_visible_agent_ids(auth.uid()) end as ids
  )
  select
    coalesce(p.agent_id, c.responsible_agent_id) as agent_id,
    coalesce(sum(p.amount) filter (where p.date >= p_cur_from  and p.date <= p_cur_to),  0) as current_sales,
    coalesce(sum(p.amount) filter (where p.date >= p_prev_from and p.date <= p_prev_to), 0) as prev_sales
  from purchases p
  join customers c on c.id = p.customer_id
  where coalesce(p.agent_id, c.responsible_agent_id) is not null
    and ((select ids from scope) is null
         or coalesce(p.agent_id, c.responsible_agent_id) in (select unnest(ids) from scope))
    and ((p.date >= p_cur_from and p.date <= p_cur_to) or (p.date >= p_prev_from and p.date <= p_prev_to))
  group by coalesce(p.agent_id, c.responsible_agent_id);
$function$;

create or replace function public.report_purchase_details(
    p_from date, p_to date, p_agent_ids bigint[] default null::bigint[], p_role text default null::text)
 returns table(date date, amount numeric, payment_method text, item text, epp_bank text,
               epp_months integer, is_agent_package boolean, responsible_agent_id bigint,
               agent_name text, customer_name text)
 language sql
 security definer
 set search_path to 'public'
as $function$
  with scope as (
    select case when auth.uid() is null then p_agent_ids
                else public.bff_visible_agent_ids(auth.uid()) end as ids
  )
  select
    p.date, p.amount, p.payment_method, p.item,
    p.epp_bank, p.epp_months, p.is_agent_package,
    coalesce(p.agent_id, c.responsible_agent_id) as responsible_agent_id,
    u.full_name as agent_name, c.full_name as customer_name
  from purchases p
  left join customers c on c.id = p.customer_id
  left join users u     on u.id = coalesce(p.agent_id, c.responsible_agent_id)
  where (p.date is null or (p.date >= p_from and p.date <= p_to))
    and ((select ids from scope) is null
         or coalesce(p.agent_id, c.responsible_agent_id) in (select unnest(ids) from scope))
    and (p_role is null or p_role = 'All' or u.role = p_role)
  order by p.date desc nulls last;
$function$;

create or replace function public.kpi_purchase_summary(
    p_from date, p_to date, p_agent_ids bigint[] default null::bigint[], p_role text default null::text)
 returns jsonb
 language sql
 stable
as $function$
    WITH filtered AS (
        SELECT p.amount, p.payment_method, p.epp_bank, p.epp_months
        FROM public.purchases p
        LEFT JOIN public.customers c ON c.id = p.customer_id
        LEFT JOIN public.users u ON u.id = COALESCE(p.agent_id, c.responsible_agent_id)
        WHERE p.date BETWEEN p_from AND p_to
          AND COALESCE(p.is_agent_package, false) = false
          AND (public.report_scope_ids(p_agent_ids) IS NULL
               OR COALESCE(p.agent_id, c.responsible_agent_id) = ANY(public.report_scope_ids(p_agent_ids)))
          AND (p_role IS NULL OR p_role = 'All' OR u.role = p_role)
    ),
    epp_rows AS (
        SELECT COALESCE(epp_bank, 'Unknown') AS bank,
               COALESCE(epp_months::text, '-') AS months,
               COUNT(*) AS cnt
        FROM filtered
        WHERE payment_method = 'EPP'
        GROUP BY bank, months
    )
    SELECT jsonb_build_object(
        'total_sales',  (SELECT COALESCE(SUM(amount), 0) FROM filtered),
        'pop_count',    (SELECT COUNT(*) FROM filtered WHERE payment_method = 'POP'),
        'pop_sales',    (SELECT COALESCE(SUM(amount), 0) FROM filtered WHERE payment_method = 'POP'),
        'epp_count',    (SELECT COUNT(*) FROM filtered WHERE payment_method = 'EPP'),
        'epp_sales',    (SELECT COALESCE(SUM(amount), 0) FROM filtered WHERE payment_method = 'EPP'),
        'epp_details',  COALESCE((SELECT jsonb_agg(jsonb_build_object('bank', bank, 'months', months, 'count', cnt)) FROM epp_rows), '[]'::jsonb)
    );
$function$;

create or replace function public.kpi_target_comparison(
    p_from date, p_to date, p_agent_ids bigint[] default null::bigint[], p_role text default null::text)
 returns jsonb
 language sql
 stable
 set search_path to 'public'
as $function$
    WITH act AS (
        SELECT a.activity_type
        FROM public.activities a
        LEFT JOIN public.users u ON u.id = a.lead_agent_id
        WHERE a.activity_date BETWEEN p_from AND p_to
          AND (public.report_scope_ids(p_agent_ids) IS NULL OR a.lead_agent_id = ANY(public.report_scope_ids(p_agent_ids)))
          AND (p_role IS NULL OR p_role = 'All' OR u.role = p_role)
    ),
    pur AS (
        SELECT p.amount, p.payment_method, p.is_agent_package
        FROM public.purchases p
        LEFT JOIN public.customers c ON c.id = p.customer_id
        LEFT JOIN public.users u ON u.id = COALESCE(p.agent_id, c.responsible_agent_id)
        WHERE p.date BETWEEN p_from AND p_to
          AND (public.report_scope_ids(p_agent_ids) IS NULL
               OR COALESCE(p.agent_id, c.responsible_agent_id) = ANY(public.report_scope_ids(p_agent_ids)))
          AND (p_role IS NULL OR p_role = 'All' OR u.role = p_role)
    )
    SELECT jsonb_build_object(
        'cps_count',     (SELECT COUNT(*) FROM act WHERE activity_type = 'CPS'),
        'total_meetings',(SELECT COUNT(*) FROM act WHERE activity_type IN ('EVENT','AGENT_MEETING')),
        'total_sales',   (SELECT COALESCE(SUM(amount),0) FROM pur WHERE COALESCE(is_agent_package,false) = false),
        'pop_count',     (SELECT COUNT(*) FROM pur WHERE payment_method = 'POP'),
        'pop_sales',     (SELECT COALESCE(SUM(amount),0) FROM pur WHERE payment_method = 'POP'),
        'epp_count',     (SELECT COUNT(*) FROM pur WHERE payment_method = 'EPP'),
        'epp_sales',     (SELECT COALESCE(SUM(amount),0) FROM pur WHERE payment_method = 'EPP'),
        'new_agents', (
            SELECT COUNT(*)
            FROM public.users u
            WHERE u.join_date BETWEEN p_from AND p_to
              AND (public.report_scope_ids(p_agent_ids) IS NULL OR u.id = ANY(public.report_scope_ids(p_agent_ids)))
              AND (p_role IS NULL OR p_role = 'All' OR u.role = p_role)
              AND (
                  (p_role IS NOT NULL AND p_role <> 'All')
                  OR public._role_to_level(u.role) between 3 and 12
              )
        ),
        -- new_customers counts CUSTOMERS, not sales — stays on the live owner.
        'new_customers', (
            SELECT COUNT(*)
            FROM public.customers c
            WHERE c.customer_since BETWEEN p_from AND p_to
              AND (public.report_scope_ids(p_agent_ids) IS NULL OR c.responsible_agent_id = ANY(public.report_scope_ids(p_agent_ids)))
              AND EXISTS (
                  SELECT 1 FROM public.purchases p
                  WHERE p.customer_id = c.id
                    AND p.date BETWEEN p_from AND p_to
              )
        )
    );
$function$;

notify pgrst, 'reload schema';
