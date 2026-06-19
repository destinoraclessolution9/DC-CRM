# DevOps Documentation

The production-operations docs for **destinoraclessolution.com** — the durable
source of truth for how the CRM is built, deployed, monitored, secured, scaled,
and recovered. This set was authored by the DevOps production-readiness effort
(2026-06-19), in which each phase ships independently to live. If you operate or
on-call this system, everything you need is in this folder.

## Documents

| Doc | Purpose |
|-----|---------|
| [DEVOPS_PLAN.md](./DEVOPS_PLAN.md) | Master plan: stack reality, what's already production-grade, the real gaps, guardrails, and the P0–P6 phase map. |
| [ARCHITECTURE.md](./ARCHITECTURE.md) | System topology, request paths, build/deploy flow, and the observability/ops plane (ASCII diagrams). |
| [OWNER_ACTION_CHECKLIST.md](./OWNER_ACTION_CHECKLIST.md) | The owner-only switches code can't flip: Sentry DSN, uptime account, pooler, branch protection, log drain, WAF. **Start here.** |
| [DEPLOY_DISCIPLINE.md](./DEPLOY_DISCIPLINE.md) | Source-only commits, when (not) to bump `CACHE_VERSION`, live-verify via `__ASSET_MANIFEST`, rollback. |
| [CICD.md](./CICD.md) | GitHub Actions (`ci`/`lighthouse`/`uptime`/`deploy`/`backup`), the CI gate, and the migration ledger. |
| [MONITORING.md](./MONITORING.md) | Sentry, uptime probe, BFF JSON logs, Supabase metric alerts, and what each alert means. |
| [SECURITY_EDGE.md](./SECURITY_EDGE.md) | BFF auth/scope model, the 8 Supabase Edge Functions, RLS + native MFA, CSP/headers, rate-limit backstop. |
| [SCALING.md](./SCALING.md) | Connection pooling, keyset vs offset pagination, compute tier, and the documented load limits. |
| [INCIDENT_RUNBOOK.md](./INCIDENT_RUNBOOK.md) | On-call playbook: diagnose up/down, the 521 compute-exhaustion class, rollback, restore. **On-call starts here.** |
| [../deploy/](../deploy/) | Container / self-host reference (Dockerfile, compose, env) for running off-Vercel. |

## Phase map

| Phase | Theme | Produced |
|-------|-------|----------|
| **P0** | Hygiene + plan | `DEVOPS_PLAN.md`, `ARCHITECTURE.md`, `OWNER_ACTION_CHECKLIST.md` |
| **P1** | SW de-herd *(already live)* | `DEPLOY_DISCIPLINE.md` (jittered reload + edit-guard shipped in `sw-init.js`) |
| **P2** | Observability | `MONITORING.md`, `obs-init.js` (env-gated Sentry), BFF JSON logs, `uptime.yml` |
| **P3** | CI/CD + ledger | `CICD.md`, deploy-gating workflows, migration ledger |
| **P4** | Edge security | `SECURITY_EDGE.md`, `/api` rate-limit backstop, CSP Sentry origin, edge-fn auth |
| **P5** | Scaling | `SCALING.md`, pooling config, keyset pagination path |
| **P6** | Containers + runbooks | `../deploy/`, `INCIDENT_RUNBOOK.md` |

## Start here

- **Owners** — read [OWNER_ACTION_CHECKLIST.md](./OWNER_ACTION_CHECKLIST.md) first.
  Everything inert-by-default stays a no-op until you flip the listed switches.
- **On-call** — read [INCIDENT_RUNBOOK.md](./INCIDENT_RUNBOOK.md) first; keep
  [MONITORING.md](./MONITORING.md) open alongside it.
- **Everyone else** — [ARCHITECTURE.md](./ARCHITECTURE.md) is the fastest way to
  understand the system end-to-end.
