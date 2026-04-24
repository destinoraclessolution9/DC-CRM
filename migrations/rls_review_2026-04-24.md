# RLS review — 2026-04-24

## Background
A bug-audit pass flagged `create policy "auth_select" ... using (true)` in
`migrations/rls_replace_allow_all_2026-04-24.sql:50,74` as a **CRITICAL**
finding ("any authenticated user reads all rows in 16 tables").

## Resolution: intentional, not a bug
This is a **single-tenant** CRM (one organisation, one Supabase project, one
team of consultants). The business model requires cross-visibility:

| Table | Why team-wide read is required |
|---|---|
| `booking_appointments`, `booking_slots`, `booking_pages` | Front desk + consultants share schedule visibility |
| `lead_forms`, `lead_submissions` | Any agent can pick up an unclaimed lead |
| `surveys`, `survey_responses` | NPS dashboard for managers; agents see their own response trends |
| `custom_field_definitions`, `custom_field_values` | App-wide schema config |
| `document_tags`, `document_tag_mappings` | Shared taxonomy |
| `ai_predictions` | Cross-agent forecast view |
| `portal_sessions` | Auditing consent flow |
| `special_programs`, `special_program_participants` | Program-wide enrolment |
| `user_preferences` | Per-user prefs (could be tightened to `auth.uid() = user_id` — see below) |

The migration **does** restrict mutation:
- `mgr_update` requires Manager (`current_user_level() ≤ 10`)
- `admin_delete` requires Marketing Manager / Super Admin (`≤ 2`)

Anon role is **not** granted any of these policies — only `authenticated`.
Signup is gated through invitation/admin approval flow.

## One real follow-up
`user_preferences.auth_select` should be tightened to per-user:

```sql
drop policy if exists "auth_select" on user_preferences;
create policy "auth_select" on user_preferences for select to authenticated
  using (user_id = auth.uid());
```

This is the only row of these 16 tables where cross-user read is *not*
needed (every user only ever reads their own preferences).

## Verdict
- The `using (true)` pattern was a **false-positive CRITICAL** in the audit.
- Re-rated as **LOW** with one specific tightening recommended above.
- No mass policy rewrite required.
