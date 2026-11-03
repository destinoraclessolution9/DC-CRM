-- Rollback for migrations/2026-11-03_name_lists.sql.
-- ⚠ Drops every saved list, its versions, the contact log and the sale links.
-- The do_not_invite switch itself is untouched (only its stamp columns go).
drop function if exists public.name_list_step(bigint, text, text);
drop function if exists public.name_list_add(bigint, bigint, bigint, text, boolean);
drop function if exists public.name_list_decide(bigint, text, text, text);
drop function if exists public.name_list_get(bigint, int);
drop function if exists public.name_list_index();
drop function if exists public.name_list_set(bigint, jsonb);
drop function if exists public.name_list_regenerate(bigint);
drop function if exists public.name_list_create(jsonb);
drop function if exists public.nl_counts(bigint, bigint, boolean);
drop function if exists public.nl_live(bigint, bigint);
drop function if exists public.nl_claim_sales();
drop function if exists public.nl_generate(bigint, bigint);
drop function if exists public.nl_next_step(bigint, bigint, text, jsonb);
drop function if exists public.nl_latest_version(bigint);
drop function if exists public.nl_has_team();
drop function if exists public.nl_can_act(bigint);
drop function if exists public.nl_can_manage(bigint);
drop function if exists public.nl_can_see(bigint);
drop function if exists public.nl_person_blocked(text);
drop function if exists public.nl_team_ids(bigint);
drop function if exists public.nl_cfg();

drop trigger if exists prospects_dni_stamp on public.prospects;
drop trigger if exists customers_dni_stamp on public.customers;
drop function if exists public.nl_dni_stamp();
alter table public.prospects drop column if exists do_not_invite_at;
alter table public.prospects drop column if exists do_not_invite_by;
alter table public.customers drop column if exists do_not_invite_at;
alter table public.customers drop column if exists do_not_invite_by;

drop table if exists public.name_list_sales;
drop table if exists public.name_list_steps;
drop table if exists public.name_list_rows;
drop table if exists public.name_list_versions;
drop table if exists public.name_lists;
drop function if exists public.nl_steps_guard();
drop function if exists public.nl_rows_guard();
delete from public.invite_config where key = 'name_list';
