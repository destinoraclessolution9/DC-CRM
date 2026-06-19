# `deploy/` — Container & orchestration reference (NOT the production path)

**Reference-only artifacts. Nothing here is wired to CI/CD or production.**

## Senior stance: do NOT containerize the frontend for production

The production target for this SPA is **Vercel's edge CDN**, and that is the
right answer. Vercel is strictly better than a container for serving a static,
content-hashed asset tree:

- **Global PoPs** — assets are served from the edge nearest each user; a single
  nginx pod (or a handful) cannot match that geographic reach.
- **Zero ops** — no cluster, no node patching, no cert rotation, no autoscaler
  to babysit. `git push` is the whole deploy.
- **Immutable caching + instant rollback** — content-hashed assets cache
  forever at the edge; a bad deploy is one-click Instant Rollback.
- **Brotli-11 + hardened headers** are already produced by `build.mjs` and
  `vercel.json` (CSP/HSTS), applied at the edge.

Putting Kubernetes in front of this static tree is an **anti-pattern**: you
trade away all of the above for cluster ops you didn't need. So these files
exist for exactly two legitimate reasons, and no more:

1. **Local prod-parity** — build and serve the real built tree under nginx on a
   laptop, to reproduce header/caching/SW behaviour you can't see on the dev
   server. (`docker-compose.yml` + `Dockerfile`.)
2. **A FUTURE long-running worker** — a queue consumer / OCR pipeline that
   outgrows Supabase Edge Functions. That is a server workload, where a
   container + autoscaler genuinely fit. (`k8s/worker-deployment.yaml`.)

The Kubernetes manifest for the *static SPA* (`k8s/static-nginx.yaml`) is
included **only** for air-gapped / on-prem / self-host situations where Vercel
is unavailable. Do not use it on the normal path.

## What each file is

| File | Purpose |
|------|---------|
| `Dockerfile` | Multi-stage build (`node:24-alpine` runs `build.mjs`) → `nginx:1.27-alpine` serving the static tree on port 80. **Build context = repo root.** *(authored separately)* |
| `nginx.conf` | nginx server block mirroring Vercel's headers/caching. *(authored separately)* |
| `docker-compose.yml` | Local parity: builds the image and serves it on `http://localhost:8082`. Commented reference for adding the **official** Supabase self-host stack. |
| `k8s/static-nginx.yaml` | **Not recommended.** Static SPA as Deployment + Service + (commented) Ingress, for air-gapped/self-host only. |
| `k8s/worker-deployment.yaml` | **Illustrative scaffolding** for a future `crm-worker` (Deployment + HPA). The service does not exist yet. |

## Build & run (local parity)

From the **repo root** (the Dockerfile build context is the root, so
`build.mjs` and all sources are visible):

```sh
# Build the image directly
docker build -f deploy/Dockerfile -t crm-static .
docker run --rm -p 8082:80 crm-static       # http://localhost:8082

# Or via compose (build + run + restart policy)
docker compose -f deploy/docker-compose.yml up --build
docker compose -f deploy/docker-compose.yml down
```

Need a local backend too? Use the **official** Supabase self-host compose — do
not hand-roll the stack. See the commented block in `docker-compose.yml`.
**Seed SYNTHETIC data only — never load a production dump into a local stack.**

## When a container IS justified

- **Local prod-parity debugging** — header/caching/brotli/SW-scope issues that
  only appear under a real static server, not the python dev server.
- **A future long-running worker** — durable queue consumption or a heavy OCR /
  order-form pipeline that exceeds Edge Function limits (CPU/memory/duration).
  That's a real server workload; `k8s/worker-deployment.yaml` is its template.

## When a container is NOT justified

- Serving the production SPA. Use Vercel. (See the senior stance above.)

## See also

- `../docs/devops/DEVOPS_PLAN.md` — production-readiness plan & guardrails.
- `../docs/devops/ARCHITECTURE.md` — system architecture overview.
