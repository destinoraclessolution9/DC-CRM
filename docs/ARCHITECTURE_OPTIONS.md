# Architecture options — Vercel/Supabase moves to consider later

**Date:** 2026-06-01
**Status:** advisory; nothing here is recommended for immediate adoption.

These five moves are real Vercel/Supabase capabilities that could improve specific scenarios. None are warranted by today's workload. Each has a trigger condition.

---

## § 1. Edge Config for hot lookup tables

### What

Vercel Edge Config stores small JSON (≤512KB) replicated globally to every region, read in ≤15 ms regardless of origin. Suited for feature flags, A/B variants, and small lookup tables.

### Codebase fit

`venues`, `event_categories`, `products` metadata, role-permission map, feature flags. Currently read from Postgres via SWR cache in `data.js`. Once seeded in localStorage, reads are local; first-load reads pay one Supabase round-trip.

Moving these to Edge Config would:
- Skip the cold-cache Supabase fetch (~150 ms saved)
- Be available at the edge before the bundle finishes loading

### Trigger

- Feature flag rollouts need <100ms global propagation
- Lookup table reads ever show up in Supabase top-20 (currently they don't)
- Mobile cold-load LCP regresses due to category metadata fetch

### Effort

S — load on deploy via Vercel CLI, swap the read path in `data.js`.

### Cost

Vercel charges per Edge Config read after free tier. Probably free for this scale.

---

## § 2. Vercel Queues for campaign_queue

### What

Vercel Queues (public beta) is a durable event streaming system with at-least-once delivery on Fluid Compute. Replaces the home-built `campaign_queue` table + manual worker pattern.

### Codebase fit

`migrations/scale_30k_1k_2026-04-25.sql` defines `campaign_queue` for WhatsApp/email/SMS bulk sends. Today the queue is a Postgres table polled by an Edge Function. Vercel Queues would:
- Provide ack/retry/DLQ semantics out of the box
- Auto-scale workers based on queue depth
- Decouple from Supabase outages

### Trigger

- WhatsApp/email blasts ever back up (queue depth > 1000 sustained)
- Worker reliability issues (lost messages, duplicate sends)
- Campaign latency complaints

### Effort

M — migrate enqueue API to Queues SDK; rewrite worker as a Queue consumer Edge Function; preserve `campaign_queue` table for audit history.

### Cost

Per-message billing. For low-volume CRM, possibly cheaper than Edge Function poll cycles.

### Caveat

Public beta — production stability not yet guaranteed.

---

## § 3. SSE (Server-Sent Events) vs Realtime websocket

### What

Server-Sent Events stream from a single Edge Function endpoint (one-way push). Alternative to Supabase Realtime's websocket.

### Codebase fit

Realtime is now active on 6 tables (Phase F commit). Websockets work great BUT they can hold the mobile radio in active mode, draining battery on backgrounded tabs.

SSE auto-reconnects natively, runs over standard HTTP/2/3 (multiplexed with other requests), and the connection can be coalesced by the browser.

### Trigger

- Mobile users report battery drain
- Realtime websocket reconnect storms during flaky network conditions
- Need to push data from non-Postgres sources (Postgres-only is Realtime's limit)

### Effort

L — significant refactor of `AppDataStore` Realtime hook. SSE doesn't directly replace logical replication; need an Edge Function that listens to Postgres and re-emits via SSE.

### Recommendation

Stay with Realtime. The codebase already invested in it (commit b9c3083 expanded coverage); SSE would only matter if specific issues emerge.

---

## § 4. Vercel Blob for user-uploaded photos

### What

Vercel Blob is multi-tenant cloud storage with both public and private buckets, content-hashed URLs, automatic CDN distribution.

### Codebase fit

Today `attachments` lives in a Supabase Storage bucket (RLS-protected per-prospect). Egress on Supabase Storage counts against the project's bandwidth allowance. Moving image-heavy buckets (case study photos, CPS form photos) to Vercel Blob would:
- Offload bandwidth from Supabase
- Get content-hashed CDN URLs (perfect cache)
- Vercel image transformations available

### Trigger

- Supabase bandwidth bill becomes the dominant cost
- Image load latency reported by users in non-SG regions
- Need server-side image transformations (Vercel Blob has built-in resize/format conversion)

### Effort

M — dual-write during migration period, swap reads, eventually drop Supabase bucket. RLS replacement needed (Vercel Blob doesn't natively replicate Supabase's per-row permissions).

### Caveat

RLS replacement is the hard part. Photo URLs are currently signed by Supabase per-request based on the authenticated user's prospect access. Vercel Blob signed URLs are simpler but you'd need to wire the authentication check separately.

---

## § 5. WebP/AVIF transformations for user uploads

### What

Convert user-uploaded PNG/JPG to WebP/AVIF on upload (or on the fly via a transformation service). Today the milestone *static* assets are converted (commit 99ca146); user *uploads* are not.

### Codebase fit

Case study photos, CPS form photos, event posters, profile avatars. These are sometimes 1-2 MB unconverted JPGs from phones.

### Trigger

- Photo grids feel slow on mobile
- Storage bandwidth costs spike
- Specific image-heavy view (e.g., case study gallery) shows poor LCP

### Effort

M-L — three sub-decisions:

1. **Where to convert** — client-side before upload (zero server cost, slower for user), server-side via Edge Function (cost per upload), or on-demand via Vercel Image Optimization (cost per first view).
2. **Original retention** — keep original + serve WebP, or replace entirely.
3. **Fallback** — `<picture>` tags vs feature-detection via JS.

### Recommended path

Client-side WebP encoding via `canvas.toBlob(type='image/webp')` in the upload flow. Free, instant, and the user's CPU does the work. Original is replaced; `<img>` continues to work because every modern browser supports WebP.

For galleries with existing PNG/JPG, batch-convert via a one-time `_convert_uploads.mjs` script analogous to `_emit_webp_avif.mjs`.

### When

Trigger when uploads page is slow OR storage cost matters. Not today.

---

## Summary table

| Item | Effort | When to do |
|---|---|---|
| Edge Config for lookup tables | S | When metadata fetch shows up in pg_stat_statements top 20 (currently doesn't) |
| Vercel Queues for campaign_queue | M | When bulk-send reliability becomes a complaint |
| SSE instead of Realtime | L | If mobile battery / reconnect storms become real issues |
| Vercel Blob for uploads | M | If Supabase bandwidth bill dominates |
| WebP for user uploads | M-L | If photo-heavy views feel slow on mobile |

None of these are warranted today. Filed for the day data shows they are.
