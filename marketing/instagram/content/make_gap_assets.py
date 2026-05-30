"""Gap renderer — fills missing Day 14-60 reels + Day 27/41/48/55 job-post carousels.

After this script runs, every day in the 180-day plan has its visual asset(s) on disk.
"""
import os, sys
sys.path.insert(0, os.path.dirname(__file__))
from make_phase3_assets import OUT_CAR, render_method_slide1, render_content_slide, render_cta_slide
from make_reels_batch import render_reel


# ---------- 20 Day 14-60 reels (gaps) ----------

GAP_REELS = [
    # Week 3 (15, 17, 18, 20, 22, 24, 26)
    ("day15-confidence-over-cap", "HIRING TRUTH  ·  MY", ["COMPANIES HIRE", "CONFIDENCE.", "NOT CAPABILITY."], 2,
     ["THE QUIETEST", "CANDIDATE OFTEN", "BUILDS THE BEST."],
     "THE FILTER.", ["IT REWARDS NOISE.", "NOT OUTPUT.", "IT'S BROKEN."]),

    ("day17-cgpa-hunger", "HIRING TRUTH  ·  MY", ["CGPA CAN'T", "MEASURE", "HUNGER."], 2,
     ["YOUR TRANSCRIPT", "IS A PHOTO.", "NOT A FILM."],
     "PROVE IT.", ["ONE PROJECT.", "ONE METRIC.", "ONE STORY."]),

    ("day18-quiet-outperforms", "POV  ·  MY", ["THE QUIET ONE", "OUTPERFORMS", "EVERYONE."], 2,
     ["YEAR 1: INVISIBLE.", "YEAR 2: INDISPENSABLE.", "YEAR 3: LEADER."],
     "QUIET WORKS.", ["LOUD WINS THE ROOM.", "QUIET BUILDS", "THE COMPANY."]),

    ("day20-cv-6-seconds", "QUICK HACK  ·  MY", ["WHY YOUR CV", "GETS IGNORED", "IN 6 SECONDS."], 2,
     ["DUTIES, NOT WINS.", "GENERIC SUMMARY.", "NO METRIC IN TOP 3 LINES."],
     "TOP 3 LINES.", ["NUMBER + OUTCOME +", "WHO IT SERVED.", "EVERY ROLE."]),

    ("day22-most-talented", "HIDDEN TALENT  ·  MY", ["THE MOST TALENTED", "PERSON IN THE ROOM", "IS QUIET."], 2,
     ["THEY'RE THINKING.", "WHILE OTHERS", "ARE TALKING."],
     "FIND THEM.", ["ASK BETTER", "QUESTIONS.", "WAIT LONGER."]),

    ("day24-not-behind", "HIDDEN TALENT  ·  MY", ["YOU'RE NOT", "BEHIND.", "UNDISCOVERED."], 2,
     ["73 APPLICATIONS.", "0 REPLIES.", "(NOT YOUR FAULT.)"],
     "REFRAME.", ["WRONG SYSTEM.", "RIGHT YOU.", "FIND THE MATCH."]),

    ("day26-wrong-place", "CAREER REALITY  ·  MY", ["SIGNS YOU'RE IN", "THE WRONG", "PLACE."], 2,
     ["NO LEARNING.", "NO PEERS.", "NO PATH."],
     "AUDIT.", ["WRONG PLACE.", "NOT WRONG PERSON.", "MOVE."]),

    # Week 5 (31)
    ("day31-cv-red-flags", "QUICK HACK  ·  MY", ["CV RED FLAGS", "RECRUITERS", "SPOT INSTANTLY."], 2,
     ["GAP NOT EXPLAINED.", "INFLATED TITLES.", "NO ACHIEVEMENTS."],
     "FIX TONIGHT.", ["EXPLAIN GAPS.", "STAY ACCURATE.", "SHOW WINS."]),

    # Week 6 (36, 38, 40)
    ("day36-hm-stop-200", "PRODUCT  ·  MY", ["HIRING MANAGERS:", "STOP READING", "200 CVs."], 2,
     ["THE 197 WHO LOST", "WERE BETTER", "THAN HALF THE TOP 3."],
     "THERE'S A WAY.", ["DNJ AI-MATCHES", "YOUR TOP 3.", "48 HOURS."]),

    ("day38-hm-48h", "POV  ·  PRODUCT", ["HM FINDS", "THE PERFECT HIRE", "IN 48 HOURS."], 2,
     ["MONDAY: BRIEF.", "TUESDAY: 3 MATCHES.", "THURSDAY: COFFEE."],
     "FRIDAY: OFFER.", ["NO RECRUITER.", "NO 200-CV PILE.", "RIGHT CUT."]),

    ("day40-ui-15-seconds", "PRODUCT  ·  DNJ", ["HOW DNJ WORKS", "IN 15", "SECONDS."], 2,
     ["1. BUILD PROFILE.", "2. AI FINDS TOP 3.", "3. YOU CHOOSE."],
     "NO SPAM.", ["NO NOISE.", "JUST MATCHES.", "diamondandjeweler.com"]),

    # Week 7 (43, 45, 47)
    ("day43-success-story", "DNJ STORY  ·  MY", ["FIRST USER.", "FELT OVERLOOKED.", "FOR MONTHS."], 2,
     ["ONE RIGHT MATCH.", "ONE LEADER WHO", "SAW POTENTIAL."],
     "NOW THRIVING.", ["THIS IS THE HIDDEN", "TALENT MOVEMENT.", "JOIN."]),

    ("day45-things-i-wish", "BEFORE FIRST JOB  ·  MY", ["3 THINGS I WISH", "I KNEW BEFORE", "MY FIRST JOB."], 2,
     ["TITLES LIE.", "CULTURE IS EVERYTHING.", "FIRST BOSS SHAPES YEARS."],
     "TAG SOMEONE.", ["SEND TO A", "FRESH GRAD.", "ABOUT TO SIGN."]),

    ("day47-collab", "COLLAB  ·  MY", ["WHAT MID-TIER", "CREATORS WISH", "GRADS KNEW."], 2,
     ["JOB SEARCH IS LONELY.", "GHOSTING ISN'T YOU.", "ONE MATCH BREAKS IT."],
     "JOIN MOVEMENT.", ["WE'RE BUILDING", "WHAT WAS MISSING.", "diamondandjeweler.com"]),

    # Week 8 (50, 52, 54)
    ("day50-remake", "REPURPOSE  ·  MY", ["REMAKE OF OUR", "BEST REEL —", "NEW HOOK."], 2,
     ["73 APPLICATIONS.", "0 REPLIES.", "THE NUMBER STILL HURTS."],
     "ONE MATCH FIXES IT.", ["VOLUME WAS NEVER", "THE ANSWER.", "MATCH IS."]),

    ("day52-got-offer", "POV  ·  EMOTIONAL", ["YOU FINALLY", "GOT THE", "OFFER."], 2,
     ["8 MONTHS OF SILENCE.", "ONE EMAIL.", "ONE YES."],
     "FEEL IT.", ["THE WAIT WAS WORTH IT.", "THE RIGHT ROOM", "ARRIVED."]),

    ("day54-interview-red-flags", "QUICK HACK  ·  MY", ["RED FLAGS IN", "AN INTERVIEW.", "(THEIR SIDE.)"], 2,
     ["LATE TO YOUR CALL.", "TALKS OVER YOU.", "CAN'T ANSWER 'GREAT IN 90D'?"],
     "WALK AWAY.", ["DON'T JOIN A ROOM", "THAT INTERVIEWS", "POORLY."]),

    # Sprint (57, 59, 60)
    ("day57-hidden-talent-2", "HIDDEN TALENT  ·  MY", ["HIDDEN TALENT #2.", "OVERLOOKED.", "THEN MATCHED."], 2,
     ["YEARS OF QUIET.", "ONE RIGHT ROOM.", "EVERYTHING CHANGED."],
     "TAG SOMEONE.", ["WHO'S BEEN", "OVERLOOKED.", "TIME FOR THEIR CUT."]),

    ("day59-overlooked-watch", "HIDDEN TALENT  ·  MY", ["IF YOU'RE FEELING", "OVERLOOKED,", "WATCH THIS."], 2,
     ["YOU'RE NOT INVISIBLE.", "YOU'RE BETWEEN", "ROOMS."],
     "TRUST IT.", ["THE RIGHT ROOM", "IS LOOKING TOO.", "TWO SIDES MOVING."]),

    ("day60-manifesto-v1", "60-DAY MANIFESTO  ·  MY", ["60 DAYS OF DNJ.", "HERE'S WHAT", "WE BELIEVE."], 2,
     ["EVERYONE IS A DIAMOND.", "THE FILTER IS BROKEN.", "RIGHT ROOM MATTERS."],
     "JOIN US.", ["HIDDEN TALENT", "MOVEMENT.", "diamondandjeweler.com"]),
]


