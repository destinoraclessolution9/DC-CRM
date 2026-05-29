# DNJ Instagram — Master Launch Playbook

The single source of truth for running **@dnj.ai**. Everything in this folder feeds this guide.
**Goal:** 0 → 10,000 followers in 90 days. **Engine:** **1 reel/day** + 2–3 carousels/week + daily Stories + collabs.

> 📕 **Before drafting any post**, run it through `viral-framework-2026.md` (the Chalette 4-step model adapted for DNJ). Every caption must be Hook → Pain → Solve → CTA; every cover must have a number + Malaysia keyword + high-contrast accent.
>
> 📅 **Content runway:** `content-calendar-60day.md` (Days 1–60, foundation) + `content-calendar-180day.md` (Days 61–180, four themed phases). Captions in `caption-bank-60day.md` + `caption-bank-180day.md`.

---

## 1. Account facts

| | |
|--|--|
| Handle | **@dnj.ai** |
| Display name (Name field) | **TARGET:** `DNJ \| AI Job Matching 🇲🇾` — keyword-optimized for IG search. ⚠️ **Still live as `KensonOo` — change it in the IG mobile app** (Edit profile → Name; web has no Name field). |
| Category | Recruitment Agency (Professional → Business) |
| Site | diamondandjeweler.com |
| Voice | Hidden Talent Movement — gold/black, emotional > corporate |
| Tagline | *Everyone is a diamond. You just need the right jeweler.* |

> **Why the Name field matters:** Instagram search indexes the *Name* field (not just the @handle). It must carry your top searchable keywords — "AI Job Matching" + 🇲🇾 — not a personal name. The `@dnj.ai` handle already carries the brand; the Name field does the SEO.
> Note: older files under `launch/` say `@diamondandjeweler` — that was the pre-launch placeholder. The live account is **@dnj.ai**.

---

## 2. File map — what each thing is for

```
instagram/
├─ README.md                    ← you are here (the playbook)
├─ content-calendar-60day.md    ← the 60-day schedule (format + hook per day)
├─ caption-bank-60day.md        ← copy-paste captions + hashtags for all 60 days
├─ content-tracker.md           ← log every post; watch shares/saves + follower gain
├─ reel-scripts-growth.md       ← shot-by-shot scripts for the Week 2–3 priority reels
├─ launch/
│  ├─ setup-checklist.md        ← one-time profile setup (bio, photo, business switch)
│  ├─ captions.md               ← Week-1 launch captions (Day 1–7, exact)
│  ├─ reel-scripts.md           ← launch-week reel scripts
│  ├─ partner-posts.md          ← cross-promo / partner caption templates
│  ├─ profile-photo.png         ← profile picture (ready to upload)
│  ├─ carousel-slide-1..5.png   ← launch carousel (portrait 4:5)
│  ├─ carousel-sq-1..5.png      ← launch carousel (square 1:1)
│  ├─ carousel-story-1..7.png   ← launch carousel as Stories (9:16)
│  ├─ day2-quote-card.png       ← Day-2 quote card
│  └─ highlight-covers/         ← talents · employers · how · stories · faq
└─ content/
   ├─ carousels/                ← rendered carousels for days 10,16,23,29,34,37,44,51,58
   ├─ quotes/                   ← rendered quote cards for days 5,12,19,25,32,39,46,53
   ├─ make_carousels.py         ← regenerate carousels (edit text → rerun)
   └─ make_quote_cards.py       ← regenerate quote cards
```

---

## 3. Quick start (do this once)

**Day 0 — profile setup** → follow `launch/setup-checklist.md` end to end:
1. Upload `launch/profile-photo.png`.
2. Paste the bio (in checklist).
3. Switch to **Business → Recruitment Agency**.
4. Add link `https://diamondandjeweler.com` (mobile app only).
5. Confirm account is **Public**.

**Day 1 — launch** → follow `launch/captions.md`:
- **10:00 MYT** — post launch carousel (`carousel-slide-1..5.png`) + caption + pinned first comment.
- **10:00–11:00** — reply to every comment within 5 min (first-hour reach is algorithm-critical).
- **11:00** — reshare carousel to Stories with the "100 resumes vs 3 matches" poll.
- **14:00** — post Reel 1 ("Applied to 73 jobs").
- **All day** — leave 15 genuine comments under `#MalaysiaJobs` / `#FreshGraduate`.

---

## 4. Daily operating rhythm

