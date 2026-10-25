# Prospect & Customer Profile — Information Architecture (2026-10-25)

Owner ask: the profile is messy, repeats itself and nags. Make it neat, easy to
read, organised — around five questions: who is this, what is it worth, what
happened last, what is next, what moves them forward.

## Decisions (owner, 2026-10-25)
- Tabs (not one long page).
- A meeting's next action gets a "by when" date, defaulting to +7 days.
- Backfill: only open next actions from the last 90 days become tasks; older ones stay history.
- Manual Est. Value / Close Probability (and budget / timeline / decision maker) retired
  from the profile in favour of deals + the auto open potential. Columns and data stay.

## One source of truth
| Thing | Owner record | Shown |
|---|---|---|
| Meeting | `activities` / `event_attendees` row (minutes, background, observations, result) | Timeline (full), Snapshot "Last meeting" (2-line summary) |
| Task | `journey_touchpoints` (title, due, status, owner) — meeting next actions and deal next steps link in via `source_activity_id` / `source_deal_id` | Engagement "Next up", Snapshot "Next follow-up", daily to-do |
| Opportunity | `pipeline_deals` + `audit_prescriptions`; total = `prospects.open_potential_rm` | Opportunities tab, Snapshot "Open potential" |
| Event | `events` + `event_attendees` | Timeline |

## Phase 0 — data audit (live, read-only)
- Est. value / close prob / budget / timeline / decision maker: **0** prospects use them.
- `activities.next_action`: 33 rows; **11** in the last 90 days, all open. `note_next_steps`: 2 rows.
- `event_attendees.next_action`: 2 rows, both older than 90 days. No done column → ticks were per-device (localStorage).
- `journey_touchpoints`: 157 (155 pending). **82 pending are past due but never marked overdue** → overdue is now computed from the due date.
- `pipeline_deals`: 14, all open, all with a next step.
- Notes: 3. `potential_level` (Hot/Warm from CPS): 400 — kept.
- Notes section's "Documents" block was a hard-coded "No documents uploaded".

## Phases
1. **Snapshot header** — key facts, one action bar (Book follow-up · WhatsApp · Call · ⋯), three cards. 🎯 box and 💰 badge folded into the cards; Protection section → header chip pop-up.
2. **Master task list** — migration (`source_*` columns, `next_action_due`, sync triggers, add-task RPC), backfill, Engagement "Next up". Removes Next Actions section, "Next Steps to Close" and the copied next-action paragraphs.
3. **Tabs** — Engagement · Opportunities · Records · Details. Section ids (`acc-body-<key>-<id>`, `cust-acc-body-<key>-<id>`) unchanged — other chunks refresh by them.
4. **Opportunities** — deals on the profile, Journey as a stage stepper only, latest needs / pain points from the newest meeting.
5. **Visual pass** — flat sections, readable minutes, status colours only.
6. **Checks** — sim tests, SQL scenario, live UI desktop + phone.
