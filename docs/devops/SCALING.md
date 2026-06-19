# Scaling Playbook

How this stack grows — a static SPA on Vercel's edge CDN in front of Supabase
(Postgres + PostgREST + GoTrue). The frontend scales for free; **every real scaling
question is a database question.** Order the levers by impact and stop pulling once the
metrics are green — don't pre-optimize past the row counts we actually have.

Cross-links: owner switches in [OWNER_ACTION_CHECKLIST.md](./OWNER_ACTION_CHECKLIST.md),
alert thresholds in [MONITORING.md](./MONITORING.md), stack reality in
[DEVOPS_PLAN.md](./DEVOPS_PLAN.md). Prior perf groundwork: [`PERF_SCALE_PLAN.md`](../../PERF_SCALE_PLAN.md).

---

## 1. The one lever that matters most — compute tier

Compute is on the **NANO** tier. NANO is the documented root cause of the HTTP `521`
outages (origin unreachable under load) and it **auto-reverts unless the org is billed
Pro + Cost-Control**. Upgrading **NANO → Small/Medium is the single highest-impact
reliability + scale action available** — it raises the connection ceiling, CPU, and RAM
that everything else here is bottlenecked behind. Do this *first*; the rest is tuning at
the margins by comparison.

→ Owner action: [OWNER_ACTION_CHECKLIST.md](./OWNER_ACTION_CHECKLIST.md) **P5** (and confirm
Pro + Cost-Control so the tier sticks). Health probe to confirm the backend is up:
`POST /auth/v1/token` → **400 = up**, **521 = down**.

---

## 2. Connection management

There is **no app-side connection pool to tune.** The BFF (`api/customers.mjs`,
`api/prospects.mjs`) talks to **PostgREST over HTTP** (`/rest/v1/...`, `/auth/v1/...`,
`/rest/v1/rpc/...`) with the service key — it never opens a direct Postgres socket, so
there is no pg connection string, no client pool size, nothing to size in code.
PostgREST pools to Postgres **server-side**, inside Supabase.

| Client type | Path to Postgres | Pooling |
|---|---|---|
| In-app BFF (`api/*.mjs`) | PostgREST / HTTP (`/rest/v1`) | server-side, automatic — nothing to configure |
| External direct-pg (psql, migrations, BI, scripts) | Postgres wire protocol | **Supavisor** transaction pooler, port `6543` |

So **Supavisor (port 6543) is for external direct-pg clients only** — it does nothing for
the in-app traffic, which is already pooled. The metric that actually matters is
**active connections vs the tier's ceiling**: on NANO that ceiling is low, and
`connections > 80% of pool` is the NANO killer behind the past 521s
(see [MONITORING.md](./MONITORING.md)). Watching it is the job; §1 raises it.

---

## 3. Read scaling — order of operations

Pull these in order; most are already done.

| # | Lever | Status |
|---|---|---|
| a | **Right-size compute** (§1) | owner — the lever |
| b | **Indexes** on hot predicates / sort keys | ✅ done — see below |
| c | **Date-windowed / bounded reads** (no unbounded full-table scans) | ✅ done — see below |
| d | **Read replicas** (Supabase add-on) | future / owner |

- **(b) Indexes** — landed across `migrations/perf_indexes_2026-05-26.sql`,
  `perf_indexes_supplemental_2026-05-30.sql`, `scale_readiness_indexes_and_dormancy.sql`,
  plus covering columns in `include_columns_2026-05-31.sql`. Tracked in
  [`PERF_SCALE_PLAN.md`](../../PERF_SCALE_PLAN.md).
- **(c) Bounded reads** — `_getAllImpl` refuses unbounded high-volume reads; reporting
  uses date-windowed KPI RPCs and bounded readers (`getActivitiesInRange` etc.) instead of
  whole-table scans. Phase B of [`PERF_SCALE_PLAN.md`](../../PERF_SCALE_PLAN.md), shipped.
- **(d) Read replicas** are a Supabase add-on for when **read** load (heavy reporting /
  analytics) outgrows a single primary. Not needed at current volume; revisit after §1.

(a)–(c) are largely done. (d) is future and owner-gated.

---

## 4. Pagination: offset → keyset (DEFERRED — with rationale)

The BFF paginates with **OFFSET** (`p_offset`, via `prospects_page` / the `offset` query
param). OFFSET asks Postgres to scan and discard `offset` rows before returning the page,
so cost grows with depth — fine on page 1, slow at deep scroll.

