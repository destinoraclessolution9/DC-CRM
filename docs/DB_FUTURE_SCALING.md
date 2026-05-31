# Database — future scaling playbook

**Status:** design only — apply when scale triggers are met (see thresholds below)
**Created:** 2026-05-31
**Source:** Tier B from 20-suggestion perf plan

## When does this kick in?

Today's diagnostic (pg_stat_statements + pg_stat_user_tables on 2026-05-31)
shows the database is well-tuned for the current scale:

- No app queries in top-20 by total exec time
- Most pain is Supabase infrastructure (WAL 52%, pg_net, PostgREST), not app code
- Hottest app RPC: `compute_refill_reminders()` at 0.15% of total DB time
- Largest user table: `prospects` at 16 MB

This playbook describes the **next two architectural moves** to apply when
the CRM crosses these triggers — not before. Applying them early adds
complexity without payoff.

| Trigger | What to apply |
|---|---|
| `activities` table > **1M rows** OR > **500 MB** | Time-partition by month (Section 1) |
| `audit_logs` > **1M rows** OR > **500 MB** | Time-partition by month + BRIN index (Section 1 + 2) |
| Any append-only table > **5M rows** | Switch its date index from B-tree to BRIN (Section 2) |
| Specific report query consistently >2s after Tier A tuning | Materialized view (Section 3) |

Track current sizes weekly with:

```sql
SELECT relname, pg_size_pretty(pg_total_relation_size('public.'||relname)) AS size,
       n_live_tup AS rows
FROM pg_stat_user_tables
WHERE schemaname='public' AND n_live_tup > 100000
ORDER BY pg_total_relation_size('public.'||relname) DESC;
```

---

## Section 1 — Time-partition `activities` and `audit_logs`

### Why

Both tables are append-mostly with date ordering. At >1M rows, a partition
table per month gives several wins:

1. **Faster index scans on recent data.** Postgres only opens the partitions
   that match the WHERE clause's date range. Reading "last 7 days" of
   activities walks one or two partition indexes, not the whole table.
2. **Cheaper VACUUM.** Each partition vacuums independently; the old static
   partitions don't churn at all.
3. **Trivial archival.** Drop old partitions instead of running a slow
   `DELETE WHERE date < ...` that holds a long lock and accumulates bloat.
4. **Smaller indexes per partition.** Index lookups are O(log n) on
   per-partition n, not total n.

### Approach: `pg_partman` extension

Supabase supports `pg_partman` (range partition manager). It automates
partition creation + retention.

```sql
-- 1. Enable extension (one-time)
CREATE EXTENSION IF NOT EXISTS pg_partman SCHEMA partman;

-- 2. Convert activities to a partitioned table.
-- Step 2a: rename the current table.
ALTER TABLE public.activities RENAME TO activities_legacy;

-- Step 2b: create a new partitioned table with the same schema.
CREATE TABLE public.activities (
  -- copy column list from activities_legacy verbatim
  LIKE public.activities_legacy INCLUDING ALL
) PARTITION BY RANGE (activity_date);

-- Step 2c: register with pg_partman for monthly partitions.
SELECT partman.create_parent(
  p_parent_table => 'public.activities',
  p_control => 'activity_date',
  p_type => 'native',
  p_interval => '1 month',
  p_premake => 4   -- pre-create 4 months ahead
);

-- Step 2d: copy old data into the partitioned table.
INSERT INTO public.activities
SELECT * FROM public.activities_legacy;

-- Step 2e: re-attach all indexes, triggers, foreign keys from legacy.
-- (Postgres partition inheritance does NOT copy indexes automatically.)

-- Step 2f: drop the legacy table after verifying counts match.
DROP TABLE public.activities_legacy;
```

### Migration safety notes

- Run during a maintenance window (writers must pause during the rename +
  copy). Estimate: ~1 min per 100K rows.
- Test on a staging clone first to validate the index/FK/trigger re-attach.
- All RLS policies must be reapplied to the new partitioned parent table.
- Set `pg_partman` retention via `partman.run_maintenance()` on a daily cron
  — automatically drops partitions older than the retention window.

