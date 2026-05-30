"""Phase 3 (Days 61-91) asset renderer — DNJ Instagram.

Renders all carousel + quote covers for Phase 3 of the 180-day plan
using the Chalette/viral-framework-2026 rules:
  - Method pattern for carousel slide 1 (red accent banner + numbered headline + Malaysia keyword)
  - Resonance pattern for quotes (audience-said-yes line + gold reframe + outcome strip)
  - Content slides (2+) use the same black/gold layout as make_carousels.py

Output:
  carousels/day62-hiring-truth-2-{1..5}.png   (Hiring Truth #4-6)
  carousels/day67-career-reality-2-{1..5}.png (Career Reality #2 unpaid internship)
  carousels/day69-hiring-truth-3-{1..5}.png   (Hiring Truth #7-9 silent killers)
  carousels/day74-hidden-talent-2-{1..5}.png  (Hidden Talent #2 engineer)
  carousels/day76-hiring-truth-4-{1..5}.png   (Hiring Truth #10-12 recruiter side)
  carousels/day81-featured-role-5-{1..5}.png  (HR-side Featured Role)
  carousels/day83-career-reality-3-{1..5}.png (Career Reality #3 overworked)
  carousels/day88-hiring-truth-5-{1..5}.png   (Hiring Truth #13-15 offer games)
  carousels/day90-phase3-wrap-{1..7}.png      (Phase 3 wrap — 30 truths)
  quotes/q-day65-room.png
  quotes/q-day72-wrong-room.png
  quotes/q-day79-quiet.png
  quotes/q-day86-boring.png
"""
import os
from PIL import Image, ImageDraw, ImageFont

ROOT = r"C:\Users\DC\Desktop\DestinOraclesSolution CRM\marketing\instagram\content"
OUT_CAR = os.path.join(ROOT, "carousels")
OUT_Q = os.path.join(ROOT, "quotes")
os.makedirs(OUT_CAR, exist_ok=True)
os.makedirs(OUT_Q, exist_ok=True)

S = 1080
BLACK = (10, 10, 12); DEEP = (0, 0, 0)
GOLD = (212, 175, 55); GOLD_L = (244, 208, 100)
OFFWHITE = (240, 235, 220); GREY = (150, 150, 150)
RED = (210, 50, 60)

FONT_HEAD = r"C:\Windows\Fonts\ariblk.ttf"
FONT_BODY = r"C:\Windows\Fonts\arialbd.ttf"
FONT_REG = r"C:\Windows\Fonts\arial.ttf"


# ---------- shared helpers ----------

def bg():
    img = Image.new("RGB", (S, S), BLACK); d = ImageDraw.Draw(img)
    for i in range(S):
        t = i/(S-1)
        d.line([(0, i), (S, i)], fill=(int(BLACK[0]*(1-t)+DEEP[0]*t),
                                       int(BLACK[1]*(1-t)+DEEP[1]*t),
                                       int(BLACK[2]*(1-t)+DEEP[2]*t)))
    return img


def border(d):
    d.rectangle([46, 46, S-46, S-46], outline=GOLD, width=3)


def diamond(d, cx, cy, sz, col, w=3):
    p = [(cx, cy-sz), (cx+sz*0.85, cy), (cx, cy+sz), (cx-sz*0.85, cy)]
    for i in range(4):
        d.line([p[i], p[(i+1) % 4]], fill=col, width=w)
    d.line([(cx-sz*0.85, cy), (cx+sz*0.85, cy)], fill=col, width=2)
    d.line([(cx, cy-sz), (cx, cy+sz)], fill=col, width=2)


def fit(lines, maxf, maxw, fp=FONT_HEAD, minf=22):
    s = maxf
    im = Image.new("RGB", (10, 10)); d = ImageDraw.Draw(im)
    while s > minf:
        f = ImageFont.truetype(fp, s)
        if max(d.textbbox((0, 0), ln, font=f)[2] for ln in lines) <= maxw:
            return s
        s -= 3
    return s


def text_center(d, y, text, font, fill):
    bb = d.textbbox((0, 0), text, font=font)
    d.text(((S-(bb[2]-bb[0]))/2-bb[0], y), text, fill=fill, font=font)


