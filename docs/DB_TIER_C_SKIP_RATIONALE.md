# DB Tier C — explicitly NOT applied, with rationale

**Date:** 2026-05-31
**Context:** After today's pg_stat_statements + pg_stat_user_tables review,
these techniques were considered and consciously skipped. Documented here so
future you (or another Claude session) doesn't re-litigate the decisions.

| # | Technique | Why skipped |
|---|---|---|
| 1 | Generated columns for pre-computed values | The hot pre-computed fields (`updated_at`, `last_activity_date`) are already trigger-maintained. Adding GENERATED columns elsewhere would either duplicate trigger work or pick fields that aren't read enough to matter. |
| 2 | Hash indexes for equality-only lookups | B-tree handles equality fine in modern Postgres (since v10 hash indexes are WAL-logged and crash-safe, but B-tree is still preferred). The marginal size win doesn't justify the operational quirks. |
| 3 | `SET STATISTICS 1000` on hot columns | Only useful when EXPLAIN ANALYZE shows the planner is picking bad plans due to histogram resolution. No evidence of that — today's slow-query review showed all RPCs and queries running at expected cost. Revisit if EXPLAIN ANALYZE on a specific slow query shows `rows=` estimates off by >10×. |
| 4 | JIT compilation tuning | Default thresholds (`jit_above_cost = 100000`) are fine. JIT helps long analytical queries; this codebase is OLTP. No measured JIT pain. |
| 5 | TOAST storage strategy (EXTERNAL/EXTENDED) on JSONB columns | Postgres default (`EXTENDED`) is correct for our JSONB columns. `EXTERNAL` (no compression) would only help if we were doing partial-update reads through `->>` heavily, which we're not. |
| 6 | `PREPARE` statement caching | PostgREST (Supabase's API layer) already prepares all generated SQL internally. Manually adding PREPARE in app code would be redundant and brittle. |
| 7 | Connection-pool mode swap | Supabase's default pooler is already transaction-mode on port 6543, which is the right mode for SPA. Session-mode (5432) is reserved for migrations + LISTEN/NOTIFY. Verified default is correct. |

## Trigger to revisit

Re-evaluate these annually OR when:
- The CRM database doubles in size
- A specific report or query consistently exceeds 1s in pg_stat_statements
- Postgres major-version upgrade changes any of the underlying defaults

## Decision log philosophy

Premature optimization in DB tuning is expensive: each tuned knob increases
operational surface (must be remembered, must survive restores, must be
re-applied to staging). Default Postgres + targeted indexes + thoughtful
schema beats a kitchen sink of knobs nearly every time.

These Tier C items will earn their complexity when the workload demands
them. Today's workload doesn't.
