"""Framework-aligned cover regen for Day 34 carousel slide 1 + Day 39 quote.

Implements the Chalette/viral-framework-2026.md rules for VIRTUAL SERVICE covers:
  - Big text + at least one NUMBER in headline
  - Malaysia / 🇲🇾 keyword on cover
  - High-contrast accent block (red banner OR yellow strip OR white card) to break
    the dim black-gold mood
  - Resonance line on quotes (audience-said-yes line), then reframe in gold

Only overwrites:
  - carousels/day34-salary-negotiation-1.png (square 1080, matches slides 2-7)
  - quotes/q-day39-reveal.png (square 1080)
"""
import os
from PIL import Image, ImageDraw, ImageFont

ROOT = r"C:\Users\DC\Desktop\DestinOraclesSolution CRM\marketing\instagram\content"
OUT_CAR = os.path.join(ROOT, "carousels")
OUT_Q = os.path.join(ROOT, "quotes")

S = 1080
BLACK = (10, 10, 12); DEEP = (0, 0, 0)
GOLD = (212, 175, 55); GOLD_L = (244, 208, 100)
OFFWHITE = (240, 235, 220); GREY = (150, 150, 150)
RED = (210, 50, 60)           # high-contrast accent block

FONT_HEAD = r"C:\Windows\Fonts\ariblk.ttf"
FONT_BODY = r"C:\Windows\Fonts\arialbd.ttf"
FONT_REG = r"C:\Windows\Fonts\arial.ttf"


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


