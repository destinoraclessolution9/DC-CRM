-- =====================================================================
-- NPO sale-table RLS: replace the launch-day authenticated-R/W policies with
-- per-row scoping that MATCHES the app's visibility exactly.
-- Date: 2026-06-24
--
-- npo_feature_2026-06-24.sql shipped npo_sales/items/installments with
-- `for all to authenticated using (true)` (scope enforced app-side only). This
-- tightens them server-side. The npo tables are brand-new (empty), so changing
-- the policies has no data impact.
--
-- Scope source = public.bff_visible_agent_ids(auth.uid()) — the SAME function the
-- BFF / client getVisibleUserIds use (role_level + team_id + reporting tree):
--   NULL  -> unrestricted (super admin / marketing manager, level <= 2)
--   [ids] -> own + downline within team (3..11) or own only (>= 12)
--   [empty] -> unknown caller -> sees nothing
-- Using this (not the generic current_user_visible_ids, which mis-scopes L11 and
-- ignores team_id) keeps RLS aligned with the app so no legitimate manager view
-- is blocked. sale_items / installments inherit scope transitively via npo_sales
-- (the subquery is itself RLS-filtered for the caller).
-- =====================================================================

begin;

drop policy if exists npo_sales_rw on public.npo_sales;
drop policy if exists npo_items_rw on public.npo_sale_items;
drop policy if exists npo_inst_rw  on public.npo_installments;

create policy npo_sales_scoped on public.npo_sales
  for all to authenticated
  using (
    public.bff_visible_agent_ids(auth.uid()) is null
    or responsible_agent_id = any(public.bff_visible_agent_ids(auth.uid()))
  )
  with check (
    public.bff_visible_agent_ids(auth.uid()) is null
    or responsible_agent_id = any(public.bff_visible_agent_ids(auth.uid()))
  );

create policy npo_items_scoped on public.npo_sale_items
  for all to authenticated
  using      (sale_id in (select id from public.npo_sales))
  with check (sale_id in (select id from public.npo_sales));

create policy npo_inst_scoped on public.npo_installments
  for all to authenticated
  using      (sale_id in (select id from public.npo_sales))
  with check (sale_id in (select id from public.npo_sales));

commit;

-- VERIFY AFTER APPLY:
--   select tablename, policyname from pg_policies
--   where schemaname='public' and tablename like 'npo_%' order by 1,2;
--   -- npo_sales -> npo_sales_scoped; items -> npo_items_scoped; inst -> npo_inst_scoped
--   -- (plus the config-table read/admin policies from the first migration)