**Keyset (cursor) pagination is O(1) at any depth** — it seeks past the last row seen
instead of counting from the top. But it is **not** a drop-in:

1. **Needs a stable composite sort key** (e.g. `(full_name, id)`) — a non-unique sort
   column alone skips or duplicates rows at page boundaries.
2. **It is a coordinated FE + BFF contract change** — the cursor replaces the page number
   on both sides at once; a half-migrated client paginates wrong.
3. **Needs authed deep-scroll verification** — boundary correctness can't be proven
   headlessly; it requires a logged-in session paging to depth.

**At current row counts (hundreds to low thousands) OFFSET is fine** and degrades
imperceptibly. Recommendation: do keyset as a **separate, FE-coordinated, authed-verified
change** — **not a blind autopilot push.** This matches the project's own
"needs authed parity" note ([`PERF_SCALE_PLAN.md`](../../PERF_SCALE_PLAN.md) Phase C).

---

## 5. Write / storage scaling

Writes are not the current pressure point, but two levers are ready when row counts demand:

- **Table partitioning** — the largest **append-only** tables (`activities`, audit) are the
  natural partition candidates (range by month). It's owner/future work: partitioning is
  destructive DDL needing a maintenance window (gated in
  [`PERF_SCALE_PLAN.md`](../../PERF_SCALE_PLAN.md) Phase D, BACK-5). Don't pre-partition —
  do it when a single table's size/bloat starts costing query time.
- **Autovacuum** — already tuned for the high-churn tables in
  `migrations/autovacuum_tuning_2026-05-31.sql`, so dead-tuple bloat doesn't silently
  degrade reads before partitioning is ever needed.

---

## 6. Capacity monitoring — copy-paste SQL

Read-only snippets for the Supabase **SQL Editor**. Run periodically (or when an alert
fires) to see where the headroom is going.

**Table + index sizes** — find the tables driving storage and read cost:
```sql
SELECT relname AS table,
       pg_size_pretty(pg_total_relation_size(relid)) AS total
FROM pg_catalog.pg_statio_user_tables
ORDER BY pg_total_relation_size(relid) DESC
LIMIT 20;
```
*Look for:* the few tables dominating size — your partition (§5) and index (§3b) candidates.

**Top slow statements** — requires the `pg_stat_statements` extension enabled:
```sql
SELECT calls, round(mean_exec_time::numeric, 1) AS avg_ms,
       round(total_exec_time::numeric, 0) AS total_ms, query
FROM pg_stat_statements
ORDER BY total_exec_time DESC
LIMIT 20;
```
*Look for:* high `total_ms` (cumulative cost) and high `avg_ms` (per-call cost) — the
queries to index or bound. If this errors, enable the extension first.

**Current connections** — the NANO killer, watched live:
```sql
SELECT state, count(*)
FROM pg_stat_activity
WHERE datname = current_database()
GROUP BY state ORDER BY count(*) DESC;
```
*Look for:* total approaching the tier ceiling, or a pile of `idle in transaction`
(leaked/unclosed sessions). This is the §2 / §1 signal in raw form.

**Unused / low-use indexes** — bloat that slows writes without paying for itself:
```sql
SELECT relname AS table, indexrelname AS index, idx_scan AS scans,
       pg_size_pretty(pg_relation_size(indexrelid)) AS size
FROM pg_stat_user_indexes
ORDER BY idx_scan ASC, pg_relation_size(indexrelid) DESC
LIMIT 25;
```
*Look for:* `scans = 0` on large indexes — candidates to drop (cf.
`migrations/drop_redundant_indexes_2026-05-31.sql`). Confirm against query plans first.

---

## 7. Scale checklist

Pull these in order — each step buys headroom for the next:

1. **Compute tier** — NANO → Small/Medium, Pro + Cost-Control (§1, the lever).
2. **Watch connections + CPU** — `> 80%` sustained is the early warning (§2, §6).
3. **Read replica** — when reporting/read load outgrows the primary (§3d, owner).
4. **Keyset pagination** — FE-coordinated, authed-verified, *not* an autopilot push (§4).
5. **Partitioning** — append-only tables, when their size starts costing query time (§5).

Alert thresholds (CPU `> 80%`, connections `> 80%` of pool, auth `521` sustained) live in
[MONITORING.md](./MONITORING.md).
