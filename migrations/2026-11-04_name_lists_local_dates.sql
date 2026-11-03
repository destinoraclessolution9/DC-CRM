-- Name lists: count days in Malaysia time, not UTC.
-- The database runs in UTC, so `at::date` on a step logged at 01:10 on 4 Nov
-- (Malaysia) gave 3 Nov — the row read "Called 3 Nov", the list's start day,
-- "met" day and "contact before the sale" check all slipped a day for anything
-- done before 8 am. Running these functions in Asia/Kuala_Lumpur (the same
-- clock as journey_today()) makes every ::date local and every timestamp the
-- page receives carry +08:00.
alter function public.name_list_create(jsonb) set timezone to 'Asia/Kuala_Lumpur';
alter function public.name_list_regenerate(bigint) set timezone to 'Asia/Kuala_Lumpur';
alter function public.name_list_set(bigint, jsonb) set timezone to 'Asia/Kuala_Lumpur';
alter function public.name_list_index() set timezone to 'Asia/Kuala_Lumpur';
alter function public.name_list_get(bigint, int) set timezone to 'Asia/Kuala_Lumpur';
alter function public.name_list_decide(bigint, text, text, text) set timezone to 'Asia/Kuala_Lumpur';
alter function public.name_list_add(bigint, bigint, bigint, text, boolean) set timezone to 'Asia/Kuala_Lumpur';
alter function public.name_list_step(bigint, text, text) set timezone to 'Asia/Kuala_Lumpur';
alter function public.nl_generate(bigint, bigint) set timezone to 'Asia/Kuala_Lumpur';
alter function public.nl_next_step(bigint, bigint, text, jsonb) set timezone to 'Asia/Kuala_Lumpur';
alter function public.nl_claim_sales() set timezone to 'Asia/Kuala_Lumpur';
alter function public.nl_live(bigint, bigint) set timezone to 'Asia/Kuala_Lumpur';
alter function public.nl_counts(bigint, bigint, boolean) set timezone to 'Asia/Kuala_Lumpur';