Every single day:
1. **Post 1 reel** (the engine) — script from `reel-scripts-growth.md`; film 9:16, subtitles on, trending audio, hook in 1.5s. Publish as a **Trial Reel** when possible; push winners to feed. *(Carousel/quote days from the calendar are layered on top, 2–3×/week — they're the saves/authority layer, not the daily driver.)*
2. **First 60 minutes** — reply to every comment within 5 min; reshare to Stories with a poll or question.
3. **2–3 Stories/day** — polls, questions, behind-the-scenes, reshares.
4. **Engage outward (15–30 min)** — 5–10 *thoughtful* comments on slightly-larger niche accounts (1K–5K) + creators you want to collab with.
5. **Log it** — one row in `content-tracker.md` (reach, likes, comments, **shares**, **saves**, follows).

---

## 5. The growth engine (read before you stall)

> **⚡ 2026 rebalance:** we were posting mostly carousels/quotes (saves + authority) and almost **no reels** — that starves the *discovery* side. Reels bring NEW followers; carousels keep the ones you have. The mix below is now **reel-first.**

**The Trifecta (each format has ONE job):**
| Format | Job | Cadence | Watch |
|--|--|--|--|
| **Reels** | **Discovery — reach new people** | **1/day min · 2/day in Phase 2** | shares · watch-time · saves |
| **Carousels** | Value → convert viewers to followers | 2–3/week | saves · comments |
| **Stories** | Community + engagement | daily (2–3) | replies · poll votes |

- **Reels = reach.** Minimum **7/week (1/day).** This is THE growth lever — carousels rarely bring strangers.
- **Shareable emotion > corporate.** Relatable career pain gets *sent to friends* = #1 multiplier.
- **Every reel:** hook in 1.5s · subtitles always · trending audio · keep ≤15s · aim 60–80% completion · end frame = D&J + diamondandjeweler.com.
- **Pillars:** 40% relatable pain · 30% Hidden Talent · 15% hiring truths · 10% jobs · 5% product.

**New tactics (added 2026-05-26 from the 10K growth playbook):**
- **Hashtags, reel version:** put **3–5 niche tags (50K–300K post size)** in the **first comment** — not 11+ broad tags in the caption. Keeps captions clean for SEO. *(Carousels keep the existing 11-tag sets; we A/B the difference over 2 weeks.)*
- **Caption SEO:** open most captions with one **keyword line** people actually search (e.g. *"Job search tips for fresh graduates in Malaysia 🇲🇾"*) — then the emotional voice. The algorithm reads captions as search text.
- **Trial Reels:** publish new reels as **Trial Reels** (shown to non-followers first). Only push winners to the main feed.
- **Repurpose winners:** turn the top carousel into a reel and vice-versa — multiplies reach for free. *(First candidate: Day 29 "5 interview answers" → text/talking-head reel.)*
- **CTA every time:** "Save this," "Follow for Part 2," "Send this to a friend who's job-hunting." Prompting **shares/saves** beats asking for likes.
- **If a reel breaks 50K views** → remake it next week with a fresh hook + consider RM5–10/day boost.
- **Accelerators if organic stalls:** collab reels with mid-tier MY creators (DM pipeline in tracker) + a small niche-relevant giveaway + paid boost on the best reel.

**Milestones** (tracked in `content-tracker.md`): Wk2 → 150 · Wk4 → 500 · Wk6 → 1,500 · Wk8 → 3,500 · Day 90 → 10,000.

---

## 6. Asset status — what's ready vs. what you make on the day

**Pre-rendered and ready (just download + post):**
- Launch carousel (3 aspect ratios) + Day-2 quote card → `launch/`
- Carousels: days **10, 16, 23, 29, 34, 37, 44, 51, 58** → `content/carousels/`
- Quote cards: days **5, 12, 19, 25, 32, 39, 46, 53** → `content/quotes/`
- 5 highlight covers → `launch/highlight-covers/`

**You create on the day (reels — no pre-render possible):**
- All reel days. Scripts exist for the priority ones in `reel-scripts-growth.md` + `launch/reel-scripts.md`; the rest use the caption-bank hook as the brief. Film vertical 9:16, subtitles on, trending audio.

**You swap in real content when available:**
- Day 23 / 43 / 57 — real tester or user success story.
- Days 27 / 41 / 48 / 55 — real featured roles from the platform.

To regenerate any card with new text: edit the text block in `content/make_carousels.py` or `make_quote_cards.py` and rerun with `python <file>.py`.

---

## 7. Outreach & collab pipeline

- Target mid-tier MY creators (career, fresh-grad, lifestyle) — log every DM in `content-tracker.md` → *DM outreach log*.
- Lead with value, not a pitch. Goal: Instagram **Collab** reels (shared to both audiences).
- Partner caption templates live in `launch/partner-posts.md`.

---

## 8. Weekly review (every Sunday)

From `content-tracker.md`:
1. Top post by **shares**? → make 2 more like it.
2. Top reel hook that held past 3s? → reuse the format.
3. Worst performer? → drop that angle.
4. Net follower gain vs. last week → on track for the next milestone?
5. Any reel >50K? → remake + consider boost.

---

## 9. The 90-day phases

| Phase | Days | Goal | Key moves |
|--|--|--|--|
| **1 — Foundation** | 1–30 | Validate niche, lock a consistent rhythm | 1 reel + 1 Story daily · 20 min/day engaging · profile fully optimized |
| **2 — Acceleration** | 31–60 | More volume, reach beyond followers, start collabs | 2 reels/day · 2 carousels/week · DM 3 creators for a Collab |
| **3 — Scaling** | 61–90 | Double down on winners, use advanced features | analyze top 5 posts by shares/saves · 1 niche giveaway · test 1–2 new hooks via Trial Reels |

## 10. Don't sabotage yourself (the 10 mistakes)

❌ Drifting off-niche · ❌ no hook in the first 2s · ❌ asking for likes instead of **shares** · ❌ buying fake followers · ❌ weak bio/Name field · ❌ no CTA · ❌ ghosting comments & DMs · ❌ 30 broad hashtags · ❌ random posting times · ❌ ignoring Insights.

**Tools:** Canva / InShot (create) · Meta Business Suite (schedule) · IG Insights + Later/Sked (analytics) · this repo's `make_*.py` (regenerate cards).

---

*Built for the Hidden Talent Movement. Make a reel daily, reply fast, prompt shares, review weekly.* 💎