# ---------- 4 job-post carousels (Days 27, 41, 48, 55) ----------

JOB_CAROUSELS = {
    # Day 27 — Featured Role #1 (junior copywriter KL)
    "day27-featured-role-1": [
        ("method", {"banner": "JR COPYWRITER  ·  KL  ·  HYBRID",
                    "headline": ["FEATURED", "ROLE #1", "RM3.5 - 5K", "AGENCY · KL"],
                    "gold": ["#1", "RM3.5 - 5K"],
                    "subline": "copywriter MY  ·  agency  ·  fresh grad OK"}),
        ("content", ["FRESH GRAD", "WELCOMED"], ["Portfolio matters more", "than degree."]),
        ("content", ["WORK ON"], ["B2C lifestyle brands.", "Real campaigns. Real bylines."]),
        ("content", ["NO CV", "FLOOD."], ["AI-matched top 3 only.", "Direct to CD."]),
        ("cta", ["COMMENT", "HUNT.", "WE'LL DM YOU."], [1]),
    ],

    # Day 41 — Featured Role #2 (operations exec Selangor)
    "day41-featured-role-2": [
        ("method", {"banner": "OPS EXECUTIVE  ·  SELANGOR  ·  E-COMMERCE",
                    "headline": ["FEATURED", "ROLE #2", "RM4.5 - 6.5K", "E-COMM · MY"],
                    "gold": ["#2", "RM4.5 - 6.5K"],
                    "subline": "operations MY  ·  e-commerce  ·  hybrid"}),
        ("content", ["1 - 3 YRS", "EXP"], ["Order ops + warehouse coord.", "Excel + 1 ERP."]),
        ("content", ["E-COMMERCE", "SCALE-UP"], ["Real ownership.", "Real growth path."]),
        ("content", ["NO CV", "FLOOD."], ["AI-matched top 3.", "Direct to COO."]),
        ("cta", ["COMMENT", "HUNT.", "WE'LL DM YOU."], [1]),
    ],

    # Day 48 — Featured Role #3 (junior frontend dev remote)
    "day48-featured-role-3": [
        ("method", {"banner": "JR FRONTEND DEV  ·  REMOTE MY  ·  SaaS",
                    "headline": ["FEATURED", "ROLE #3", "RM4 - 6K", "REMOTE MY"],
                    "gold": ["#3", "RM4 - 6K"],
                    "subline": "frontend dev MY  ·  React  ·  remote"}),
        ("content", ["1 - 2 YRS", "EXP"], ["React + TypeScript.", "Git + CI basics."]),
        ("content", ["SaaS", "PRODUCT"], ["Real users.", "Real bugs. Real growth."]),
        ("content", ["NO CV", "FLOOD."], ["AI-matched top 3 only.", "Direct to tech lead."]),
        ("cta", ["COMMENT", "HUNT.", "WE'LL DM YOU."], [1]),
    ],

    # Day 55 — Featured Role #4 (account exec B2B SaaS)
    "day55-featured-role-4": [
        ("method", {"banner": "ACCOUNT EXEC  ·  KL  ·  B2B SaaS",
                    "headline": ["FEATURED", "ROLE #4", "RM5 - 8K", "+ COMM"],
                    "gold": ["#4", "RM5 - 8K"],
                    "subline": "sales MY  ·  B2B SaaS  ·  on-target"}),
        ("content", ["2 - 4 YRS", "EXP"], ["B2B outbound + closing.", "Owned a quota."]),
        ("content", ["SaaS", "PRODUCT"], ["Recurring revenue.", "Real comm. Real OTE."]),
        ("content", ["NO CV", "FLOOD."], ["AI-matched top 3.", "Direct to sales lead."]),
        ("cta", ["COMMENT", "HUNT.", "WE'LL DM YOU."], [1]),
    ],
}


