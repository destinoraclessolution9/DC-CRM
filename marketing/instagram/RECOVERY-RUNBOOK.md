# DNJ Instagram — Disaster Recovery Runbook

**Purpose:** if @dnj.ai is ever blocked/disabled, rebuild a new account and re-post everything fast.

**You need 3 things (all backed up):**
1. **The text** → `post-log-backup.csv` (this folder) + the live Google Sheet "DNJ Instagram — Post Log & Backup"
2. **The images** → Google Drive folder "DNJ IG Assets" + this repo's `marketing/instagram/content/` and `launch/` folders (push to GitHub = cloud copy)
3. **The order** → the `#` column in the post log (post oldest→newest to rebuild the grid correctly)

---

## If the account gets blocked — do this

### Step 1 — Create the new account (YOU)
- Make a new IG account. Closest handle to `@dnj.ai` (e.g. `dnj.ai.my`, `dnj_ai`, `diamondandjeweler`).
- Account creation must be done by you (not automatable).

### Step 2 — Rebuild the profile (EXACT live values)
- **Username:** `dnj.ai` (use closest available on the new account)
- **Display name — use the SEO target:** `DNJ | AI Job Matching 🇲🇾` (set in the mobile app → Edit profile → Name). *(Old live value was `KensonOo`.)*
- **Category:** `Recruiter` (Professional account)
- **Profile photo:** `launch/profile-photo.png`
- **Website/Link:** `https://diamondandjeweler.com` (set in bio — links are mobile-app only)
- **Public contact email:** `diamondandjeweler@gmail.com`
- **Bio (exact, 141/150 chars):**
  ```
  Some talents are never discovered. 💎
  AI finds your best 3 — not 100 rejections.
  🇲🇾 Malaysia · Talents & Employers
  👇 diamondandjeweler.com
  ```
- Switch to **Professional → Business → Recruitment Agency**

### Step 3 — Re-post every post, in order
Open `post-log-backup.csv` (or the Google Sheet). For each row, **top of `#` to bottom (1 → 7 …)**:
1. Create post → upload the file(s) in **Image Files** (from Drive / repo). Carousels: upload all slides **in order**.
2. Paste the **Caption** exactly (it's stored with line breaks + emojis intact).
3. Publish.
4. Post the **First Comment**.

> Posting oldest-first rebuilds the grid in the same visual order.

### Step 4 — Re-grow
- Re-run the follow + engage playbook (`README.md`, `content-calendar-60day.md`).
- Re-DM/notify your influencer network that you moved accounts.

---

## Where everything lives (the backup map)

| What | Primary | Backup |
|--|--|--|
| Post text (caption/comment/URL) | Google Sheet "DNJ Instagram — Post Log & Backup" | `post-log-backup.csv` (repo + GitHub) |
| Post images | Google Drive "DNJ IG Assets" | repo `marketing/instagram/content` + `launch` (GitHub) |
| Image regeneration scripts | repo `content/make_carousels.py`, `make_quote_cards.py` | GitHub |
| All 60-day captions (drafts) | `caption-bank-60day.md` | GitHub |
| Profile assets | `launch/profile-photo.png`, `launch/highlight-covers/` | GitHub / Drive |

## ⚠ Images to locate or recreate (not yet confirmed in repo)
These 4 older posts were made before the asset folder was organized — confirm or re-render their images and add to Drive:
- **#1** Employer/HR partner post — copy in `launch/partner-posts.md`
- **#2** University/career-services partner post — copy in `launch/partner-posts.md`
- **#3** Day 1 launch carousel — likely `launch/carousel-slide-1..5.png` (verify slide vs square)
- **#4** "No, we don't sell diamonds" — D&J gold-on-black template (re-render if missing)

## Maintenance rule
**Every time a new post goes live:** add a row to the Google Sheet AND append to `post-log-backup.csv`, then push the repo. The log must never lag behind what's actually posted.
