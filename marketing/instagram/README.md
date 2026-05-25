# DNJ Instagram — Master Launch Playbook

The single source of truth for running **@dnj.ai**. Everything in this folder feeds this guide.
**Goal:** 0 → 10,000 followers in 90 days. **Engine:** daily posting + 5 reels/week + collabs.

---

## 1. Account facts

| | |
|--|--|
| Handle | **@dnj.ai** |
| Display name | `DNJ \| Hidden Talent` |
| Category | Recruitment Agency (Professional → Business) |
| Site | diamondandjeweler.com |
| Voice | Hidden Talent Movement — gold/black, emotional > corporate |
| Tagline | *Everyone is a diamond. You just need the right jeweler.* |

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
1. **Post the day's main piece** — look it up in `content-calendar-60day.md`, grab the caption from `caption-bank-60day.md`, attach the matching asset (see §6).
2. **First 60 minutes** — reply to every comment; reshare to Stories with a poll or question.
3. **2–3 Stories/day** — polls, questions, behind-the-scenes, reshares.
4. **Engage outward** — 10–15 real comments on target hashtags + creators you want to collab with.
5. **Log it** — one row in `content-tracker.md` (reach, likes, comments, **shares**, **saves**, follows).

---

## 5. The growth engine (read before you stall)

- **Reels = reach.** They bring NEW followers. Minimum **5/week.** Carousels/quotes build saves + authority but rarely go viral.
- **Shareable emotion > corporate.** Relatable career pain gets *sent to friends* — the #1 growth lever.
- **Every reel:** hook in 1.5s · subtitles always · trending audio · end frame = D&J + diamondandjeweler.com.
- **Pillars:** 40% relatable pain · 30% Hidden Talent · 15% hiring truths · 10% jobs · 5% product.
- **If a reel breaks 50K views** → remake it next week with a fresh hook + consider RM5–10/day boost.
- **Accelerators if organic stalls:** collab reels with mid-tier MY creators (DM pipeline in tracker) + paid boost on the best reel.

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

*Built for the Hidden Talent Movement. Post daily, reply fast, make reels, review weekly.* 💎
