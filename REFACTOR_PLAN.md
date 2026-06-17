# CRM Quality Refactor — Living Checklist

Branch: `refactor/quality` (off `main` @ b72d4ea). **Do NOT deploy to live unless owner says `@done`/`@go`.**
Gate: `node ci/regression.js` (audit → build → snapshot-vs-baseline) must stay green; one task per commit.
Full plan: `C:\Users\DC\.claude\plans\nifty-finding-seahorse.md`. Findings detail: `_audit_findings.txt`, `_reval_merged.json`.

Re-validation result (53 audit findings vs current live): **10 fixed by the big upgrade**, 0 false, 4 partial, 39 valid → ~30 distinct work items.

---

## Wave 0 — Guardrails (zero behavior risk)
- [x] 0.0 Re-baseline `ci/baseline.json` to post-upgrade current (5092 lines / 422 keys / 1298 exports)
- [ ] 0.1 Wire CI gate — `package.json` scripts (`ci`/`audit`/`lint`/`snapshot`) + `.github/workflows/ci.yml`
- [ ] 0.2 Pattern-lint checker `ci/lint-patterns.js` (report-mode → enforce after Wave 1): no inline `role.match(/Level/)`, no local `escapeHtml` redef, no `getAll(` in loop/map/filter
- [ ] 0.3 Size-budget check `ci/size-budget.js` + `ci/size-budgets.json` (ratchet-down only), wired into regression
- [ ] 0.4 Remove 17 dead orphan files + commented `<script>` block `index.html:655-677` (#42)
- [ ] 0.5 Untrack 397 build artifacts (`*.min.js`/`*.br`) + broaden `.gitignore` (#38) — Vercel rebuilds via `node build.mjs`

## Wave 1 — Mechanical de-duplication (safe find-replace)
- [ ] 1.1 One `escapeHtml`: unify divergent defs (`ui.js:6` vs `script.js:1114` leaves non-strings raw); repoint `_crmUtils.escapeHtml`; replace ~13 chunk re-impls with `_utils.escapeHtml` alias (#10/#11/#17)
- [ ] 1.2 Central role parsing: ~25 inline `role.match(/Level/)` → `_getUserLevel` (#8/#12/#37)
- [ ] 1.3 Shared formatters: `_crmUtils.formatRM` (#15) / `formatDate` (#16) / `toCsv` (#14) / `isReferrerOrCustomer` (#13); replace copies
- [ ] 1.4 Flip `ci/lint-patterns.js` to enforcing; re-baseline at wave boundary

## Wave 2 — Perf/data hardening (staged)
- [ ] 2.1 Bound `queryAdvanced` fallback `data.js:2299-2351` (#20/#31)
- [ ] 2.2 `_autoSync` off read hot-path `data.js:1170` (#21)
- [ ] 2.3 Batch WhatsApp campaign N+1 `script-marketing.js:3997-4048` + `createMany` (#28/#23)
- [ ] 2.4 Pipeline counts from memory `script-pipeline.js` (#18/#30)
- [ ] 2.5 Advanced-search filter hoist (#19/#27)
- [ ] 2.6 Trim predictive prefetch `script.js:2924-2951` (#25)
- [ ] 2.7 Cap referral-tree fetch (#24/#33)
- [ ] 2.8 KPI Target-vs-Actual → `kpi_*` RPC (#34)

## Wave 3 — Structural decoupling (explicit go)
- [ ] 3.1 One view registry: unify 2 dispatchers + 3 authz tables (#2/#39/#9)
- [ ] 3.2 gcal: `dataChanged` listener, not method monkey-patch `script-gcal.js:1130-1172` (#7/#44)
- [ ] 3.3 Extract god-functions: `saveActivity` (~749 lines), render monoliths (#36)
- [ ] 3.4 Silent-catch sweep (~175 no-op `catch{}`) (#40)

## Wave 4 — Largest refactors (explicit go each)
- [ ] 4.1 Namespace god-object: `app.register(...)` + aliases (#1)
- [ ] 4.2 Split `AppDataStore` into Net/Cache/Sync/Queue (#5)
- [ ] 4.3 Split 9,965-line `script-prospects.js` (#36)
- [ ] 4.4 `_appState` read-only + inline-onclick → delegation (#3/#6)

---
## Log
- 2026-06-17: synced w/ live (b72d4ea, clean), re-validated 53 findings, baseline re-init, branch created.
