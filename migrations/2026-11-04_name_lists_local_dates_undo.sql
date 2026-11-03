-- Rollback for migrations/2026-11-04_name_lists_local_dates.sql (back to UTC days).
alter function public.name_list_create(jsonb) reset timezone;
alter function public.name_list_regenerate(bigint) reset timezone;
alter function public.name_list_set(bigint, jsonb) reset timezone;
alter function public.name_list_index() reset timezone;
alter function public.name_list_get(bigint, int) reset timezone;
alter function public.name_list_decide(bigint, text, text, text) reset timezone;
alter function public.name_list_add(bigint, bigint, bigint, text, boolean) reset timezone;
alter function public.name_list_step(bigint, text, text) reset timezone;
alter function public.nl_generate(bigint, bigint) reset timezone;
alter function public.nl_next_step(bigint, bigint, text, jsonb) reset timezone;
alter function public.nl_claim_sales() reset timezone;
alter function public.nl_live(bigint, bigint) reset timezone;
alter function public.nl_counts(bigint, bigint, boolean) reset timezone;