# ---------- Day 34 slide 1 — method pattern ----------
def render_day34_slide1(path):
    img = bg(); d = ImageDraw.Draw(img); border(d)

    # ACCENT — red banner top-left strip with the BIG NUMBER + Malaysia keyword
    banner_h = 110
    d.rectangle([46, 100, S-46, 100+banner_h], fill=RED)
    bf = ImageFont.truetype(FONT_HEAD, 56)
    banner_text = "+RM800/MO  ·  MALAYSIA  ·  2026"
    text_center(d, 100 + (banner_h-56)//2 - 6, banner_text, bf, OFFWHITE)

    # MAIN HEADLINE — large, numbered, search-optimized
    head = ["HOW TO", "NEGOTIATE", "+RM800/MO", "IN 5 MOVES"]
    sz = fit(head, 130, S-150, minf=70)
    f = ImageFont.truetype(FONT_HEAD, sz)
    step = int(sz*1.05)
    total = step*(len(head)-1)+sz
    sy = 320
    for i, ln in enumerate(head):
        col = GOLD if "RM800" in ln else OFFWHITE
        text_center(d, sy+i*step, ln, f, col)

    # SUBLINE — niche search keyword
    sub = "salary tips · fresh grad · Malaysia"
    sf = ImageFont.truetype(FONT_BODY, 38)
    text_center(d, sy+total+30, sub, sf, GREY)

    # CTA strip — save before next offer
    diamond(d, S//2, S-180, 30, GOLD, 3)
    sw_f = ImageFont.truetype(FONT_BODY, 30)
    text_center(d, S-120, "SAVE  ·  SWIPE  ->", sw_f, GOLD_L)

    img.save(path, "PNG", optimize=True)
    print(f"OK -> {path}")


# ---------- Day 39 quote — resonance pattern ----------
def render_day39_quote(path):
    img = bg(); d = ImageDraw.Draw(img); border(d)

    # ACCENT — small yellow tag (top-left) labeling the post
    tag_text = "HIRING TRUTH · 2026"
    tagf = ImageFont.truetype(FONT_BODY, 26)
    bb = d.textbbox((0, 0), tag_text, font=tagf)
    tag_w = bb[2]-bb[0] + 36
    tag_h = 48
    d.rectangle([80, 110, 80+tag_w, 110+tag_h], fill=GOLD)
    d.text((98, 110+(tag_h-26)//2 - 2), tag_text, fill=BLACK, font=tagf)

    # OPENING quote mark (gold, big serif)
    qf = ImageFont.truetype(FONT_HEAD, 130)
    d.text((90, 175), '"', fill=GOLD, font=qf)

    # RESONANCE LINE (offwhite, mid) — compact 3 lines
    res = ["I SENT 73 RESUMES.", "THEY NEVER", "MET ME."]
    rsz = fit(res, 80, S-200, minf=50)
    rf = ImageFont.truetype(FONT_HEAD, rsz)
    rstep = int(rsz*1.06)
    ry = 330
    for i, ln in enumerate(res):
        text_center(d, ry+i*rstep, ln, rf, OFFWHITE)

    # REFRAME LINE (gold, the punch) — compact 3 lines
    re_lines = ["GREAT COMPANIES", "DON'T FIND TALENT.", "THEY REVEAL IT."]
    rfsz = fit(re_lines, 62, S-200, minf=40)
    rff = ImageFont.truetype(FONT_HEAD, rfsz)
    rfstep = int(rfsz*1.06)
    rfy = ry + rstep*len(res) + 50
    for i, ln in enumerate(re_lines):
        col = GOLD if i == 2 else GOLD_L
        text_center(d, rfy+i*rfstep, ln, rff, col)

    # OUTCOME / brand strip — NO diamond (it overlapped text), text-only
    of = ImageFont.truetype(FONT_HEAD, 36)
    text_center(d, S-140, "DNJ  ·  AI FINDS YOUR TOP 3", of, OFFWHITE)
    uf = ImageFont.truetype(FONT_BODY, 24)
    text_center(d, S-85, "diamondandjeweler.com  ·  Malaysia", uf, GREY)

    img.save(path, "PNG", optimize=True)
    print(f"OK -> {path}")


# ---------- Day 44 slide 1 — career reality (method pattern) ----------
def render_day44_slide1(path):
    img = bg(); d = ImageDraw.Draw(img); border(d)

    # ACCENT — red banner top with stat-style hook
    banner_h = 110
    d.rectangle([46, 100, S-46, 100+banner_h], fill=RED)
    # auto-fit banner to width
    banner_text = "70% OF GRADS GET GHOSTED  ·  MY 2026"
    bsz = 50
    while bsz > 28:
        bf = ImageFont.truetype(FONT_HEAD, bsz)
        bb = d.textbbox((0, 0), banner_text, font=bf)
        if bb[2]-bb[0] <= S-160:
            break
        bsz -= 2
    text_center(d, 100 + (banner_h-bsz)//2 - 4, banner_text, bf, OFFWHITE)

    # MAIN HEADLINE — career reality, numbered
    head = ["CAREER", "REALITY", "#1 — THE", "GHOST WALL"]
    sz = fit(head, 130, S-150, minf=80)
    f = ImageFont.truetype(FONT_HEAD, sz)
    step = int(sz*1.05)
    total = step*(len(head)-1)+sz
    sy = 320
    for i, ln in enumerate(head):
        col = GOLD if "GHOST" in ln else OFFWHITE
        text_center(d, sy+i*step, ln, f, col)

    # SUBLINE — niche search keyword (compact)
    sub = "ghosted by recruiter  ·  cari kerja  ·  MY"
    sf = ImageFont.truetype(FONT_BODY, 30)
    text_center(d, sy+total+50, sub, sf, GREY)

    # CTA strip
    sw_f = ImageFont.truetype(FONT_BODY, 30)
    text_center(d, S-110, "SAVE  ·  SWIPE  ->", sw_f, GOLD_L)

    img.save(path, "PNG", optimize=True)
    print(f"OK -> {path}")


# ---------- Day 46 quote — resonance pattern ----------
def render_day46_quote(path):
    img = bg(); d = ImageDraw.Draw(img); border(d)

    # ACCENT — small yellow tag (top-left)
    tag_text = "DIAMOND TRUTH  ·  MY 2026"
    tagf = ImageFont.truetype(FONT_BODY, 26)
    bb = d.textbbox((0, 0), tag_text, font=tagf)
    tag_w = bb[2]-bb[0] + 36
    tag_h = 48
    d.rectangle([80, 110, 80+tag_w, 110+tag_h], fill=GOLD)
    d.text((98, 110+(tag_h-26)//2 - 2), tag_text, fill=BLACK, font=tagf)

    # OPENING quote mark
    qf = ImageFont.truetype(FONT_HEAD, 130)
    d.text((90, 175), '"', fill=GOLD, font=qf)

    # RESONANCE LINE (offwhite) — the felt experience
    res = ["I FELT INVISIBLE", "FOR 11 MONTHS.", "0 OFFERS."]
    rsz = fit(res, 80, S-200, minf=50)
    rf = ImageFont.truetype(FONT_HEAD, rsz)
    rstep = int(rsz*1.06)
    ry = 330
    for i, ln in enumerate(res):
        text_center(d, ry+i*rstep, ln, rf, OFFWHITE)

    # REFRAME LINE (gold) — the reveal
    re_lines = ["EVERYONE IS", "A DIAMOND.", "YOU JUST NEED", "THE RIGHT CUT."]
    rfsz = fit(re_lines, 58, S-200, minf=38)
    rff = ImageFont.truetype(FONT_HEAD, rfsz)
    rfstep = int(rfsz*1.04)
    rfy = ry + rstep*len(res) + 40
    for i, ln in enumerate(re_lines):
        col = GOLD if i == 3 else GOLD_L
        text_center(d, rfy+i*rfstep, ln, rff, col)

    # OUTCOME / brand strip — text-only
    of = ImageFont.truetype(FONT_HEAD, 36)
    text_center(d, S-140, "DNJ  ·  AI FINDS YOUR TOP 3", of, OFFWHITE)
    uf = ImageFont.truetype(FONT_BODY, 24)
    text_center(d, S-85, "diamondandjeweler.com  ·  Malaysia", uf, GREY)

    img.save(path, "PNG", optimize=True)
    print(f"OK -> {path}")


if __name__ == "__main__":
    render_day34_slide1(os.path.join(OUT_CAR, "day34-salary-negotiation-1.png"))
    render_day39_quote(os.path.join(OUT_Q, "q-day39-reveal.png"))
    render_day44_slide1(os.path.join(OUT_CAR, "day44-career-reality-1.png"))
    render_day46_quote(os.path.join(OUT_Q, "q-day46-cut.png"))
    print("\nFramework-aligned covers regenerated.")
