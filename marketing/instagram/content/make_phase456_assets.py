"""Phase 4-5-6 (Days 92-180) asset renderer — DNJ Instagram.

25 carousels + 12 quotes covering Distribution, Conversion, and Brand-IP phases.
All assets follow viral-framework-2026 rules (method pattern carousels, resonance pattern quotes).
"""
import os, sys
sys.path.insert(0, os.path.dirname(__file__))
from make_phase3_assets import (
    OUT_CAR, OUT_Q,
    render_method_slide1, render_content_slide, render_cta_slide,
    render_resonance_quote,
)


# ---------- Phase 4-6 carousels ----------

CAROUSELS = {
    # === PHASE 4 ===

    # Day 92 — Hidden Talent #3 (admin clerk -> ops lead)
    "day92-hidden-talent-3": [
        ("method", {"banner": "HIDDEN TALENT  ·  MY 2026",
                    "headline": ["HIDDEN", "TALENT #3", "ADMIN", "TO OPS LEAD"],
                    "gold": ["#3", "OPS LEAD"],
                    "subline": "career growth MY  ·  overlooked  ·  promoted"}),
        ("content", ["6 YEARS", "ANSWERING EMAILS"], ["She saw every broken process", "from the inside."]),
        ("content", ["BUILT A", "1-PAGE SOP"], ["Nobody asked her to.", "She just did it."]),
        ("content", ["DNJ MATCHED", "HER TO FINTECH"], ["They needed an ops lead.", "She had the SOP ready."]),
        ("cta", ["EVERY ROLE", "CAN BE A", "LAUNCHPAD."], [1]),
    ],

    # Day 97 — Hiring Truth #16-18 (notice period games)
    "day97-hiring-truth-6": [
        ("method", {"banner": "NOTICE-PERIOD GAMES  ·  MY 2026",
                    "headline": ["HIRING", "TRUTHS", "#16 - #18", "NOTICE GAMES"],
                    "gold": ["#16", "NOTICE"],
                    "subline": "resignation MY  ·  notice period  ·  2026"}),
        ("content", ["#16"], ["They 'negotiate' your start date", "based on THEIR convenience."]),
        ("content", ["#17"], ["'Garden leave' often hides", "a market-blocking move."]),
        ("content", ["#18"], ["'Immediate start' = hidden", "vacancy bleed somewhere."]),
        ("cta", ["NEGOTIATE", "THE EXIT.", "NOT JUST THE ENTRY."], [1]),
    ],

    # Day 99 — Featured Role #6 (junior data analyst KL)
    "day99-featured-role-6": [
        ("method", {"banner": "JUNIOR DATA ANALYST  ·  KL HYBRID",
                    "headline": ["FEATURED", "ROLE #6", "RM5 - 7K", "SaaS · KL"],
                    "gold": ["#6", "RM5 - 7K"],
                    "subline": "data analyst MY  ·  SQL + Tableau  ·  hybrid"}),
        ("content", ["2 YRS", "EXP"], ["SaaS scale-up.", "Cohort + funnel analysis."]),
        ("content", ["TOOLS"], ["SQL · Tableau · Python", "(pandas a plus, not required)."]),
        ("content", ["NO CV", "FLOOD."], ["AI-matched top 3 only.", "48h shortlist."]),
        ("cta", ["COMMENT", "HUNT.", "WE'LL DM YOU."], [1]),
    ],

    # Day 105 — Hidden Talent #4 (designer)
    "day105-hidden-talent-4": [
        ("method", {"banner": "HIDDEN TALENT  ·  MY 2026",
                    "headline": ["HIDDEN", "TALENT #4", "SENIOR ON PAPER.", "JUNIOR ON COMP."],
                    "gold": ["#4", "JUNIOR ON COMP."],
                    "subline": "designer MY  ·  career growth  ·  +title +pay"}),
        ("content", ["3 YEARS", "SENIOR ON PAPER"], ["Senior workload.", "Junior comp."]),
        ("content", ["DNJ", "MATCHED HER"], ["E-commerce hiring", "Head of Design."]),
        ("content", ["TITLE + PAY", "CAUGHT UP"], ["She got the title", "she'd already been doing."]),
        ("cta", ["YOUR TITLE", "SHOULD MATCH", "YOUR WORK."], [1]),
    ],

    # Day 107 — Hiring Truth #19-21 (panel bias)
    "day107-hiring-truth-7": [
        ("method", {"banner": "PANEL BIAS NOBODY ADMITS  ·  MY",
                    "headline": ["HIRING", "TRUTHS", "#19 - #21", "PANEL GAMES"],
                    "gold": ["#19", "PANEL"],
                    "subline": "interview tips MY  ·  panel  ·  recruitment"}),
        ("content", ["#19"], ["The first opinion in the room", "anchors the rest of the panel."]),
        ("content", ["#20"], ["The loudest interviewer", "usually wins the decision."]),
        ("content", ["#21"], ["The youngest interviewer's", "veto matters more than you think."]),
        ("cta", ["WIN THE", "QUIETEST", "VOTE."], [1]),
    ],

    # Day 112 — Featured Role #7 (UX designer remote)
    "day112-featured-role-7": [
        ("method", {"banner": "UX DESIGNER  ·  REMOTE MY  ·  SG FINTECH",
                    "headline": ["FEATURED", "ROLE #7", "RM7 - 11K", "REMOTE MY"],
                    "gold": ["#7", "RM7 - 11K"],
                    "subline": "UX designer MY  ·  mobile  ·  fintech"}),
        ("content", ["3+ YRS", "EXP"], ["Mobile-first.", "Figma + prototyping."]),
        ("content", ["WORKING", "PROTOTYPE"], ["1 case study required.", "Show your process."]),
        ("content", ["NO CV", "FLOOD."], ["AI-matched top 3.", "Direct to HM."]),
        ("cta", ["COMMENT", "HUNT.", "WE'LL DM YOU."], [1]),
    ],

    # Day 114 — Career Reality #4 (1-year itch)
    "day114-career-reality-4": [
        ("method", {"banner": "THE 1-YEAR ITCH  ·  MY 2026",
                    "headline": ["CAREER", "REALITY #4", "WHEN THE WORK", "GOES SMALL"],
                    "gold": ["#4", "SMALL"],
                    "subline": "career change MY  ·  job switch  ·  2026"}),
        ("content", ["BORED vs", "BORED-STUCK"], ["One is rest.", "The other is rot."]),
        ("content", ["LEARNING", "STILL HAPPENING?"], ["If not — clock is ticking.", "Audit, then decide."]),
        ("content", ["1 MORE LEVEL", "POSSIBLE HERE?"], ["No room above = no room.", "Ask your manager outright."]),
        ("cta", ["YEAR 1 ITCH", "IS DATA.", "NOT FAILURE."], [1]),
    ],

    # Day 119 — Hidden Talent #5 (late bloomer)
    "day119-hidden-talent-5": [
        ("method", {"banner": "HIDDEN TALENT  ·  MY 2026",
                    "headline": ["HIDDEN", "TALENT #5", "35.", "LATE BLOOMER."],
                    "gold": ["#5", "35"],
                    "subline": "late career start  ·  career switch MY  ·  mom"}),
        ("content", ["12 YRS", "IN ADMIN"], ["Two kids. Always tired.", "Felt 'too late'."]),
        ("content", ["1 CERT.", "6 MONTHS."], ["Showed up consistently.", "Built one skill in public."]),
        ("content", ["DNJ", "MATCHED HER"], ["Venture-backed startup", "hiring community-ops."]),
        ("cta", ["LATE", "DOESN'T MEAN", "LESS."], [1]),
    ],

    # === PHASE 5 ===

    # Day 122 — Featured Role #8 (backend engineer Penang)
    "day122-featured-role-8": [
        ("method", {"banner": "BACKEND ENGINEER  ·  PENANG  ·  SERIES A",
                    "headline": ["FEATURED", "ROLE #8", "RM8 - 13K", "+ RSU"],
                    "gold": ["#8", "RM8 - 13K"],
                    "subline": "backend engineer MY  ·  Go / Python  ·  hybrid"}),
        ("content", ["3+ YRS", "EXP"], ["Go OR Python.", "Postgres + queues."]),
        ("content", ["SCALE-UP", "FINTECH"], ["Series A.", "Real revenue. Real RSU."]),
        ("content", ["NO CV", "FLOOD."], ["AI-matched top 3.", "Founder reads them."]),
        ("cta", ["COMMENT", "HUNT.", "WE'LL DM YOU."], [1]),
    ],

    # Day 127 — Hiring Truth #22-24 (HM-side ghosting)
    "day127-hiring-truth-8": [
        ("method", {"banner": "WHY HMs GHOST  ·  MY 2026",
                    "headline": ["HIRING", "TRUTHS", "#22 - #24", "WHY THEY GHOST"],
                    "gold": ["#22", "GHOST"],
                    "subline": "ghosting MY  ·  recruitment  ·  2026"}),
        ("content", ["#22"], ["They got 3 vetoes", "from leadership last minute."]),
        ("content", ["#23"], ["Budget got pulled.", "They're embarrassed to tell you."]),
        ("content", ["#24"], ["Their preferred candidate said yes.", "They forgot to close your loop."]),
        ("cta", ["STOP", "BLAMING", "YOURSELF."], [1]),
    ],

    # Day 129 — Featured Role #9 (marketing manager retail)
    "day129-featured-role-9": [
        ("method", {"banner": "MARKETING MANAGER  ·  RETAIL  ·  KL",
                    "headline": ["FEATURED", "ROLE #9", "RM10 - 15K", "+ BONUS"],
                    "gold": ["#9", "RM10 - 15K"],
                    "subline": "marketing manager MY  ·  D2C  ·  retail"}),
        ("content", ["5+ YRS", "EXP"], ["D2C campaign ownership.", "Multi-channel."]),
        ("content", ["P&L", "OWNERSHIP"], ["Budget + ROAS + attribution.", "Not just creative."]),
        ("content", ["NO CV", "FLOOD."], ["AI-matched top 3 only.", "Direct to founders."]),
        ("cta", ["COMMENT", "HUNT.", "WE'LL DM YOU."], [1]),
    ],

    # Day 134 — Hidden Talent #6 (career switch into tech)
    "day134-hidden-talent-6": [
        ("method", {"banner": "HIDDEN TALENT  ·  MY 2026",
                    "headline": ["HIDDEN", "TALENT #6", "MARKETER", "TO PRODUCT"],
                    "gold": ["#6", "PRODUCT"],
                    "subline": "career switch MY  ·  marketing  ·  product"}),
        ("content", ["9 YRS", "IN MARKETING"], ["Felt the ceiling.", "Wanted to build, not just amplify."]),
        ("content", ["1 CERT.", "1 DISCORD."], ["Showed up where the work was.", "Read 1 RFC a week."]),
        ("content", ["DNJ", "MATCHED HER"], ["Growth-stage SaaS hiring", "Product Marketer."]),
        ("cta", ["OLD SKILLS.", "NEW ROOM.", "REAL EDGE."], [1]),
    ],

    # Day 136 — Featured Role #10 (Finance Analyst KL)
    "day136-featured-role-10": [
        ("method", {"banner": "FINANCE ANALYST  ·  KL  ·  HYBRID",
                    "headline": ["FEATURED", "ROLE #10", "RM5 - 8K", "FINTECH · KL"],
                    "gold": ["#10", "RM5 - 8K"],
                    "subline": "finance analyst MY  ·  Excel + BI  ·  hybrid"}),
        ("content", ["2 - 4 YRS", "EXP"], ["Excel power user.", "1 BI tool (Power BI / Tableau)."]),
        ("content", ["FINTECH", "SCALE-UP"], ["Forecasting + variance + dashboards.", "Real ownership."]),
        ("content", ["NO CV", "FLOOD."], ["AI-matched top 3 only.", "Direct to CFO."]),
        ("cta", ["COMMENT", "HUNT.", "WE'LL DM YOU."], [1]),
    ],

    # Day 141 — Hiring Truth #25-27 (panel dynamics)
    "day141-hiring-truth-9": [
        ("method", {"banner": "PANEL DYNAMICS  ·  MY 2026",
                    "headline": ["HIRING", "TRUTHS", "#25 - #27", "THE REAL VOTE"],
                    "gold": ["#25", "THE REAL VOTE"],
                    "subline": "interview MY  ·  panel  ·  hiring"}),
        ("content", ["#25"], ["The HM has 70% of the decision", "made before the panel starts."]),
        ("content", ["#26"], ["The skeptic sets traps —", "pre-empt with 1 concrete example."]),
        ("content", ["#27"], ["The most junior interviewer's", "veto is the loudest."]),
        ("cta", ["READ", "THE ROOM.", "THEN WIN IT."], [1]),
    ],

    # Day 143 — Featured Role #11 (cloud engineer Selangor)
    "day143-featured-role-11": [
        ("method", {"banner": "CLOUD ENGINEER  ·  SELANGOR  ·  SaaS",
                    "headline": ["FEATURED", "ROLE #11", "RM9 - 14K", "AWS + IAC"],
                    "gold": ["#11", "RM9 - 14K"],
                    "subline": "cloud engineer MY  ·  AWS + Terraform  ·  hybrid"}),
        ("content", ["3+ YRS", "EXP"], ["AWS production.", "Terraform + CI/CD."]),
        ("content", ["OBSERVABILITY", "FIRST"], ["Logs + metrics + traces.", "Cost control matters."]),
        ("content", ["NO CV", "FLOOD."], ["AI-matched top 3.", "Direct to VP eng."]),
        ("cta", ["COMMENT", "HUNT.", "WE'LL DM YOU."], [1]),
    ],

    # Day 148 — Hidden Talent #7 (solo-parent comeback)
    "day148-hidden-talent-7": [
        ("method", {"banner": "HIDDEN TALENT  ·  MY 2026",
                    "headline": ["HIDDEN", "TALENT #7", "SOLO-PARENT", "COMEBACK"],
                    "gold": ["#7", "COMEBACK"],
                    "subline": "career break MY  ·  remote  ·  flex"}),
        ("content", ["4 YRS", "OFF-GRID"], ["Two kids.", "One sleepless night."]),
        ("content", ["DNJ", "MATCHED HER"], ["Women-led startup", "hiring remote ops manager."]),
        ("content", ["REAL FLEX.", "REAL PAY."], ["No 'family' lies.", "Just clear scope + comp."]),
        ("cta", ["GAPS AREN'T", "GAPS.", "CHAPTERS."], [1]),
    ],

    # Day 151 — Phase 5 best-of (Featured Roles open)
    "day151-phase5-bestof": [
        ("method", {"banner": "OPEN ROLES  ·  MY 2026",
                    "headline": ["PHASE 5", "BEST-OF", "6 ROLES", "STILL OPEN"],
                    "gold": ["6 ROLES"],
                    "subline": "open jobs MY  ·  AI matched  ·  2026"}),
        ("content", ["DATA + BACKEND"], ["Junior Data Analyst — KL", "Backend Engineer — Penang"]),
        ("content", ["DESIGN +", "MARKETING"], ["UX Designer — remote MY", "Marketing Manager — retail KL"]),
        ("content", ["FINANCE +", "CLOUD"], ["Finance Analyst — KL", "Cloud Engineer — Selangor"]),
        ("cta", ["COMMENT", "HUNT + ROLE.", "WE'LL DM YOU."], [1]),
    ],

    # === PHASE 6 ===

    # Day 153 — Hiring Truth #28-30 (comp edition)
    "day153-hiring-truth-10": [
        ("method", {"banner": "COMPENSATION LIES  ·  MY 2026",
                    "headline": ["HIRING", "TRUTHS", "#28 - #30", "COMP EDITION"],
                    "gold": ["#28", "COMP EDITION"],
                    "subline": "salary MY  ·  comp  ·  negotiation"}),
        ("content", ["#28"], ["Salary ranges have 30% spreads", "because they're testing the floor."]),
        ("content", ["#29"], ["If they ask your LAST salary —", "you already lost RM500-1.5K/month."]),
        ("content", ["#30"], ["'Benefits package' usually closes", "5% of the gap, not the gap."]),
        ("cta", ["READ", "BETWEEN", "THE NUMBERS."], [1]),
    ],

    # Day 158 — Featured Role #12 (healthcare ops Klang)
    "day158-featured-role-12": [
        ("method", {"banner": "HEALTHCARE OPS LEAD  ·  KLANG",
                    "headline": ["FEATURED", "ROLE #12", "RM7 - 11K", "HEALTHCARE"],
                    "gold": ["#12", "RM7 - 11K"],
                    "subline": "healthcare ops MY  ·  clinic / health-tech"}),
        ("content", ["4+ YRS", "EXP"], ["Clinic OR health-tech.", "Workflow + compliance."]),
        ("content", ["REAL", "OWNERSHIP"], ["P&L + roster + vendor.", "Not a paperwork role."]),
        ("content", ["NO CV", "FLOOD."], ["AI-matched top 3.", "Direct to COO."]),
        ("cta", ["COMMENT", "HUNT.", "WE'LL DM YOU."], [1]),
    ],

    # Day 160 — Hidden Talent #8 (back from career break)
    "day160-hidden-talent-8": [
        ("method", {"banner": "HIDDEN TALENT  ·  MY 2026",
                    "headline": ["HIDDEN", "TALENT #8", "BACK FROM", "2-YR BREAK"],
                    "gold": ["#8", "2-YR BREAK"],
                    "subline": "return to work MY  ·  career break  ·  rebuild"}),
        ("content", ["BURNOUT", "+ CAREGIVING"], ["The break was needed.", "Not a failure."]),
        ("content", ["QUIET", "REBUILD"], ["1 essay a week.", "1 conversation a week."]),
        ("content", ["DNJ", "MATCHED HER"], ["Media agency hiring", "part-time strategist."]),
        ("cta", ["BREAK ≠", "BROKEN.", "BUILT."], [1]),
    ],

    # Day 165 — Hiring Truth #31-33 (references)
    "day165-hiring-truth-11": [
        ("method", {"banner": "REFERENCE CHECK TRUTHS  ·  MY 2026",
                    "headline": ["HIRING", "TRUTHS", "#31 - #33", "REFERENCES"],
                    "gold": ["#31", "REFERENCES"],
                    "subline": "references MY  ·  hiring  ·  2026"}),
        ("content", ["#31"], ["Most HMs call 1 reference,", "not all 3. Pick your loudest fan."]),
        ("content", ["#32"], ["They listen for TONE,", "not content. Excited > polished."]),
        ("content", ["#33"], ["Back-channel reference asked?", "You've made the shortlist."]),
        ("cta", ["CURATE", "YOUR", "LOUDEST FAN."], [1]),
    ],

    # Day 167 — Career Reality #5 (manage up tax)
    "day167-career-reality-5": [
        ("method", {"banner": "MANAGE-UP TAX  ·  MY 2026",
                    "headline": ["CAREER", "REALITY #5", "MANAGING", "YOUR MANAGER"],
                    "gold": ["#5", "MANAGING"],
                    "subline": "manage up MY  ·  career  ·  2026"}),
        ("content", ["WRITTEN-ONLY", "DECISIONS"], ["If it's not in writing,", "it didn't happen."]),
        ("content", ["WEEKLY 1:1", "AGENDAS"], ["Always your agenda.", "Always sent before."]),
        ("content", ["SKIP-LEVEL", "COFFEES"], ["Your boss is not your", "only source of upward visibility."]),
        ("cta", ["YOU CAN'T", "OUT-WORK", "BAD MANAGEMENT."], [2]),
    ],

    # Day 172 — Featured Role #13 (edu-tech PM remote)
    "day172-featured-role-13": [
        ("method", {"banner": "EDU-TECH PM  ·  REMOTE MY  ·  TIER-1 VC",
                    "headline": ["FEATURED", "ROLE #13", "RM10 - 14K", "REMOTE MY"],
                    "gold": ["#13", "RM10 - 14K"],
                    "subline": "product manager MY  ·  edu-tech  ·  remote"}),
        ("content", ["4+ YRS", "PM EXP"], ["Edu OR B2C consumer.", "Owned at least 1 launch."]),
        ("content", ["TIER-1", "VC BACKED"], ["Real runway.", "Real ambition."]),
        ("content", ["NO CV", "FLOOD."], ["AI-matched top 3.", "Direct to CEO."]),
        ("cta", ["COMMENT", "HUNT.", "WE'LL DM YOU."], [1]),
    ],

    # Day 174 — Hidden Talent #9 (disability-led founder)
    "day174-hidden-talent-9": [
        ("method", {"banner": "HIDDEN TALENT  ·  MY 2026",
                    "headline": ["HIDDEN", "TALENT #9", "BORN DEAF.", "BUILT REMOTE."],
                    "gold": ["#9", "BUILT REMOTE."],
                    "subline": "disability MY  ·  founder  ·  remote ops"}),
        ("content", ["3 YEARS", "BUILDING"], ["Remote-first ops consultancy.", "Async-native by need."]),
        ("content", ["DNJ", "MATCHED HER"], ["5 fractional COO roles", "the year she chose to scale."]),
        ("content", ["DIFFERENT", "≠ LESS"], ["The constraint was the edge.", "Async was the moat."]),
        ("cta", ["YOUR EDGE", "MIGHT BE", "WHAT YOU HID."], [1]),
    ],

    # Day 179 — Hiring Truth #34-36 (post-pandemic)
    "day179-hiring-truth-12": [
        ("method", {"banner": "POST-PANDEMIC HIRING  ·  MY 2026",
                    "headline": ["HIRING", "TRUTHS", "#34 - #36", "REMOTE / HYBRID"],
                    "gold": ["#34", "REMOTE / HYBRID"],
                    "subline": "remote work MY  ·  hybrid  ·  2026"}),
        ("content", ["#34"], ["'Remote-friendly' is a lie", "at 60% of MY companies."]),
        ("content", ["#35"], ["RTO mandates kill retention", "before they kill productivity."]),
        ("content", ["#36"], ["Hybrid works — only if", "leadership commutes too."]),
        ("cta", ["ASK THE", "REAL", "QUESTIONS."], [1]),
    ],
}


