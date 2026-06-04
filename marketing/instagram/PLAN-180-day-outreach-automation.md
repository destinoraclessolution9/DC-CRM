# DNJ Instagram — 180-Day Outreach Automation Plan

**Status:** `@suggest` — plan only, awaiting approval before execution.
**Author:** Claude (this session)
**Date:** 2026-05-30

---

## Decisions locked from your answers

| Decision | Your pick |
|--|--|
| Volume tier | **Safe ramp** (10/20/2 → 15/30/3 → 20/40/4) |
| Automation mode | **Fully automated via Chrome MCP** |
| Report delivery | **Both** — daily file + rolling log |

---

## Volume schedule (safe ramp)

| Days | Follows/day | Likes/day | Comments/day |
|--|--|--|--|
| **1–14** | 10 | 20 | 2 |
| **15–28** | 15 | 30 | 3 |
| **29–180** | 20 | 40 | 4 |

180-day totals: **~3,200 follows · ~6,400 likes · ~640 comments**

> The volume cap is below the IG action-block threshold for accounts under 10K followers. We monitor for "Action Blocked" toasts and pause automatically if one appears.

---

## Timing (43-min drift)

Start: **2026-05-31, 08:00 MYT** (tomorrow Saturday)
Each day fires `+43 minutes` later than the previous.

| Day | Date | Fire time (MYT) |
|--|--|--|
| 1 | Sat 31 May | 08:00 |
| 2 | Sun 1 Jun | 08:43 |
| 3 | Mon 2 Jun | 09:26 |
| 4 | Tue 3 Jun | 10:09 |
| 5 | Wed 4 Jun | 10:52 |
| ... | | (cycle wraps past midnight on day ~33) |
| 180 | Thu 26 Nov | 04:23 (next day) |

Total drift across 180 days = 180 × 43 min = 7,740 min = **5.4 days of clock drift**.

---

## Where actions come from

