# Observability next steps

**Date:** 2026-06-01
**Status:** advisory notes — implement piece-by-piece as motivation arises.

## State today

In place:
- Vercel Speed Insights (per Vercel dashboard config)
- Vercel Analytics (script tag in index.html line 667)
- Lighthouse CI on every PR + push to main (`.github/workflows/lighthouse.yml`) with tightened budgets
- web-vitals attribution overlay (debug mode `?debug=1`) from Phase G

Not in place but achievable:
- `Server-Timing` response headers (per-DB-call latency)
- `pg_stat_statements` weekly snapshot history
- HTTP/3 confirmation
- Web Vitals export to a private dashboard (Sentry, Datadog, etc.)

## § Server-Timing on RPC responses

### Why

`Server-Timing` header lets the browser surface server-side latency breakdown in DevTools → Network → Timing tab AND it shows up in real-user `PerformanceResourceTiming.serverTiming`. Invaluable when a query is slow but you can't tell if it's the network, the DB, or PostgREST.

### How

Supabase's PostgREST doesn't natively emit `Server-Timing`. Path forward:

**Option A — Edge Function wrapper.** Create one Edge Function per slow RPC (`get_referral_leaderboard`, `calendar_dashboard_payload`, etc.) that calls the RPC and adds `Server-Timing: db;dur=NN` to the response.

```ts
// supabase/functions/calendar-dashboard/index.ts (illustrative)
Deno.serve(async (req) => {
  const start = performance.now();
  const url = new URL(req.url);
  const args = Object.fromEntries(url.searchParams);
  const sb = createClient(...);
  const { data, error } = await sb.rpc('calendar_dashboard_payload', args);
  const dur = (performance.now() - start).toFixed(1);
  return new Response(JSON.stringify(data || { error: error?.message }), {
    headers: {
      'Content-Type': 'application/json',
      'Server-Timing': `db;dur=${dur}`,
      'Access-Control-Allow-Origin': '*',
    }
  });
});
```

**Option B — Postgres anonymous code block** measuring internally and embedding the timing in the JSON payload (not in a header). Client reads `result._timing.db_ms`. Less standard but no Edge Function cost.

**Recommendation:** start with Option A on the 2-3 most latency-sensitive endpoints. Skip for low-frequency RPCs.

### Cost

Each Edge Function invocation adds ~10-30ms of Fluid Compute time over the direct PostgREST hit. Worth it for diagnostic value on the calendar mount and dashboard KPIs.

## § HTTP/3 verification

### Status

Vercel serves HTTP/3 (QUIC) automatically to compatible clients. No config required. **Already running** from real browser traffic.

To confirm in Chrome:
1. Open DevTools → Network
2. Right-click any column header → check "Protocol"
3. Reload destinoraclessolution.com
4. The Protocol column shows `h3` for HTTP/3, `h2` for HTTP/2, `http/1.1` for older

The curl probe on 2026-06-01 returned `HTTP/1.1` only because the bundled libcurl doesn't support HTTP/2 negotiation. Browser traffic is on the modern protocols.

### Action

None needed. Already optimal.

## § pg_stat_statements weekly snapshot

### Why

`pg_stat_statements` resets on every Postgres restart and on manual `pg_stat_statements_reset()`. To see trends across weeks (which queries are getting slower?), snapshot the counters periodically.

### How

```sql
-- One-time setup:
CREATE TABLE IF NOT EXISTS public.pg_stat_statements_snapshots (
  snapshot_at timestamptz NOT NULL DEFAULT now(),
  queryid bigint NOT NULL,
  query text,
  calls bigint,
  total_exec_time double precision,
  mean_exec_time double precision
);

-- Weekly cron snapshot (via pg_cron):
SELECT cron.schedule(
  'snapshot-pg-stat-statements-weekly',
  '0 4 * * 0',   -- Sunday 4am UTC
  $$
  INSERT INTO public.pg_stat_statements_snapshots
    (queryid, query, calls, total_exec_time, mean_exec_time)
  SELECT queryid, query, calls, total_exec_time, mean_exec_time
  FROM pg_stat_statements
  WHERE query NOT ILIKE '%pg_%'
  ORDER BY total_exec_time DESC
  LIMIT 50;
  $$
);
```

Then weekly review:

```sql
SELECT
  queryid,
  substring(query, 1, 80) AS query,
  array_agg(mean_exec_time::numeric(10,2) ORDER BY snapshot_at) AS mean_history,
  max(snapshot_at)::date AS latest
FROM public.pg_stat_statements_snapshots
WHERE snapshot_at > now() - interval '8 weeks'
GROUP BY queryid, query
ORDER BY (array_agg(mean_exec_time ORDER BY snapshot_at DESC))[1] DESC
LIMIT 10;
```

This shows mean_exec_time trends for the top 10 queries over the last 8 weeks. Spot regressions early.

### Cost

Trivial — 50 rows of stats per week, ~10 KB/year.

## § Web Vitals export to private dashboard

### Why

Vercel Speed Insights gives you aggregate p75/p95 per route. For per-user investigation ("why was Mr. Ng's login slow?") you need attribution data tied to user ID.

The Phase G commit added the web-vitals attribution overlay (`?debug=1`). To export those metrics persistently, send them to a logging endpoint.

### How

```js
import('web-vitals').then(({ onLCP, onINP, onCLS, onFCP, onTTFB }) => {
  const report = (metric) => {
    fetch('/api/web-vitals', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({
        name: metric.name,
        value: metric.value,
        rating: metric.rating,
        userId: window._currentUser?.id,
        url: location.pathname,
        ua: navigator.userAgent.slice(0, 100),
      }),
      keepalive: true,
    }).catch(()=>{});
  };
  onLCP(report); onINP(report); onCLS(report); onFCP(report); onTTFB(report);
});
```

Plus an Edge Function or Supabase RPC `/api/web-vitals` that writes to a `web_vitals_log` table. Then aggregate via SQL.

### Cost

One Vercel Edge invocation per metric per page load. With 5 metrics × N users × M page loads, this can add up. Sample if cost matters: `if (Math.random() < 0.1) report(metric);`

## When to act on any of this

| Trigger | What to add |
|---|---|
| A specific RPC feels slow but Vercel logs are unclear | Server-Timing (Option A) on that RPC |
| Want to track perf trends across releases | pg_stat_statements weekly snapshot |
| A specific user reports slowness you can't reproduce | Web Vitals export with userId |
| Curiosity about HTTP/3 adoption | Open Chrome DevTools — already on |

None of these are urgent. The existing observability (Lighthouse CI gates + Speed Insights) catches the cases that have happened so far.
