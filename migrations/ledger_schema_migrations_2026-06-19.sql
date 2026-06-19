-- =====================================================================
-- MIGRATION LEDGER — public.schema_migrations
-- Date: 2026-06-19
--
-- WHAT THIS IS
--   A tiny applied-ledger table that records which migrations/*.sql files
--   have already been run against this database. The CRM has NO automated
--   migration runner: DDL is applied BY HAND through the Supabase dashboard
--   (the project's security rule forbids using the Supabase PAT on the CLI
--   for DDL). Until now the only record of "what's applied" was git history
--   plus the naming convention — this table makes that record explicit and
--   queryable, and lets ci/test-migration-ledger.js detect tampering offline.
--
-- WHY
--   Manual-apply discipline: without a ledger, nothing distinguishes an
--   already-applied migration from a pending one except memory. The ledger
--   is the durable, in-database source of truth for apply state.
--
-- HOW TO USE IT GOING FORWARD
--   After you apply a NEW migration via the dashboard SQL Editor:
--     1. In that same SQL Editor session, append an INSERT row recording the
--        filename + its sha256 (and run it):
--          insert into public.schema_migrations (filename, sha256) values
--            ('your_new_migration_YYYY-MM-DD.sql', '<sha256 of the file>')
--          on conflict (filename) do nothing;
--     2. Commit the migration .sql AND add the same filename to the backfill
--        block below so the CI ledger check stays green.
--   Compute the sha256 with:  sha256sum migrations/your_new_migration.sql
--   (sha256 is advisory — it lets you spot when a recorded file's bytes drift
--   from what was applied; the CI check keys on filename, not hash.)
--
-- This whole file is IDEMPOTENT — re-running it is a safe no-op.
-- =====================================================================

-- ---------- ledger table ----------
create table if not exists public.schema_migrations (
  filename   text primary key,
  sha256     text,
  applied_at timestamptz not null default now()
);

comment on table public.schema_migrations is
  'Internal ops table: applied-migration ledger for the manual (dashboard) apply workflow. Not user-facing. service_role/postgres only.';

-- ---------- lock it down (internal ops table) ----------
-- RLS on with NO permissive policy => no anon/authenticated row reaches it;
-- only service_role / postgres (which bypass RLS) can touch the ledger.
alter table public.schema_migrations enable row level security;
revoke all on public.schema_migrations from anon, authenticated;

-- ---------- backfill: rows for every ALREADY-APPLIED migration ----------
-- "Already applied" = every migrations/*.sql EXCEPT: the README "Currently
-- pending" files, any DRAFT/FUTURE/TEMPLATE/_PLAN file, and this ledger file.
-- applied_at is a fixed deterministic baseline (these were applied before the
-- ledger existed, so the real timestamps are unknown).
insert into public.schema_migrations (filename, sha256, applied_at) values
  ('add_event_poster_2026-05-28.sql', '6298d4f716a3a2496c3160568df4ce8020f4bfec79daff106033fddebb60f84b', '2026-06-19T00:00:00Z'),
  ('add_healthcare_refill_reminders.sql', 'b76a502baf638a78942c149575f36a40925c4d2f94b4beb6280d0a1b813220b7', '2026-06-19T00:00:00Z'),
  ('add_notification_preferences.sql', '803d69c7e33bb06f3731464d7bd81af3e30a296ed760b33c5c7a149b35239a8e', '2026-06-19T00:00:00Z'),
  ('add_product_dimension_weight.sql', '8a05fb46487c2823fd90499c2b30ae18df9952355ff8f3be9bc7a281a7514778', '2026-06-19T00:00:00Z'),
  ('agent_sales_by_period_2026-06-14.sql', '8c15168f179dcc32679ce6db5e416b0c362fe4bf7d46dff28b2e43193f1b9126', '2026-06-19T00:00:00Z'),
  ('aggregation_rpcs_2026-05-03.sql', '1e874bcace1db940789a269b55ab8bfefc9f015335c85106d65daf23191c8372', '2026-06-19T00:00:00Z'),
  ('attachment_urls_to_paths_backfill_2026-04-24.sql', '6a6f78ac4c488120c7c50509260338edaed0197fb47e2ccb354e2af966dc6c2e', '2026-06-19T00:00:00Z'),
  ('attachments_bucket_private_2026-04-24.sql', '1806701e18de4784f4f7a04019703e14895925bd2609811d9fe39c76c2c6a392', '2026-06-19T00:00:00Z'),
  ('autovacuum_tuning_2026-05-31.sql', 'f1bcbee8802d4d9c81dd72fd6761bccd797fb853b27a9985a18438d53a739bd4', '2026-06-19T00:00:00Z'),
  ('bff_visible_agent_ids_2026-06-14.sql', '23a68efe0fecdbc2e3f84d587f0819351f019db746b20058bd59881c73781547', '2026-06-19T00:00:00Z'),
  ('calendar_coalesce_event_title_2026-05-04.sql', 'ec9f2b0a8a1c4a4d3bb2f8226fb05ec36d891229448a08ab2c481b2c599936a3', '2026-06-19T00:00:00Z'),
  ('calendar_dashboard_rpc_2026-05-31.sql', '46a9fd843af9669db7743c27e85f74340da075adb2d852a01619dc58a3c753e2', '2026-06-19T00:00:00Z'),
  ('calendar_perf_2026-05-03.sql', '94573e238b3ca74a508d028dbfb19b82b017d8665a0b253d9723876f06638667', '2026-06-19T00:00:00Z'),
  ('cascade_delete_prospect_fkeys_2026-05-01.sql', '8f64bc82fce65aa082acfdc4a29458260a2504032399dbd67372cf87247ed64a', '2026-06-19T00:00:00Z'),
  ('configurable_follow_up_triggers.sql', 'b90dcac8de5cad85d090e6538943f1a61b7cb445523ef09929200c17c994d1ab', '2026-06-19T00:00:00Z'),
  ('cps_intake_requests.sql', '9869a4b1e9bd089c80124ae93a20e38a399173b410090707d1aea5bc1afa7a2b', '2026-06-19T00:00:00Z'),
  ('customer_forms_2026-05-30.sql', 'd31c25033cd5b17ef0288531a0aae0bba9aedaed203548cbb085b74b404f6b44', '2026-06-19T00:00:00Z'),
  ('destiny_blueprints_2026-05-31.sql', 'cf0c70fd8785ee16ba589616a746bfdcd2ca1a32a86cec7abd6af52df4a9cd0f', '2026-06-19T00:00:00Z'),
  ('drop_redundant_indexes_2026-05-31.sql', '6d6a2af4c7870e425028cc492de0c9f249ed0b7c0b072dc5a823ce7565ce82ee', '2026-06-19T00:00:00Z'),
  ('email_dedup_2026-04-24.sql', 'f79cda4433d1ac25229c1d4cae719488923e515530b154185fdde626dfce5e73', '2026-06-19T00:00:00Z'),
  ('grant_data_api_access_2026-05-16.sql', '9ca4f74c57f719ab43137dd693dc533b91c7401c5533038f13e45af59c7fa7f4', '2026-06-19T00:00:00Z'),
  ('import_existing_matches_2026-06-14.sql', 'f767e75abae969a650312a6423596621210901fe27e9c13f6d9c88adcd371d03', '2026-06-19T00:00:00Z'),
  ('include_columns_2026-05-31.sql', '21b81232f9d1833821a122ca9312507a750e98be53edda85fcaf84e3a509bcb1', '2026-06-19T00:00:00Z'),
  ('include_columns_refine_2026-06-01.sql', '1639a29baf1ad9127335e452d55ca16c565900d90c545b5ef11eaeb7a0cb5b46', '2026-06-19T00:00:00Z'),
  ('knowledge_hub_2026-05-09.sql', '0cb93e806a68970916db223cf980f44cc4a9bbf4ea7879e1a2fea2873c3a15ac', '2026-06-19T00:00:00Z'),
  ('kpi_extended_summary_2026-06-14.sql', 'b46900adb5c1d38f6df240d947455ea24ef904cce56beeadef52384e42021a2d', '2026-06-19T00:00:00Z'),
  ('long_term_integrity_2026-04-24.sql', 'b27e7fce495aaed2acbb1ccdb86613a9624837377647cd9fdd47c2a32aafa1db', '2026-06-19T00:00:00Z'),
  ('order_form_attachments.sql', '8b83019882d9cc6cafa436e0fe769f022cad1f3ba6e42a6ceaee8abcc64f9441', '2026-06-19T00:00:00Z'),
  ('perf_indexes_2026-05-26.sql', 'bbf35fadc854a7118fb0c6e8f5f5410b2d4a8a8ccac80089643290a55b8cdd79', '2026-06-19T00:00:00Z'),
  ('perf_indexes_supplemental_2026-05-30.sql', '14d6a5d7da4c1b7295e9acb2d4cb643881a840a033455703c869a4d757ee03ac', '2026-06-19T00:00:00Z'),
  ('pg_extensions_advisory_2026-06-01.sql', '2339f5808a073d475a4d606c0e2b6b0940cba2fbcea9bc64be7e1760422928a0', '2026-06-19T00:00:00Z'),
  ('phone_unique_constraint.sql', '7429b35c3cd4079fd03a2ae18be74df34aefebbd72ce22879ac3d482fdc67f50', '2026-06-19T00:00:00Z'),
  ('product_photos_and_price_history.sql', '69a05178c0a46636b8accd09112b708e6f2c0fe939aaafdb063c7604a0aac453', '2026-06-19T00:00:00Z'),
  ('prospects_page_rpc_2026-06-14.sql', 'a2748b5956f7bb908535a1f5ca81713b2da7df6f1920e9c1668dc08a5329d4c3', '2026-06-19T00:00:00Z'),
  ('realtime_publication_2026-05-03.sql', 'bd993d42482d5acc7f5fab45fe843f2127832353e2915b5dafdf88f96424f50d', '2026-06-19T00:00:00Z'),
  ('realtime_publication_extend_2026-05-31.sql', '3e7838163d3ac8faa3afe0b5a1819d417a637178f4c454dbdfa90a512ff6085f', '2026-06-19T00:00:00Z'),
  ('report_activity_details_2026-06-14.sql', '2d6270e22d68a58464f8b5079d975fe7eb3ac274378820248b0a470bad1e722b', '2026-06-19T00:00:00Z'),
  ('report_purchase_details_2026-06-14.sql', '9f01f8c1dfa17795f08383a5d9d03969fdc8421a571fb32e8b7bd4d55b5527b6', '2026-06-19T00:00:00Z'),
  ('report_tail_rpcs_2026-06-14.sql', '6b5ea73db6f87ba69d1f9789c0e79f49a5d5fcac999ccd043de2cb28f89f17d3', '2026-06-19T00:00:00Z'),
  ('report_target_overview_rpcs_2026-06-14.sql', '6a02ea031cae4b7c18d7d5e3bf62d576decfc7f90b9e17e199b0b60404d454f7', '2026-06-19T00:00:00Z'),
  ('rls_helpers.sql', 'da20fcd9252d5837bd38e851a1a60e28e5bfecae789d054ea69e4de2389fab0c', '2026-06-19T00:00:00Z'),
  ('rls_replace_allow_all_2026-04-24.sql', '5e547c0fc13b3bd85a9e387a70a2bf517134544981b4f5ac48bb980f23b4b91d', '2026-06-19T00:00:00Z'),
  ('rls_restrictive_delete_policies.sql', 'da56bdd23dcaa47fe5785fd125cc43652d4fb11e8c8ab3025b699c7e3cba8144', '2026-06-19T00:00:00Z'),
  ('rls_select_scoping_APPLIED_2026-06-18.sql', '8547c98c35e3392d2c4ceecc830adde35639b499992da2c49e2a2315212bb8b9', '2026-06-19T00:00:00Z'),
  ('role_level_2026-06-14.sql', 'e1501f656c3bc655d463c99a82bff2623bc1669a267a5a5808b1fcdc75e86a5b', '2026-06-19T00:00:00Z'),
  ('scale_30k_1k_2026-04-25.sql', '4761597ef655d9c486b9475e6a3eb2dd878d68b7975ca5034827f2a8b3264c8f', '2026-06-19T00:00:00Z'),
  ('scale_readiness_indexes_and_dormancy.sql', '74b1485bd6d9d4572a69eb098da7253fc41abc52a5ef090044c11cbf17011501', '2026-06-19T00:00:00Z'),
  ('score_history_and_follow_up_drafts_2026-05-02.sql', 'bf4fd1614f2dee2b8caadf3979828dd218bb5fd3533688504622c0725de05f92', '2026-06-19T00:00:00Z'),
  ('sec_2026-06-19_anon_revoke.sql', 'd66af55f66189c3e1c2a55681e23697af03962a3c8c734d8818eb70c57c8792a', '2026-06-19T00:00:00Z'),
  ('sec_2026-06-19_cps_intake.sql', 'd46a8ef55ce6ec9460c5b0e0b7d4b1362a65f96a00b9f4dd94c9825cc9402865', '2026-06-19T00:00:00Z'),
  ('sec_2026-06-19_cps_revoke.sql', 'ac3d3bf230964dcafa6e7a08e173ffac756eee917662d60b684b96788a058700', '2026-06-19T00:00:00Z'),
  ('sec_2026-06-19_drop_password.sql', '4467c4ab813188ce81f2502b32ae0b2951aa46e9781aecfa8981d7bfce95da07', '2026-06-19T00:00:00Z'),
  ('sec_2026-06-19_functions.sql', 'e8fe7af4dba75763aff6cb8b1122337f527526dae7a59dda89f642a8295148f7', '2026-06-19T00:00:00Z'),
  ('sec_2026-06-19_import_scope.sql', '62174b19eea676583283af7fee2b1741a4bb89f06279d622a956a0b8421275ae', '2026-06-19T00:00:00Z'),
  ('sec_2026-06-19_pii_tables.sql', 'afe3531371917474f55b4aff5deeabdbb15bdbd58d253a264f6d65d541674afe', '2026-06-19T00:00:00Z'),
  ('sec_2026-06-19_writes.sql', '920cb866b1ad215aaeba9c23c16fa6fb06d692633eb0eb5a9b2e5ff3411ba75d', '2026-06-19T00:00:00Z'),
  ('secure_attachments_bucket_2026-04-24.sql', '9f8aea47f0f89cf7adb83c0ab18aec76bc29ea5ada6bc4c8bce91c6cbe6ef307', '2026-06-19T00:00:00Z'),
  ('security_hardening_2026-05-03.sql', 'cb50daf8018365f3ba5f367f2196213350feed00025e60166ffce5c22e724946', '2026-06-19T00:00:00Z'),
  ('server_cron_2026-05-03.sql', '0f7082a299bc45719c1cfbbaf1c846ab55f950c7604b4ce265002cbfa8c86eb5', '2026-06-19T00:00:00Z'),
  ('stock_take_v2_2026-05-30.sql', 'ecebda56fa28ce96d73012139d9d23e61f96a171e1a0c3c8b6df3833609b8378', '2026-06-19T00:00:00Z'),
  ('stock_take_v2_staff_role_2026-05-30.sql', '78a137dcd4afb0e6f0f81a13b313a0e14011d2717383477ccb433e728f72fb24', '2026-06-19T00:00:00Z'),
  ('tighten_user_preferences_rls_2026-04-24.sql', 'b2b84d436813c0141da4666831afe00fa9fd516bebc6ef8c793d8a826925c2d0', '2026-06-19T00:00:00Z'),
  ('report_rpc_scope_clamp_2026-06-19.sql', '9e54be93a3287dd2c37310b205eb756a38182da8599041dd5591a8a466e1de73', '2026-06-19T00:00:00Z'),
  ('adjust_customer_ltv_2026-06-19.sql', '4cd68764413dc9ad6c3c6f898dba63026df8064f7d53738791b887a8b70f1b04', '2026-06-19T00:00:00Z')
on conflict (filename) do nothing;

-- ---------- verify ----------
-- Expected count after backfill on a fresh ledger: 64
select count(*) from public.schema_migrations;