if __name__ == "__main__":
    print(f"Rendering {len(GAP_REELS)} gap reels + {len(JOB_CAROUSELS)} job-post carousels...\n")

    # Reels
    for i, r in enumerate(GAP_REELS, 1):
        slug, hook_label, hook_lines, hook_gold_idx, body_lines, solve_label, solve_lines = r
        print(f"[reel {i}/{len(GAP_REELS)}] {slug}")
        render_reel(slug, hook_label, hook_lines, hook_gold_idx,
                    body_lines, solve_label, solve_lines, "HIDDEN TALENT MOVEMENT")

    # Job-post carousels
    for slug, slides in JOB_CAROUSELS.items():
        for i, sl in enumerate(slides, 1):
            path = os.path.join(OUT_CAR, f"{slug}-{i}.png")
            kind = sl[0]
            if kind == "method":
                cfg = sl[1]
                render_method_slide1(path, banner=cfg["banner"], headline=cfg["headline"],
                                     gold_words=cfg["gold"], subline=cfg["subline"])
            elif kind == "content":
                render_content_slide(path, head_lines=sl[1], body_lines=sl[2])
            elif kind == "cta":
                render_cta_slide(path, lines=sl[1], gold_indices=sl[2])

    total = len(GAP_REELS) + sum(len(s) for s in JOB_CAROUSELS.values())
    print(f"\nGap fill done: {len(GAP_REELS)} reels + {sum(len(s) for s in JOB_CAROUSELS.values())} job-post slides = {total} assets.")
