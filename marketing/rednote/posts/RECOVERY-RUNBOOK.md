# DNJ RedNote — Backup & Recovery Runbook

**Purpose:** if the RedNote account ever gets blocked, re-create a new account and **re-post everything** from this backup — fast.

---

## What's backed up (3 independent copies)

| Layer | Where | Contains |
|--|--|--|
| **1. Git (primary, disaster-proof)** | this repo → `marketing/rednote/` pushed to GitHub | `posts/post-log.csv` (master log) · `posts/dayNN/` (exact images + `title/body/hashtags.txt` + `meta.json` + `live.png` proof) · `caption-bank-*.md` · `content/` images + generators |
| **2. Google Sheet** | "DNJ RedNote · Post Log" (auto-created) | one row per post: all text + Drive link |
| **3. Google Drive** | "DNJ RedNote Assets/dayNN/" | the exact image files |

Even with **only the git repo**, you can fully recover: every posted image + its title/正文/话题 is in `posts/dayNN/`.

---

## Per-post logging (how the backup stays current)

Every time a post goes live, run the logger so it's recorded everywhere:

```
# 1. drop the post into its folder:
#    posts/dayNN/  ->  info.json, title.txt, body.txt, hashtags.txt, the *.png images
#    (optional) live.png = screenshot of the published note
# 2. record it:
python marketing/rednote/posts/log_post.py NN
```

That writes `meta.json`, updates `post-log.csv`, and (if `RN_WEBHOOK` is set) mirrors to the Google Sheet + Drive. Then `git add/commit/push`.

> **Backfilled so far:** Day 1, Day 2 (live).

---

## Google Sheet / Drive setup (one-time, free)

See `apps_script_post_log.gs` header for the 2-minute deploy. After deploying, put the `/exec` URL + secret into `log_post.py` (`RN_WEBHOOK` / `RN_SECRET`). Until then, Layer 1 (git) already backs everything up.

---

## RECOVERY: account blocked → new account

**Inputs you keep regardless:** this repo (`git pull`), the Google Sheet, the Drive folder. Nothing is lost.

1. **Create a new RedNote account** — *you* must do this (Claude can't create accounts). Use a fresh handle.
2. **Restore the profile** from `posts/profile/` (Claude drives via ADB, or manually in-app):
   - **Avatar:** `posts/profile/avatar.png` (gold D&J diamond logo)
   - **Name:** `posts/profile/name.txt` → `DNJ 被低估的天赋`  *(no "·" — RedNote rejects it; use a space)*
   - **Bio:** `posts/profile/bio.txt` (3 lines, no URL — RedNote strips links in bio)
   - Full record + edit-limit notes: `posts/profile/profile.json`
3. **Connect the phone** (USB) → enable **Developer options → USB debugging** → plug in → tap **Allow**. Quit the **Honor Suite** PC app first (it runs its own adb and fights ours).
4. **One-time tools** (if not present): `adb` (Google platform-tools) + `ADBKeyboard.apk` (for Chinese typing). Both already in `C:\Users\DC\platform-tools\`.
5. **Re-post everything** — from a **clean gallery** on the recovery device:
   ```
   python marketing/rednote/posts/repost_from_log.py --from 1 --to 2      # test on a couple first
   python marketing/rednote/posts/repost_from_log.py --all                # then the rest
   ```
   It reads `post-log.csv`, and for each day: pushes that day's images, opens the composer, selects them in order, types the title + 正文 + 话题, and posts. (Supervise the first run.)
6. **Re-engage followers** from the outreach sheet (`Downloads/data.csv`) — like 1-2 posts of priority RedNote targets (see prior session method).

### ⚠️ Pacing (important on a brand-new account)
A day-old account that suddenly posts dozens of notes + likes hundreds looks bot-like and can get re-blocked. **Pace it:** a few posts/day, ~20-30 likes/day. The backup lets you recover *completely*, just not all in one hour.

---

## Prevention (so you need this less)
- Don't bulk-post / bulk-like from a fresh account.
- Keep external URLs out of bio + post bodies (RedNote flags them).
- Keep matching framed as "AI 智能匹配" only — never 八字/命理/玄学 (see README red line).

---

## File map (`marketing/rednote/posts/`)
```
post-log.csv               master log (1 row/post) — import into Sheets anytime
log_post.py                records a post (meta.json + csv + optional Sheet/Drive)
repost_from_log.py         re-posts everything from the log via ADB (recovery)
apps_script_post_log.gs    Google Sheet + Drive endpoint (deploy once)
RECOVERY-RUNBOOK.md        this file
dayNN/                     per-post: images + title/body/hashtags.txt + meta.json (+ live.png)
profile/                   account identity: name.txt + bio.txt + avatar.png + profile.json
```