### Retention policy suggestions

| Table | Keep in hot partitions | Move to cold storage |
|---|---|---|
| `activities` | 24 months | Older partitions → S3 / archive_activities table |
| `audit_logs` | 12 months | Older partitions → S3 (compliance retention required separately) |

---

## Section 2 — BRIN indexes for large date-ordered tables

### Why

Once a date-ordered append-only table crosses ~5M rows, a B-tree index on
the date column becomes large (hundreds of MB) but is used inefficiently —
the index leaf pages mostly mirror physical row order anyway.

**BRIN (Block Range INdex)** stores min/max date per ~128 contiguous heap
pages instead of one entry per row. For sequentially-inserted data, BRIN
indexes are typically **100× smaller** than B-tree and **scan slightly
slower per query but with much better cache locality.**

### When to use BRIN

- Append-only or mostly-append (low UPDATE/DELETE on indexed column).
- Query pattern is range scans on the indexed column (`WHERE date >= X`).
- Table is large enough that index size matters (>5M rows or >5GB).

### Apply

```sql
-- For activities.activity_date (when activities crosses 5M rows):
CREATE INDEX CONCURRENTLY idx_activities_date_brin
    ON public.activities USING BRIN (activity_date)
    WITH (pages_per_range = 32);

-- Then drop the B-tree variant if it exists:
-- DROP INDEX CONCURRENTLY IF EXISTS idx_activities_date;
```

`pages_per_range = 32` (default 128) gives tighter ranges → slightly larger
index but better query selectivity. Tune based on EXPLAIN ANALYZE.

### When NOT to use BRIN

- Hash-distributed data (BRIN summarizes contiguous pages; out-of-order
  data defeats it).
- Frequently-updated indexed column (BRIN ranges become loose, lookup
  degrades).
- Equality lookups (B-tree wins).

---

## Section 3 — Materialized views for slow reports

### Why

If a specific dashboard or report query consistently takes >2s after all
Tier A tuning, a materialized view pre-computes the result. Reads are then
O(1) lookup; the materialization cost moves to a scheduled refresh.

### Identifying candidates

Run pg_stat_statements quarterly:

```sql
SELECT substring(query, 1, 200), mean_exec_time, calls
FROM pg_stat_statements
WHERE query NOT LIKE '%pg_%'
  AND mean_exec_time > 2000   -- ms
ORDER BY mean_exec_time DESC LIMIT 10;
```

Each row that returns is a materialized-view candidate.

### Example pattern

If `get_referral_leaderboard('all')` becomes slow at scale:

```sql
CREATE MATERIALIZED VIEW public.mv_referral_leaderboard AS
SELECT * FROM public.get_referral_leaderboard('all')
WITH DATA;

CREATE UNIQUE INDEX ON public.mv_referral_leaderboard (referrer_id, referrer_type);

-- Refresh nightly via pg_cron:
SELECT cron.schedule('refresh-referral-leaderboard', '0 2 * * *',
  $$REFRESH MATERIALIZED VIEW CONCURRENTLY public.mv_referral_leaderboard$$);
```

`CONCURRENTLY` requires a unique index but lets readers see the old data
during the refresh.

Update the app to call the view instead of the RPC:

```js
// Before: await sb.rpc('get_referral_leaderboard', { p_period: 'all' });
// After:  await sb.from('mv_referral_leaderboard').select('*');
```

The RPC still exists for `p_period='month'` / `'year'` which are smaller
aggregations not worth materializing.

---

## Read replicas (Supabase Pro feature)

Not in this playbook because:
- Reporting workload today does not compete with transactional writes
  (verified by pg_stat_statements — no slow report queries)
- Adds eventual-consistency complexity (reads from replica may be stale
  by seconds)
- The `data.js` cache layer already absorbs most reporting reads

Revisit when one of:
- Transactional p99 latency rises above 200 ms due to report contention
- A long-running report blocks writes for >5 s