# ---------- Phase 4-6 quotes ----------

QUOTES = [
    # === Phase 4 ===
    # Day 95 — loyalty rewarded last
    {"path": "q-day95-loyalty.png",
     "tag": "LOYALTY TRAP  ·  MY 2026",
     "resonance": ["8 YEARS LOYAL.", "4% RAISE.", "NEW HIRE +30%."],
     "reframe": ["LOYALTY IS", "REWARDED", "LAST."],
     "gold_index": 2, "brand": "DNJ  ·  MOVE FASTER THAN THE SYSTEM"},

    # Day 103 — being prepared
    {"path": "q-day103-prepared.png",
     "tag": "REJECTION TRUTH  ·  MY 2026",
     "resonance": ["27 NOs.", "ONE YES.", "THE RIGHT ONE."],
     "reframe": ["YOU WEREN'T PICKED.", "YOU'RE BEING", "PREPARED."],
     "gold_index": 2, "brand": "DNJ  ·  EVERY NO SHARPENS THE STORY"},

    # Day 110 — title borrowed
    {"path": "q-day110-title.png",
     "tag": "CAREER TRUTH  ·  MY 2026",
     "resonance": ["LOST THE TITLE", "WHEN I LEFT.", "KEPT THE SKILLS."],
     "reframe": ["A TITLE IS BORROWED.", "YOUR SKILLS", "AREN'T."],
     "gold_index": 2, "brand": "DNJ  ·  BUILD WHAT TRAVELS"},

    # Day 117 — skills travel
    {"path": "q-day117-skills.png",
     "tag": "BURNOUT TRUTH  ·  MY 2026",
     "resonance": ["NEW ROOM.", "OLD STORY.", "SAME FATIGUE."],
     "reframe": ["SKILLS TRAVEL.", "BURNOUT", "DOESN'T."],
     "gold_index": 2, "brand": "DNJ  ·  REST FIRST, REBUILD"},

    # === Phase 5 ===
    # Day 125 — algorithms vs humans
    {"path": "q-day125-algorithms.png",
     "tag": "HIRING TRUTH  ·  MY 2026",
     "resonance": ["NO BOTS SAW", "MY 12-MONTH", "REBUILD."],
     "reframe": ["ALGORITHMS DON'T", "SEE EFFORT.", "HUMANS DO."],
     "gold_index": 2, "brand": "DNJ  ·  AI SURFACES, HUMANS SHARPEN"},

    # Day 132 — match the room
    {"path": "q-day132-match.png",
     "tag": "CAREER TRUTH  ·  MY 2026",
     "resonance": ["I BEGGED 18 DOORS.", "ONE OPENED.", "ALL OF THEM CLOSED ANYWAY."],
     "reframe": ["MATCH THE ROOM.", "DON'T BEG", "THE DOOR."],
     "gold_index": 2, "brand": "DNJ  ·  RIGHT ROOM, RIGHT CUT"},

    # Day 139 — worth doesn't drop
    {"path": "q-day139-worth.png",
     "tag": "MARKET TRUTH  ·  MY 2026",
     "resonance": ["SLOW MARKET.", "QUIET MONTHS.", "I KEPT BUILDING."],
     "reframe": ["YOUR WORTH DOESN'T", "DROP IN A", "SLOW MARKET."],
     "gold_index": 2, "brand": "DNJ  ·  BUILD ANYWAY"},

    # Day 146 — right room right time right cut
    {"path": "q-day146-three.png",
     "tag": "DIAMOND TRUTH  ·  MY 2026",
     "resonance": ["GREAT BRAND.", "BAD TIMING.", "WRONG CUT."],
     "reframe": ["RIGHT ROOM.", "RIGHT TIME.", "RIGHT CUT."],
     "gold_index": 2, "brand": "DNJ  ·  THREE CONDITIONS"},

    # === Phase 6 ===
    # Day 157 — Saturday Quote #1 — some rooms reveal
    {"path": "q-day157-reveal.png",
     "tag": "SATURDAY QUOTE  ·  MY 2026",
     "resonance": ["ONE ROOM RATED ME.", "ANOTHER", "REVEALED ME."],
     "reframe": ["SOME ROOMS", "REVEAL YOU.", "MOST JUST RATE."],
     "gold_index": 1, "brand": "DNJ  ·  FIND THE REVEALING ROOM"},

    # Day 164 — Saturday Quote #2 — worth at offer
    {"path": "q-day164-worth-offer.png",
     "tag": "SATURDAY QUOTE  ·  MY 2026",
     "resonance": ["FIRST NUMBER.", "ONE COUNTER.", "RM1.5K BETWEEN US."],
     "reframe": ["WORTH IS FELT", "AT THE OFFER.", "CONFIRMED AT", "THE COUNTER."],
     "gold_index": 3, "brand": "DNJ  ·  ALWAYS COUNTER ONCE"},

    # Day 171 — Saturday Quote #3 — diamond never apologizes
    {"path": "q-day171-apologize.png",
     "tag": "SATURDAY QUOTE  ·  MY 2026",
     "resonance": ["SHARP CUT.", "VISIBLE FACETS.", "NO HIDING."],
     "reframe": ["A DIAMOND NEVER", "APOLOGIZES FOR", "THE CUT."],
     "gold_index": 2, "brand": "DNJ  ·  THE CUT IS THE PROOF"},

    # Day 178 — Saturday Quote #4 — talent finds the cut
    {"path": "q-day178-talent.png",
     "tag": "SATURDAY QUOTE  ·  MY 2026",
     "resonance": ["180 DAYS.", "DOZENS OF CUTS.", "ONE MOVEMENT."],
     "reframe": ["TALENT FINDS", "THE RIGHT CUT.", "EVENTUALLY."],
     "gold_index": 1, "brand": "DNJ  ·  HIDDEN TALENT MOVEMENT"},
]


# ---------- main ----------

if __name__ == "__main__":
    for slug, slides in CAROUSELS.items():
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

    for q in QUOTES:
        path = os.path.join(OUT_Q, q["path"])
        render_resonance_quote(path, tag=q["tag"],
                               resonance_lines=q["resonance"],
                               reframe_lines=q["reframe"],
                               gold_index=q["gold_index"],
                               brand_line=q["brand"])

    total = sum(len(s) for s in CAROUSELS.values()) + len(QUOTES)
    print(f"\nPhase 4-6 done: {len(CAROUSELS)} carousels + {len(QUOTES)} quotes = {total} images.")
