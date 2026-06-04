# DNJ Instagram — Daily Outreach Protocol

**This is the runbook the scheduled task reads at every daily fire.**
**State lives in `outreach-state.json`. Reports go to `daily-reports/YYYY-MM-DD.md` + `outreach-daily-log.md`.**

---

## On every fire — exact 9-step protocol

### Step 1 — Load state
- Read `marketing/instagram/outreach-state.json`.
- Increment `next_day` to become `current_day` for this run.
- Determine today's tier from `tier.ramp_schedule` based on `current_day`.
- Set today's quota: `follows`, `likes`, `comment_drafts`.
- If `comment_approval_mode == "draft_only"` (default): comments will be drafted in the report, **NOT posted**.

### Step 2 — Open IG via Chrome MCP
- Use `mcp__Claude_in_Chrome__tabs_context_mcp` (createIfEmpty:true) to get/make a tab.
- Navigate to `https://www.instagram.com/`.
- If `Turn on Notifications` popup: click `Not Now`.
- If login required: STOP, write report block "BLOCKED — login required", commit, and reschedule for next day. Do NOT attempt to log in.

### Step 3 — Pull today's follow batch from the Google Sheet
- Navigate to `https://docs.google.com/spreadsheets/d/{state.sheet.id}/edit?gid={state.sheet.tab_gid}`.
- Wait for sheet to load (up to 15s). If frozen, retry once.
- Read rows where `Platform == "instagram"` and `Status != "Followed"` and `Rank >= state.sheet.next_unprocessed_rank`.
- Pick the next `follows` (today's quota) rows ordered by Rank ascending.
- Capture each row's `Username` and `Profile URL`.

### Step 4 — Execute follows (low-risk action)
- For each of the N target profiles:
  - Navigate to the profile.
  - Wait `random(state.delays_seconds.between_clicks_min, state.delays_seconds.between_clicks_max)` seconds.
  - Find `Follow` button; click it.
  - Watch for "Action Blocked" / "Try Again Later" toasts. If seen: log to `state.blocks_seen`, halt follows for `state.safeguards.stop_on_action_block_hours`, continue to Step 5.
  - On success: mark the row in `state.sheet.rows_processed` with timestamp + handle.
  - Update sheet (best-effort): set `Status = Followed` for that row.

### Step 5 — Execute likes (low-risk action)
- Build the like target list:
  - For each handle just followed in Step 4: open profile, like the top 1–2 most recent posts (last 7 days only).
  - For each of `state.hashtag_pool`: navigate to `https://www.instagram.com/explore/tags/{tag}/`, like up to `state.safeguards.per_hashtag_likes_per_day_max` recent posts.
  - Fill remaining like quota by liking posts of yesterday's follows.
- For each like:
  - Wait `random(25, 90)` seconds.
  - Click heart. Watch for action block. Same halt logic as Step 4.
  - Record the post URL in today's `liked_urls` list (for the report).

### Step 6 — Generate comment drafts (NO POSTING)
- Pick `comment_drafts` posts from today's like list — preferring posts with strong engagement signal (high comment count, recent timing).
- For each pick, choose one of `state.comment_templates` not yet used today.
- Generate the daily report's `## Comment drafts (PENDING APPROVAL)` section with:
  - Post URL
  - Author handle
  - Suggested template
  - "Approve in next session by replying: post comments"

### Step 7 — Write reports
- Write `marketing/instagram/daily-reports/{YYYY-MM-DD}.md` using the template in this file (see "Daily report template" below).
- Append a single-line row to `marketing/instagram/outreach-daily-log.md`.

### Step 8 — Update state + reschedule
- Update `outreach-state.json`:
  - `current_day = next_day`
  - `next_day = current_day + 1`
  - `last_fire_iso = now`
  - `last_report_path = daily-reports/{date}.md`
  - `next_fire_iso = next_fire_iso + 43 minutes` (one full day plus 43 min from previous fire)
  - Increment `totals`
- Create the **next day's** scheduled task using `mcp__scheduled-tasks__create_scheduled_task`:
  - `taskId`: `dnj-outreach-day-{N+1}`
  - `fireAt`: the new `next_fire_iso`
  - `prompt`: copy of the standard prompt (see "Standard cron prompt" below)
  - `description`: `DNJ IG outreach Day {N+1}`
  - `notifyOnCompletion`: true

### Step 9 — Commit + push
- `git add marketing/instagram/outreach-state.json marketing/instagram/daily-reports/ marketing/instagram/outreach-daily-log.md`
- Commit message: `outreach Day {N}: {follows}/{quota} follows · {likes}/{quota} likes · {drafts} comments drafted`
- `git push origin main`

---

## Safeguards (do not skip)

- **Action-Block toast detection:** if IG shows "We restrict certain activity", immediately stop the offending action type, log `{type, timestamp}` to `state.blocks_seen`, and SKIP that action type for the next `state.safeguards.stop_on_action_block_hours` hours.
- **Per-hashtag cap:** likes from each hashtag capped at `state.safeguards.per_hashtag_likes_per_day_max` per day.
- **Never re-comment same handle:** scan `state.totals.comments_posted` historical handle list — never queue a comment for a handle already commented on.
- **Random delay enforced** between every clickable action.
- **No automatic password entry** — if IG asks to log in, halt and report.

---

## Daily report template

```markdown
# DNJ IG Outreach — Day {N} ({YYYY-MM-DD})

**Fired:** {HH:MM} MYT
**Tier:** {tier name} ({follows_quota}/{likes_quota}/{drafts_quota})
**Engine:** automated via Chrome MCP
**Approval needed:** Y if comment drafts present below

## Follows ({follows_done}/{follows_quota})
- @handle1 — ✅ (Rank {N}, {Niche})
- @handle2 — ✅
- ...

## Likes ({likes_done}/{likes_quota})
- @handle: {post URL} — ✅
- ...

## Comment drafts (PENDING APPROVAL) ({drafts}/{drafts_quota})

> Reply **"post comments"** in your next session to approve and post all of these.
> Reply **"skip comments"** to drop them.
> Reply **"edit N: {new text}"** to customize one before posting.

| # | Handle | Post URL | Draft template |
|--|--|--|--|
| 1 | @handle | url | "This. Exactly. 👏" |
| 2 | @handle | url | "Saved this — needed to hear it 💎" |

## Blocks / errors
- (none)

## Net followers change
- Yesterday: {N}, Today: {N+x} ({±x} since last fire)

## Tomorrow
- Day {N+1} fires at {next_fire_iso} (in {hours} hours)
- Tier still {tier name}; or transitions to {next tier} on day {transition day}.
```

---

## Rolling log format (`outreach-daily-log.md`)

Markdown table, one row appended per day:

```markdown
| Day | Date | Fire | Follows | Likes | Drafts | Posted | Blocks | Followers |
|--|--|--|--|--|--|--|--|--|
| 1 | 2026-05-31 | 08:00 | 10/10 | 20/20 | 2/2 | 0 (pending) | 0 | 3 |
| 2 | 2026-06-01 | 08:43 | 10/10 | 20/20 | 2/2 | 2 (next day) | 0 | 5 |
```

---

## Standard cron prompt (reused for every day)

The scheduled task created at Step 8 uses **this exact prompt** for the next day's run. Self-contained — does not assume any conversation context.

```
You are running the DNJ Instagram daily outreach routine.

WORKING DIRECTORY: C:\Users\DC\Desktop\DestinOraclesSolution CRM

1. Read marketing/instagram/outreach-protocol.md. That is the full protocol.
2. Read marketing/instagram/outreach-state.json. That is the current state.
3. Execute the 9-step protocol exactly as written.
4. NEVER post comments — only draft them in the report.
5. NEVER log in to Instagram — if login required, halt and report.
6. At the end, create the next day's scheduled task and commit+push.

The Google Sheet (1hQElglimhgENXt6A_EpG-nTIPDtOO2cTciTmHmb1Pzo, gid 790670619) is the source of follow targets.
The Chrome MCP server drives the browser. If Chrome MCP is not connected, halt and write a report saying so.
```

---

## Comment-approval flow (the only manual step)

1. Each morning, the engine writes drafts under `## Comment drafts (PENDING APPROVAL)` in the day's report.
2. When you next open a session with Claude and say "post comments", I:
   - Read today's report.
   - Open IG via Chrome MCP.
   - Post each draft on its URL.
   - Update `state.totals.comments_posted` and the rolling log.
   - Commit + push.
3. If you reply "skip comments", I drop them (log as `skipped`).
4. If you reply "edit 1: New text", I substitute that text on draft 1, post it, leave others queued or post them.

---

## Pause / resume

- **Pause:** delete the scheduled task `dnj-outreach-day-{N+1}` via `mcp__scheduled-tasks__list_scheduled_tasks` + `mcp__scheduled-tasks__update_scheduled_task` (set `enabled: false`).
- **Resume:** re-create the scheduled task with `fireAt` = today + 1 day at the next 43-min increment.

---

*Authored 2026-06-04. Activated for fire on 2026-06-05 08:00 MYT.*