### Follows
- Source: Google Sheet `1hQElglimhgENXt6A_EpG-nTIPDtOO2cTciTmHmb1Pzo`, tab `Outreach Queue` (gid `790670619`).
- Filter: `Platform = "instagram"` AND `Status != "Followed"`.
- Pick: next N rows (where N = today's quota), ordered by Rank ascending.
- After each successful follow, write `Followed` + timestamp back to the row.

### Likes
- Source: profiles we follow + the hashtag pool `#freshgraduatemalaysia`, `#kerjakosong`, `#careermalaysia`, `#jobseekersmalaysia`, `#interviewtipsmalaysia`, `#graduatejobsmy`.
- Pick: top-3 most recent posts from each of today's 10–20 new follows + top recent posts from 1 hashtag rotation.
- Skip any post older than 7 days.

### Comments
- Source: human-drafted templates, one per niche. Selected per post by content keywords.
- 8 starter templates (all under 12 words, varied):
  - `"This. Exactly. 👏"`
  - `"Saved this — needed to hear it 💎"`
  - `"Tagging someone who needs to read this 👇"`
  - `"100%. The right room makes the difference."`
  - `"Real talk. Glad someone said it."`
  - `"This deserves more reach 💎"`
  - `"Quiet talent always wins eventually 🤝"`
  - `"Bookmarking this for Monday."`
- Per-day rotation: shuffle order; max 1 use per template per day.

---

## State tracking (the brain)

New file: `marketing/instagram/outreach-state.json`

```json
{
  "started_on": "2026-05-31",
  "current_day": 1,
  "last_fire": "2026-05-31T08:00:00+08",
  "next_fire": "2026-06-01T08:43:00+08",
  "sheet_cursor": {
    "platform_filter": "instagram",
    "next_rank": 1,
    "rows_processed": []
  },
  "totals": { "follows": 0, "likes": 0, "comments": 0 },
  "blocks_seen": [],
  "templates_used_today": []
}
```

After every run, append to `marketing/instagram/outreach-daily-log.md` and write the day's detail file.

---

## Cron job (the trigger)

Use the `schedule` skill to create a routine that fires at the day-N drift time. The routine prompt:

```
DNJ daily IG outreach — Day {N}.

1. Read marketing/instagram/outreach-state.json.
2. Calculate today's quota from the volume schedule.
3. Open IG (@dnj.ai), execute today's actions in Chrome MCP:
   - Follow the next batch from the sheet.
   - Like recent posts from new follows + hashtag rotation.
   - Comment using rotated templates.
4. If any "Action Blocked" appears: pause that action type, log, continue with others.
5. Update outreach-state.json.
6. Write marketing/instagram/daily-reports/YYYY-MM-DD.md and append to outreach-daily-log.md.
7. Git commit + push.
```

The cron uses a calculated `at`-time per day (not a fixed cron expression, because of the 43-min drift). We schedule each day individually for the next 7 days; the routine self-reschedules on completion.

---

## Daily report format

### `daily-reports/YYYY-MM-DD.md` (per day)

```
# DNJ IG Outreach — Day N (YYYY-MM-DD)

Fired: HH:MM MYT
Tier: Safe ramp (10/20/2)

## Follows (10/10)
- @handle1 — ✅
- @handle2 — ✅ (replied to last DM)
- ... (10 total)

## Likes (20/20)
- @handle1 post URL — ✅
- ... (20 total)

## Comments (2/2)
- @handle1 post URL: "This. Exactly. 👏"
- @handle2 post URL: "Saved this — needed to hear it 💎"

## Blocks / errors
- (none)

## Net followers change
+3 since yesterday → 5 total followers
```

### `outreach-daily-log.md` (rolling)

One line per day:
```
| Day | Date | Follows | Likes | Comments | Blocks | Net followers Δ | Total followers |
|--|--|--|--|--|--|--|--|
| 1 | 2026-05-31 | 10/10 | 20/20 | 2/2 | 0 | +1 | 3 |
| 2 | 2026-06-01 | 10/10 | 20/20 | 2/2 | 0 | +2 | 5 |
```

---

## Safeguards (what protects @dnj.ai from a ban)

1. **Cap on speed**: each action gets a 25-90 second random delay between clicks. 30 follows = ~25 min, not 30 seconds.
2. **Action-block detection**: if IG shows "We restrict certain activity", the routine **stops the offending action type for 48 hours** and continues with the others.
3. **Daily resume only**: if the previous day failed, day N starts fresh — no batching of missed actions.
4. **Per-hashtag cap**: max 5 likes per hashtag per day (looks more human).
5. **No comments on already-commented profiles** — checked against state file.

---

## What I need from you to flip "green"

1. **Confirm start date** — Sat 2026-05-31 at 08:00 MYT? Or push to Mon 2026-06-02 (skip weekend warm-up)?
2. **Confirm Chrome stays open** — for the routine to drive the browser, Chrome MCP must be connected when the cron fires. If your laptop sleeps overnight, we need a different mode (UI.Vision macros — let me know).
3. **Confirm comments are OK to automate** — even with the 8-template rotation, IG can flag patterned comments. Safer mode: I draft 2 comments daily, you paste manually. (Recommend this.)
4. **Approval to create the state file + first cron + tracking files** — I will not write any of these until you say "go".

---

## What happens AFTER you approve

1. I create `outreach-state.json`, `daily-reports/`, `outreach-daily-log.md`.
2. I create `marketing/instagram/outreach-engine.js` (the action runner — Chrome MCP driver).
3. I create the first 7 cron jobs via the `schedule` skill (auto-renewing).
4. I commit + push to GitHub.
5. Tomorrow 08:00 MYT, Day 1 fires. You'll get the first report in `daily-reports/2026-05-31.md`.

---

*Awaiting your "go" / "stop" / "modify" before any execution. Reply with any of the 3 questions above answered, and I'll either run it or adjust.*
