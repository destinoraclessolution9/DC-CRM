# 103 Early Hints — design (not yet implemented)

**Status:** designed, not applied. The hashed-filename win from Phase F creates a non-trivial integration challenge.
**Date:** 2026-06-01

## What 103 Early Hints would do

Browser receives `103 Early Hints` from the CDN edge **before** the full `200 OK` HTML response, with `Link: <...>; rel=preload; as=...` headers. The browser starts fetching those resources **while the origin is still building the HTML response**, shaving roughly 50–200 ms off mobile cold-load on slow networks.

For an already-fast static site (Vercel-cached HTML, brotli, content-hashed assets), the practical win on this codebase is **smaller than typical** because:

1. The HTML response is already a CDN HIT in most cases (`Age: 4761` observed in headers today).
2. Inline `<link rel="preload">` in `<head>` already triggers parallel asset fetch from the *first* parsed byte of HTML.
3. The HTML payload is ~56 KB before brotli — the gap between "HTML start" and "HTML preload tag found" is sub-10 ms even on slow connections.

## Why it's tricky with content-hashed filenames

Vercel sends Early Hints by reading the `Link:` HTTP response header set in `vercel.json`. That config is **static at build time**, but the hashed filenames change every build (`script.4d7c4e845f.min.js` etc.).

Two options exist, each with a tradeoff:

### Option A — point Early Hints at canonical (non-hashed) names

```json
{
  "source": "/(index\\.html|)",
  "headers": [
    { "key": "Link",
      "value": "<script.min.js>; rel=preload; as=script, <data.min.js>; rel=preload; as=script, <styles-fixed.min.css>; rel=preload; as=style" }
  ]
}
```

**Problem:** the canonical `script.min.js` is a *different file* from `script.4d7c4e845f.min.js` (build emits both, content-identical but cached under separate keys). Browser would preload both, doubling bytes for cold loads.

**Verdict:** wasteful. Don't.

### Option B — have `build.mjs` emit `vercel.json` with the hashed names

`build.mjs` already produces `dist-manifest.json` listing the hashed filenames. Extend it to read `vercel.json`, splice in the hashed `Link:` value, and re-write the file. Then commit it.

**Concern:** `vercel.json` becomes a build artifact, not human-edited. The headers section has lots of other security config that authors expect to be hand-editable.

**Mitigation:** keep two files: `vercel.json.tmpl` (committed, source of truth, human-edited) and `vercel.json` (build artifact, gitignored or auto-regenerated, with the `Link` header spliced in by build.mjs).

**Verdict:** correct approach. Requires build.mjs touch + ops sequence change.

### Option C — Vercel Edge Function to set Link header dynamically

Use Routing Middleware to read the asset manifest at request time and emit Early Hints. Most flexible, but adds an Edge invocation to every HTML request and the cold-start cost likely exceeds the Early Hints savings.

**Verdict:** over-engineered for this site.

## Recommended path

**Defer Early Hints until cold-load measured pain emerges.**

The realistic ~100 ms savings on cold-load aren't enough to justify Option B's build-pipeline change today. If a real-user metric (Speed Insights LCP p95) is later flagged as poor, revisit and implement Option B.

## When to revisit

- Lighthouse LCP > 2500 ms on mobile cold-load consistently
- Real-user Web Vitals p75 LCP > 2500 ms in any region
- Adding new render-blocking critical assets (rare)

## Reference: what would land in vercel.json under Option B

```json
{
  "source": "/(index\\.html|)",
  "headers": [
    { "key": "Cache-Control", "value": "no-cache, no-store, must-revalidate" },
    { "key": "Link", "value": "<{{HASHED_SCRIPT_MIN_JS}}>; rel=preload; as=script; fetchpriority=high, <{{HASHED_DATA_MIN_JS}}>; rel=preload; as=script, <{{HASHED_STYLES_MIN_CSS}}>; rel=preload; as=style, </fonts/Inter-400.woff2>; rel=preload; as=font; type=font/woff2; crossorigin, </fonts/Inter-600.woff2>; rel=preload; as=font; type=font/woff2; crossorigin" }
  ]
}
```

`build.mjs` substitutes `{{HASHED_*}}` placeholders from `dist-manifest.json` and writes the final `vercel.json` before deploy.

## Note on HTTP/3 (QUIC)

Vercel serves HTTP/3 automatically to clients that support it (Chrome / Edge / Firefox / Safari from desktop and mobile). No config change needed. Verify by checking DevTools → Network → Protocol column — modern browsers show `h3`. The curl probe done on 2026-06-01 returned `HTTP/1.1` only because the installed libcurl doesn't support HTTP/2 negotiation; real browser traffic uses h2 or h3 as appropriate.