def wrap(text, font, maxw, draw):
    words = text.split()
    lines, cur = [], ""
    for w in words:
        test = (cur + " " + w).strip()
        if draw.textbbox((0, 0), test, font=font)[2] <= maxw:
            cur = test
        else:
            if cur:
                lines.append(cur)
            cur = w
    if cur:
        lines.append(cur)
    return lines


# ---------- generic renderers ----------

def render_method_slide1(path, banner, headline, gold_words, subline):
    """Framework-style carousel slide 1: red accent banner + numbered headline + subline."""
    img = bg(); d = ImageDraw.Draw(img); border(d)

    # Red banner
    banner_h = 110
    d.rectangle([46, 100, S-46, 100+banner_h], fill=RED)
    bsz = 56
    while bsz > 28:
        bf = ImageFont.truetype(FONT_HEAD, bsz)
        bb = d.textbbox((0, 0), banner, font=bf)
        if bb[2]-bb[0] <= S-160:
            break
        bsz -= 2
    text_center(d, 100 + (banner_h-bsz)//2 - 4, banner, bf, OFFWHITE)

    # Headline
    sz = fit(headline, 130, S-150, minf=70)
    f = ImageFont.truetype(FONT_HEAD, sz)
    step = int(sz*1.05)
    total = step*(len(headline)-1)+sz
    sy = 320
    for i, ln in enumerate(headline):
        col = GOLD if any(g.upper() in ln for g in gold_words) else OFFWHITE
        text_center(d, sy+i*step, ln, f, col)

    # Subline
    if subline:
        sf = ImageFont.truetype(FONT_BODY, 32)
        text_center(d, sy+total+40, subline, sf, GREY)

    # CTA strip
    sw_f = ImageFont.truetype(FONT_BODY, 30)
    text_center(d, S-110, "SAVE  ·  SWIPE  ->", sw_f, GOLD_L)

    img.save(path, "PNG", optimize=True)
    print(f"OK -> {os.path.basename(path)}")


def render_content_slide(path, head_lines, body_lines):
    """Carousel content slide: big gold heading + offwhite body."""
    img = bg(); d = ImageDraw.Draw(img); border(d)

    hsz = fit(head_lines, 96, S-150, minf=44)
    hf = ImageFont.truetype(FONT_HEAD, hsz)
    hstep = int(hsz*1.08)
    htotal = hstep*(len(head_lines)-1)+hsz
    hy = 220
    for i, ln in enumerate(head_lines):
        text_center(d, hy+i*hstep, ln, hf, GOLD)

    if body_lines:
        bf = ImageFont.truetype(FONT_BODY, 42)
        wrapped = []
        for para in body_lines:
            wrapped += wrap(para, bf, S-200, d)
        bstep = 58
        by = hy + htotal + 70
        for i, ln in enumerate(wrapped):
            text_center(d, by+i*bstep, ln, bf, OFFWHITE)

    img.save(path, "PNG", optimize=True)
    print(f"OK -> {os.path.basename(path)}")


def render_cta_slide(path, lines, gold_indices):
    """Carousel final slide: big punch + diamond + D&J + URL."""
    img = bg(); d = ImageDraw.Draw(img); border(d)
    sz = fit(lines, 84, S-160, minf=42)
    f = ImageFont.truetype(FONT_HEAD, sz)
    step = int(sz*1.1)
    total = step*(len(lines)-1)+sz
    sy = (S-total)/2 - 120
    for i, ln in enumerate(lines):
        col = GOLD if i in gold_indices else OFFWHITE
        text_center(d, sy+i*step, ln, f, col)
    diamond(d, S//2, S-280, 36, GOLD, 4)
    bf = ImageFont.truetype(FONT_HEAD, 80)
    text_center(d, S-200, "D&J", bf, GOLD)
    uf = ImageFont.truetype(FONT_BODY, 30)
    text_center(d, S-95, "diamondandjeweler.com", uf, OFFWHITE)
    img.save(path, "PNG", optimize=True)
    print(f"OK -> {os.path.basename(path)}")


def render_resonance_quote(path, tag, resonance_lines, reframe_lines, gold_index, brand_line):
    """Framework-style quote: yellow tag + resonance (offwhite) + reframe (gold) + brand strip."""
    img = bg(); d = ImageDraw.Draw(img); border(d)

    # Yellow tag
    tagf = ImageFont.truetype(FONT_BODY, 26)
    bb = d.textbbox((0, 0), tag, font=tagf)
    tag_w = bb[2]-bb[0] + 36
    tag_h = 48
    d.rectangle([80, 110, 80+tag_w, 110+tag_h], fill=GOLD)
    d.text((98, 110+(tag_h-26)//2 - 2), tag, fill=BLACK, font=tagf)

    # Quote mark
    qf = ImageFont.truetype(FONT_HEAD, 130)
    d.text((90, 175), '"', fill=GOLD, font=qf)

    # Resonance (offwhite)
    rsz = fit(resonance_lines, 80, S-200, minf=44)
    rf = ImageFont.truetype(FONT_HEAD, rsz)
    rstep = int(rsz*1.06)
    ry = 330
    for i, ln in enumerate(resonance_lines):
        text_center(d, ry+i*rstep, ln, rf, OFFWHITE)

    # Reframe (gold)
    rfsz = fit(reframe_lines, 62, S-200, minf=38)
    rff = ImageFont.truetype(FONT_HEAD, rfsz)
    rfstep = int(rfsz*1.06)
    rfy = ry + rstep*len(resonance_lines) + 50
    for i, ln in enumerate(reframe_lines):
        col = GOLD if i == gold_index else GOLD_L
        text_center(d, rfy+i*rfstep, ln, rff, col)

    # Brand strip
    of = ImageFont.truetype(FONT_HEAD, 36)
    text_center(d, S-140, brand_line, of, OFFWHITE)
    uf = ImageFont.truetype(FONT_BODY, 24)
    text_center(d, S-85, "diamondandjeweler.com  ·  Malaysia", uf, GREY)

    img.save(path, "PNG", optimize=True)
    print(f"OK -> {os.path.basename(path)}")


# ---------- Phase 3 carousel definitions ----------

CAROUSELS = {
    # Day 62 — Hiring Truth #4-6 (manager bias edition)
    "day62-hiring-truth-2": [
        ("method", {
            "banner": "3 BIASES MOST HMs WON'T ADMIT  ·  MY",
            "headline": ["HIRING", "TRUTHS", "#4 - #6", "MANAGER BIAS"],
            "gold": ["#4", "BIAS"],
            "subline": "hiring bias  ·  recruitment MY  ·  2026",
        }),
        ("content", ["#4"], ["Most 'culture fit' rejections", "are just bias in disguise."]),
        ("content", ["#5"], ["The panel votes on confidence.", "Not capability."]),
        ("content", ["#6"], ["Your network beats your CV.", "Unfair — but true."]),
        ("cta", ["DNJ MATCHES", "ON FIT.", "NOT BIAS."], [1]),
    ],

    # Day 67 — Career Reality #2 — unpaid internship trap
    "day67-career-reality-2": [
        ("method", {
            "banner": "1 IN 4 MY INTERNS GET NO OFFER",
            "headline": ["CAREER", "REALITY #2", "THE UNPAID", "TRAP"],
            "gold": ["UNPAID", "TRAP"],
            "subline": "internship MY  ·  fresh grad  ·  2026",
        }),
        ("content", ["NO LEARNING", "PLAN?"], ["You're not training.", "You're free labor."]),
        ("content", ["NO PATHWAY", "TO HIRE?"], ["You're the spare hand.", "Not the future hire."]),
        ("content", ["DOING", "BILLABLE WORK?"], ["You're earning the company money.", "They should pay you."]),
        ("cta", ["YOUR TIME", "IS WORTH", "MORE."], [1]),
    ],

    # Day 69 — Hiring Truth #7-9 (silent killers)
    "day69-hiring-truth-3": [
        ("method", {
            "banner": "3 SILENT KILLERS IN MY HIRING",
            "headline": ["HIRING", "TRUTHS", "#7 - #9", "THE SILENT"],
            "gold": ["#7", "SILENT"],
            "subline": "interview tips MY  ·  recruitment  ·  2026",
        }),
        ("content", ["#7"], ["'Open' requisitions", "are sometimes already filled."]),
        ("content", ["#8"], ["Most salary ranges are 30%", "above what they'll actually pay."]),
        ("content", ["#9"], ["The interviewer's mood decides", "more than your answers."]),
        ("cta", ["KNOW THE", "GAME.", "PLAY IT BETTER."], [1]),
    ],

    # Day 74 — Hidden Talent #2 — overlooked engineer story
    "day74-hidden-talent-2": [
        ("method", {
            "banner": "HIDDEN TALENT  ·  MY 2026",
            "headline": ["HIDDEN", "TALENT #2", "THE OVERLOOKED", "ENGINEER"],
            "gold": ["#2", "ENGINEER"],
            "subline": "QA  ·  backend  ·  +40% raise in 6 weeks",
        }),
        ("content", ["4 YEARS", "IN QA"], ["Passed over for", "3 promotions in a row."]),
        ("content", ["FELT", "INVISIBLE"], ["Started doubting whether", "talent even matters."]),
        ("content", ["THEN —", "ONE MATCH"], ["DNJ matched him to a", "senior backend role."]),
        ("content", ["6 WEEKS", "LATER"], ["Lead engineer.", "40% raise. New chapter."]),
        ("cta", ["EVERYONE IS", "A DIAMOND.", "YOUR TURN?"], [1]),
    ],

    # Day 76 — Hiring Truth #10-12 (recruiter side)
    "day76-hiring-truth-4": [
        ("method", {
            "banner": "INSIDE THE RECRUITER MIND  ·  MY",
            "headline": ["HIRING", "TRUTHS", "#10 - #12", "RECRUITER"],
            "gold": ["#10", "RECRUITER"],
            "subline": "recruiter MY  ·  hiring tips  ·  2026",
        }),
        ("content", ["#10"], ["They're bonused on time-to-fill.", "Not fit."]),
        ("content", ["#11"], ["They paste your CV", "into 4 other roles silently."]),
        ("content", ["#12"], ["No reply in 5 days?", "Follow up — the role moved on."]),
        ("cta", ["DON'T TRUST.", "VERIFY."], [1]),
    ],

    # Day 81 — Featured Role #5 (HR-side)
    "day81-featured-role-5": [
        ("method", {
            "banner": "FOR HIRING MANAGERS  ·  MY 2026",
            "headline": ["YOUR TOP 3", "CANDIDATES", "IN 48", "HOURS"],
            "gold": ["TOP 3", "48"],
            "subline": "AI hiring  ·  recruitment MY  ·  free first 3",
        }),
        ("content", ["STOP READING", "200 CVs"], ["For one open role.", "There's a faster way."]),
        ("content", ["AI MATCHES", "ON 3 LAYERS"], ["Skills  ·  culture fit  ·", "salary expectation."]),
        ("content", ["NO CARD.", "NO FLOOD."], ["First 3 candidates — free.", "48-hour turnaround."]),
        ("cta", ["COMMENT", "HIRE.", "WE'LL DM YOU."], [1]),
    ],

    # Day 83 — Career Reality #3 — overworked + underpaid
    "day83-career-reality-3": [
        ("method", {
            "banner": "OVERWORKED + UNDERPAID  ·  MY 2026",
            "headline": ["CAREER", "REALITY #3", "1.5 JOBS,", "1 PAYCHECK"],
            "gold": ["1.5", "1 PAYCHECK"],
            "subline": "burnout MY  ·  career  ·  fresh grad",
        }),
        ("content", ["NO LEARNING.", "NO PEERS."], ["Nobody to grow with.", "Nobody to learn from."]),
        ("content", ["NO PATH.", "NO PROOF."], ["No promotion. No review.", "No metric they care about."]),
        ("content", ["LOYALTY OVER", "PERFORMANCE"], ["You stay. They underpay.", "The market keeps moving."]),
        ("cta", ["CHECK", "THE ROOM.", "NOT YOURSELF."], [1]),
    ],

    # Day 88 — Hiring Truth #13-15 (offer-stage games)
    "day88-hiring-truth-5": [
        ("method", {
            "banner": "OFFER-STAGE GAMES  ·  MY 2026",
            "headline": ["HIRING", "TRUTHS", "#13 - #15", "OFFER GAMES"],
            "gold": ["#13", "OFFER"],
            "subline": "negotiation MY  ·  hiring  ·  2026",
        }),
        ("content", ["#13"], ["'Contract by Friday'.", "Then radio silence."]),
        ("content", ["#14"], ["'This is our final number'.", "Except for the 12 they counter."]),
        ("content", ["#15"], ["'Sign by Monday or we move on'.", "Fake urgency 80% of the time."]),
        ("cta", ["READ THE", "ROOM.", "THEN SIGN."], [1]),
    ],

    # Day 90 — Phase 3 wrap — 30 truths in 1 swipe
    "day90-phase3-wrap": [
        ("method", {
            "banner": "30 HIRING TRUTHS  ·  MY 2026",
            "headline": ["30 TRUTHS", "EVERY MY", "JOB SEEKER", "MUST KNOW"],
            "gold": ["30 TRUTHS"],
            "subline": "the Phase 3 best-of  ·  save + share",
        }),
        ("content", ["TRUTHS", "#1 - #6"], ["Confidence > capability.", "Network > CV. Bias is real."]),
        ("content", ["TRUTHS", "#7 - #12"], ["Silent killers + recruiter", "incentives nobody admits."]),
        ("content", ["TRUTHS", "#13 - #18"], ["Offer-stage games + notice-period", "tricks managers play."]),
        ("content", ["TRUTHS", "#19 - #24"], ["Panel bias + HM-side ghosting", "+ comp games."]),
        ("content", ["TRUTHS", "#25 - #30"], ["Panel dynamics + post-pandemic", "+ reference reality."]),
        ("cta", ["SAVE.", "SHARE.", "RESHAPE THE GAME."], [2]),
    ],
}


# ---------- Phase 3 quote definitions ----------

QUOTES = [
    # Day 65 — "Room shapes the offer"
    {
        "path": "q-day65-room.png",
        "tag": "ROOM TRUTH  ·  MY 2026",
        "resonance": ["I JOINED FOR", "THE BRAND.", "LOST ON THE COMP."],
        "reframe": ["THE ROOM", "YOU'RE IN", "SHAPES THE OFFER", "YOU GET."],
        "gold_index": 3,
        "brand": "DNJ  ·  RIGHT ROOM, RIGHT CUT",
    },
    # Day 72 — "Wrong room more than once"
    {
        "path": "q-day72-wrong-room.png",
        "tag": "CAREER TRUTH  ·  MY 2026",
        "resonance": ["I QUIT THE", "PERFECT JOB.", "TWICE."],
        "reframe": ["TALENT FINDS", "THE WRONG ROOM", "MORE THAN ONCE."],
        "gold_index": 2,
        "brand": "DNJ  ·  AI FINDS YOUR TOP 3",
    },
    # Day 79 — "Quiet ≠ unqualified"
    {
        "path": "q-day79-quiet.png",
        "tag": "HIDDEN TALENT  ·  MY 2026",
        "resonance": ["I WAS THE", "QUIET ONE.", "PROMOTED LAST."],
        "reframe": ["QUIET", "DOESN'T MEAN", "UNQUALIFIED."],
        "gold_index": 2,
        "brand": "DNJ  ·  EVERY DIAMOND COUNTS",
    },
    # Day 86 — "Right offer feels boring"
    {
        "path": "q-day86-boring.png",
        "tag": "OFFER TRUTH  ·  MY 2026",
        "resonance": ["MY LOUDEST OFFER", "UNDERDELIVERED.", "EVERY TIME."],
        "reframe": ["THE RIGHT OFFER", "FEELS BORING.", "NOT MAGICAL."],
        "gold_index": 2,
        "brand": "DNJ  ·  TRUST THE CALM",
    },
]


# ---------- main ----------

if __name__ == "__main__":
    # Carousels
    for slug, slides in CAROUSELS.items():
        for i, sl in enumerate(slides, 1):
            path = os.path.join(OUT_CAR, f"{slug}-{i}.png")
            kind = sl[0]
            if kind == "method":
                cfg = sl[1]
                render_method_slide1(path,
                                     banner=cfg["banner"],
                                     headline=cfg["headline"],
                                     gold_words=cfg["gold"],
                                     subline=cfg["subline"])
            elif kind == "content":
                render_content_slide(path, head_lines=sl[1], body_lines=sl[2])
            elif kind == "cta":
                render_cta_slide(path, lines=sl[1], gold_indices=sl[2])

    # Quotes
    for q in QUOTES:
        path = os.path.join(OUT_Q, q["path"])
        render_resonance_quote(path,
                               tag=q["tag"],
                               resonance_lines=q["resonance"],
                               reframe_lines=q["reframe"],
                               gold_index=q["gold_index"],
                               brand_line=q["brand"])

    total = sum(len(s) for s in CAROUSELS.values()) + len(QUOTES)
    print(f"\nPhase 3 done: {len(CAROUSELS)} carousels + {len(QUOTES)} quotes = {total} images.")
