"""Batch-generate DNJ TikTok (Melayu) visual assets — 9:16 black + gold brand.

Outputs:
  hari1-thumbnail.png         — Hari 1 hook thumbnail (also usable as Reel cover)
  end-frame.png               — 3s end-frame template for every video
  profile-cover.png           — TikTok profile background cover
  hari4-slide{1..5}.png       — Slideshow: 3 ayat untuk "Ceritakan tentang diri anda"
  hari10-slide{1..6}.png      — Slideshow: 5 red flag iklan kerja
  hari17-slide{1..6}.png      — Slideshow: 5 tanda kau underpaid
  hari22-slide{1..7}.png      — Slideshow: 7 ayat negotiate gaji

All cards: 1080x1920 (TikTok native), black background, gold accent border + diamond,
big bold white headlines with gold emphasis lines, brand footer.
"""
import os
from PIL import Image, ImageDraw, ImageFont

OUT = r"C:\Users\DC\Desktop\DestinOraclesSolution CRM\marketing\tiktok-malay\content"
os.makedirs(OUT, exist_ok=True)

# Canvas
W, H = 1080, 1920

# Brand palette (matches IG quote-card kit)
BLACK = (10, 10, 12)
DEEP_BLACK = (0, 0, 0)
GOLD = (212, 175, 55)
GOLD_LIGHT = (244, 208, 100)
HOT_GOLD = (255, 200, 60)   # v2: brighter accent for hook punch lines + hero numbers
HOT_RED = (235, 75, 75)     # v2: for red-flag emphasis (Hari 10)
OFFWHITE = (240, 235, 220)

# Fonts (Windows)
FONT_HEAD = r"C:\Windows\Fonts\ariblk.ttf"   # Arial Black (heaviest)
FONT_BODY = r"C:\Windows\Fonts\arialbd.ttf"  # Arial Bold
FONT_SERIF = r"C:\Windows\Fonts\timesbd.ttf" # Times Bold (for quote mark)


def gradient_bg():
    """Soft vertical gradient black → deeper black (subtle dramatic feel)."""
    img = Image.new("RGB", (W, H), BLACK)
    d = ImageDraw.Draw(img)
    for i in range(H):
        t = i / (H - 1)
        col = (int(BLACK[0]*(1-t)+DEEP_BLACK[0]*t),
               int(BLACK[1]*(1-t)+DEEP_BLACK[1]*t),
               int(BLACK[2]*(1-t)+DEEP_BLACK[2]*t))
        d.line([(0, i), (W, i)], fill=col)
    return img


def diamond(d, cx, cy, sz, col, w=4):
    p = [(cx, cy-sz), (cx+sz*0.85, cy), (cx, cy+sz), (cx-sz*0.85, cy)]
    for i in range(4):
        d.line([p[i], p[(i+1) % 4]], fill=col, width=w)
    d.line([(cx-sz*0.85, cy), (cx+sz*0.85, cy)], fill=col, width=2)
    d.line([(cx, cy-sz), (cx, cy+sz)], fill=col, width=2)


def fit_size(lines, max_size, max_w, font_path=FONT_HEAD):
    """Find largest font size that fits all lines within max_w."""
    s = max_size
    tmp = Image.new("RGB", (10, 10))
    td = ImageDraw.Draw(tmp)
    while s > 24:
        f = ImageFont.truetype(font_path, s)
        if max(td.textbbox((0, 0), ln, font=f)[2] for ln in lines) <= max_w:
            return s
        s -= 4
    return s


def wrap_text(text, font, max_w, draw):
    """Word-wrap a string to max_w."""
    words = text.split()
    lines = []
    cur = ""
    for w in words:
        test = (cur + " " + w).strip()
        if draw.textbbox((0, 0), test, font=font)[2] <= max_w:
            cur = test
        else:
            if cur:
                lines.append(cur)
            cur = w
    if cur:
        lines.append(cur)
    return lines


def draw_border(d, color=GOLD, width=4, margin=48):
    """Gold rectangular border with subtle inset."""
    d.rectangle([margin, margin, W-margin, H-margin], outline=color, width=width)


def draw_footer(d, tagline="Setiap orang permata"):
    """Diamond divider + DNJ wordmark + URL at bottom of card."""
    cy = H - 260
    diamond(d, W//2, cy, 34, GOLD, 3)

    # DNJ wordmark
    f_brand = ImageFont.truetype(FONT_HEAD, 64)
    bb = d.textbbox((0, 0), "DNJ", font=f_brand)
    d.text(((W-(bb[2]-bb[0]))/2 - bb[0], H-200), "DNJ", fill=GOLD, font=f_brand)

    # URL
    f_url = ImageFont.truetype(FONT_BODY, 30)
    url = "diamondandjeweler.com"
    bb = d.textbbox((0, 0), url, font=f_url)
    d.text(((W-(bb[2]-bb[0]))/2 - bb[0], H-122), url, fill=OFFWHITE, font=f_url)

    # Tagline
    f_tag = ImageFont.truetype(FONT_BODY, 24)
    bb = d.textbbox((0, 0), tagline, font=f_tag)
    d.text(((W-(bb[2]-bb[0]))/2 - bb[0], H-80), tagline, fill=(180, 180, 180), font=f_tag)


def make_text_card(filename, lines, gold_idx=None, top_label=None, save_hint=False,
                   tagline="Setiap orang permata"):
    """Generic centered-text card.

    lines      : list[str] body lines
    gold_idx   : list[int] indices to highlight in gold
    top_label  : optional small uppercase label at top (e.g. "TIPS · INTERVIEW")
    save_hint  : if True, adds "SAVE 📌" footer cue above brand
    """
    gold_idx = gold_idx or []
    img = gradient_bg()
    d = ImageDraw.Draw(img)
    draw_border(d)

    # Opening quote mark (decorative, top-left, only on title/quote cards)
    if top_label is None:
        qf = ImageFont.truetype(FONT_SERIF, 260)
        d.text((90, 80), '"', fill=GOLD, font=qf)

    # Top label
    if top_label:
        lf = ImageFont.truetype(FONT_BODY, 34)
        bb = d.textbbox((0, 0), top_label, font=lf)
        d.text(((W-(bb[2]-bb[0]))/2 - bb[0], 130), top_label, fill=GOLD, font=lf)

    # Body — fit to width
    size = fit_size(lines, 124, W - 200, FONT_HEAD)
    f = ImageFont.truetype(FONT_HEAD, size)
    step = int(size * 1.18)
    total = step * (len(lines) - 1) + size
    start_y = (H - total) / 2 - 60

    for i, ln in enumerate(lines):
        bb = d.textbbox((0, 0), ln, font=f)
        x = (W - (bb[2] - bb[0])) / 2 - bb[0]
        col = GOLD if i in gold_idx else OFFWHITE
        d.text((x, start_y + i*step), ln, fill=col, font=f)

    # Save hint (optional, above brand)
    if save_hint:
        sf = ImageFont.truetype(FONT_BODY, 32)
        msg = "SAVE NI"
        bb = d.textbbox((0, 0), msg, font=sf)
        d.text(((W-(bb[2]-bb[0]))/2 - bb[0], H-340), msg, fill=GOLD, font=sf)

    draw_footer(d, tagline=tagline)
    img.save(os.path.join(OUT, filename), "PNG", optimize=True)


def make_slideshow_intro(filename, hook_lines, eyebrow, gold_idx=None,
                          hero_number=None, hero_color=None):
    """First slide of a slideshow deck — Chalette v2: HERO NUMBER prominent + hook + eyebrow.

    hero_number : str like "3", "5", "7", "73%" — rendered MASSIVE per Chalette's "big number" rule
    hero_color  : override color for hero number (default HOT_GOLD)
    """
    gold_idx = gold_idx or []
    hero_color = hero_color or HOT_GOLD
    img = gradient_bg()
    d = ImageDraw.Draw(img)
    draw_border(d)

    # Eyebrow at top
    lf = ImageFont.truetype(FONT_BODY, 36)
    bb = d.textbbox((0, 0), eyebrow, font=lf)
    d.text(((W-(bb[2]-bb[0]))/2 - bb[0], 130), eyebrow, fill=GOLD, font=lf)

    # HERO NUMBER (Chalette's rule: cover MUST shout a number)
    hook_start_y = (H - (len(hook_lines) * 138 * 1.15)) / 2 - 40
    if hero_number:
        # Massive hero number above hook
        nsize = 460 if len(hero_number) <= 2 else 360
        nf = ImageFont.truetype(FONT_HEAD, nsize)
        bb = d.textbbox((0, 0), hero_number, font=nf)
        nx = (W - (bb[2] - bb[0])) / 2 - bb[0]
        ny = 230
        d.text((nx, ny), hero_number, fill=hero_color, font=nf)
        # push hook below the hero
        hook_start_y = ny + nsize + 40

    # Big hook
    size = fit_size(hook_lines, 124 if hero_number else 138, W - 160, FONT_HEAD)
    f = ImageFont.truetype(FONT_HEAD, size)
    step = int(size * 1.15)

    for i, ln in enumerate(hook_lines):
        bb = d.textbbox((0, 0), ln, font=f)
        x = (W - (bb[2] - bb[0])) / 2 - bb[0]
        col = HOT_GOLD if i in gold_idx else OFFWHITE
        d.text((x, hook_start_y + i*step), ln, fill=col, font=f)

    # Swipe hint
    sw = ImageFont.truetype(FONT_BODY, 32)
    msg = ">>  SWIPE  >>"
    bb = d.textbbox((0, 0), msg, font=sw)
    d.text(((W-(bb[2]-bb[0]))/2 - bb[0], H-340), msg, fill=GOLD, font=sw)

    draw_footer(d)
    img.save(os.path.join(OUT, filename), "PNG", optimize=True)


def make_numbered_card(filename, number, title_lines, body_lines, total=None):
    """A numbered slide — big "1.", title, body explanation."""
    img = gradient_bg()
    d = ImageDraw.Draw(img)
    draw_border(d)

    # Big number
    nf = ImageFont.truetype(FONT_HEAD, 280)
    bb = d.textbbox((0, 0), str(number), font=nf)
    d.text(((W-(bb[2]-bb[0]))/2 - bb[0], 180), str(number), fill=GOLD, font=nf)

    # Progress indicator (e.g. "2 / 5")
    if total:
        pf = ImageFont.truetype(FONT_BODY, 28)
        msg = f"{number} / {total}"
        bb = d.textbbox((0, 0), msg, font=pf)
        d.text(((W-(bb[2]-bb[0]))/2 - bb[0], 130), msg, fill=(160, 140, 90), font=pf)

    # Title (big, white)
    ts = fit_size(title_lines, 86, W - 160, FONT_HEAD)
    tf = ImageFont.truetype(FONT_HEAD, ts)
    t_step = int(ts * 1.18)
    t_total = t_step * (len(title_lines) - 1) + ts
    t_start = 600
    for i, ln in enumerate(title_lines):
        bb = d.textbbox((0, 0), ln, font=tf)
        x = (W - (bb[2] - bb[0])) / 2 - bb[0]
        d.text((x, t_start + i*t_step), ln, fill=OFFWHITE, font=tf)

    # Body explanation (smaller, off-white)
    body_y = t_start + t_total + 80
    bs = fit_size(body_lines, 48, W - 200, FONT_BODY)
    bf = ImageFont.truetype(FONT_BODY, bs)
    b_step = int(bs * 1.32)
    for i, ln in enumerate(body_lines):
        bb = d.textbbox((0, 0), ln, font=bf)
        x = (W - (bb[2] - bb[0])) / 2 - bb[0]
        d.text((x, body_y + i*b_step), ln, fill=GOLD_LIGHT, font=bf)

    draw_footer(d)
    img.save(os.path.join(OUT, filename), "PNG", optimize=True)


def make_outro_card(filename, big_lines, cta="SAVE NI"):
    """Last slide — closing emotional punch + CTA."""
    img = gradient_bg()
    d = ImageDraw.Draw(img)
    draw_border(d)

    # CTA at top
    cf = ImageFont.truetype(FONT_HEAD, 76)
    bb = d.textbbox((0, 0), cta, font=cf)
    d.text(((W-(bb[2]-bb[0]))/2 - bb[0], 250), cta, fill=GOLD, font=cf)

    # Big closing message
    size = fit_size(big_lines, 110, W - 180, FONT_HEAD)
    f = ImageFont.truetype(FONT_HEAD, size)
    step = int(size * 1.18)
    total = step * (len(big_lines) - 1) + size
    start_y = (H - total) / 2 + 40

    for i, ln in enumerate(big_lines):
        bb = d.textbbox((0, 0), ln, font=f)
        x = (W - (bb[2] - bb[0])) / 2 - bb[0]
        d.text((x, start_y + i*step), ln, fill=OFFWHITE, font=f)

    draw_footer(d)
    img.save(os.path.join(OUT, filename), "PNG", optimize=True)


# ----------------------------------------------------------------------
# HARI 1 THUMBNAIL — Chalette v2: HERO NUMBER first, hook below
# ----------------------------------------------------------------------
def hari1_thumbnail():
    """Hari 1 = 'Fresh grad MY hantar 72 resume sebelum dapat 1 offer'.
    Hero number is 72 — massive. Hook below explains."""
    img = gradient_bg()
    d = ImageDraw.Draw(img)
    draw_border(d)

    # Eyebrow
    lf = ImageFont.truetype(FONT_BODY, 38)
    eyebrow = "FRESH GRAD MALAYSIA · 2026 DATA"
    bb = d.textbbox((0, 0), eyebrow, font=lf)
    d.text(((W-(bb[2]-bb[0]))/2 - bb[0], 180), eyebrow, fill=GOLD, font=lf)

    # HERO NUMBER — MASSIVE 72 (centered, no overlap)
    nf = ImageFont.truetype(FONT_HEAD, 520)
    hero = "72"
    bb = d.textbbox((0, 0), hero, font=nf)
    nx = (W - (bb[2] - bb[0])) / 2 - bb[0]
    ny = 320
    d.text((nx, ny), hero, fill=HOT_GOLD, font=nf)

    # Subhead under hero (no emojis — they render as missing-char boxes in PIL)
    sf = ImageFont.truetype(FONT_HEAD, 78)
    lines = ["RESUME PURATA", "SEBELUM 1 OFFER"]
    s_step = int(78 * 1.22)
    s_start = 980
    for i, ln in enumerate(lines):
        bb = d.textbbox((0, 0), ln, font=sf)
        x = (W - (bb[2] - bb[0])) / 2 - bb[0]
        col = HOT_GOLD if i == 1 else OFFWHITE
        d.text((x, s_start + i*s_step), ln, fill=col, font=sf)

    # Sub-detail
    df = ImageFont.truetype(FONT_BODY, 38)
    detail_lines = ["4.5 bulan median time-to-hire", "Up from 2 bulan (2022)"]
    d_start = 1280
    for i, ln in enumerate(detail_lines):
        bb = d.textbbox((0, 0), ln, font=df)
        x = (W - (bb[2] - bb[0])) / 2 - bb[0]
        d.text((x, d_start + i*48), ln, fill=(180, 180, 180), font=df)

    draw_footer(d, tagline="Setiap orang permata")
    img.save(os.path.join(OUT, "hari1-thumbnail.png"), "PNG", optimize=True)


# ----------------------------------------------------------------------
# END FRAME TEMPLATE — last 3s of every video
# ----------------------------------------------------------------------
def end_frame():
    img = gradient_bg()
    d = ImageDraw.Draw(img)
    draw_border(d, width=5)

    # Big diamond mark
    diamond(d, W//2, 540, 110, GOLD, 6)

    # Brand wordmark BIG
    f = ImageFont.truetype(FONT_HEAD, 180)
    bb = d.textbbox((0, 0), "DNJ", font=f)
    d.text(((W-(bb[2]-bb[0]))/2 - bb[0], 720), "DNJ", fill=GOLD, font=f)

    # Tagline lines
    tlines = ["Setiap orang permata.", "Kau cuma belum jumpa", "tukang asah."]
    tf = ImageFont.truetype(FONT_HEAD, 64)
    step = int(64 * 1.22)
    start = 980
    for i, ln in enumerate(tlines):
        bb = d.textbbox((0, 0), ln, font=tf)
        x = (W - (bb[2] - bb[0])) / 2 - bb[0]
        col = GOLD if i == 2 else OFFWHITE
        d.text((x, start + i*step), ln, fill=col, font=tf)

    # CTA
    cf = ImageFont.truetype(FONT_BODY, 42)
    msg = "FOLLOW · SAVE · SHARE"
    bb = d.textbbox((0, 0), msg, font=cf)
    d.text(((W-(bb[2]-bb[0]))/2 - bb[0], 1500), msg, fill=GOLD, font=cf)

    # URL
    uf = ImageFont.truetype(FONT_BODY, 38)
    url = "diamondandjeweler.com"
    bb = d.textbbox((0, 0), url, font=uf)
    d.text(((W-(bb[2]-bb[0]))/2 - bb[0], 1620), url, fill=OFFWHITE, font=uf)

    # Handle (long form — fits at 38pt)
    hf = ImageFont.truetype(FONT_HEAD, 38)
    handle = "@diamondandjeweler"
    bb = d.textbbox((0, 0), handle, font=hf)
    d.text(((W-(bb[2]-bb[0]))/2 - bb[0], 1710), handle, fill=GOLD, font=hf)

    img.save(os.path.join(OUT, "end-frame.png"), "PNG", optimize=True)


# ----------------------------------------------------------------------
# PROFILE COVER — wallpaper behind avatar (subtle, brand)
# ----------------------------------------------------------------------
def profile_cover():
    img = gradient_bg()
    d = ImageDraw.Draw(img)

    # Faint repeating diamond pattern
    for y in range(180, H-180, 360):
        for x in range(180, W-100, 360):
            diamond(d, x, y, 40, (40, 35, 20), 2)

    # Center DNJ wordmark large
    f = ImageFont.truetype(FONT_HEAD, 240)
    bb = d.textbbox((0, 0), "DNJ", font=f)
    d.text(((W-(bb[2]-bb[0]))/2 - bb[0], H//2 - 280), "DNJ", fill=GOLD, font=f)

    # Tagline
    tf = ImageFont.truetype(FONT_HEAD, 56)
    for i, ln in enumerate(["Setiap orang", "permata"]):
        bb = d.textbbox((0, 0), ln, font=tf)
        x = (W - (bb[2] - bb[0])) / 2 - bb[0]
        col = GOLD if i == 1 else OFFWHITE
        d.text((x, H//2 + 20 + i*72), ln, fill=col, font=tf)

    img.save(os.path.join(OUT, "profile-cover.png"), "PNG", optimize=True)


# ----------------------------------------------------------------------
# HARI 4 — Interview formula (5 slides)
# ----------------------------------------------------------------------
def hari4_slideshow():
    # Slide 1 — intro with HERO NUMBER 3
    make_slideshow_intro(
        "hari4-slide1.png",
        hook_lines=["AYAT JAWAB", "\"CERITAKAN", "TENTANG DIRI ANDA\"", "HR INGAT"],
        eyebrow="TIPS · INTERVIEW · SAVE",
        gold_idx=[3],
        hero_number="3"
    )
    # Slide 2 — Position
    make_numbered_card(
        "hari4-slide2.png", 1,
        title_lines=["AYAT POSITION"],
        body_lines=[
            "\"Saya seorang [role] dengan",
            "[X] tahun fokus dalam [skill].\"",
            "",
            "Cakap kau SIAPA dalam 1 ayat."
        ],
        total=3
    )
    # Slide 3 — Bukti
    make_numbered_card(
        "hari4-slide3.png", 2,
        title_lines=["AYAT BUKTI"],
        body_lines=[
            "\"Dalam tempat terakhir,",
            "saya [hasil dengan nombor].\"",
            "",
            "Tunjuk kau BOLEH — nombor."
        ],
        total=3
    )
    # Slide 4 — Why
    make_numbered_card(
        "hari4-slide4.png", 3,
        title_lines=["AYAT WHY"],
        body_lines=[
            "\"Saya nak kerja sini sebab",
            "[1 reason spesifik pasal company].\"",
            "",
            "Buktikan kau memang nak — sini."
        ],
        total=3
    )
    # Slide 5 — outro
    make_outro_card(
        "hari4-slide5.png",
        big_lines=["POSITION.", "BUKTI.", "WHY."],
        cta="SAVE NI · GUNA ESOK"
    )


# ----------------------------------------------------------------------
# HARI 10 — 5 red flag iklan kerja (6 slides)
# ----------------------------------------------------------------------
def hari10_slideshow():
    # HERO NUMBER 5 (red — red flag theme)
    make_slideshow_intro(
        "hari10-slide1.png",
        hook_lines=["RED FLAG", "IKLAN KERJA", "MALAYSIA"],
        eyebrow="REAL TALK · YANG KE-3 RAMAI TAK PERASAN",
        gold_idx=[0, 2],
        hero_number="5",
        hero_color=HOT_RED
    )
    make_numbered_card(
        "hari10-slide2.png", 1,
        title_lines=["\"GAJI MENGIKUT", "KELAYAKAN\""],
        body_lines=["Maksud sebenar:", "dia nak lowball kau."],
        total=5
    )
    make_numbered_card(
        "hari10-slide3.png", 2,
        title_lines=["\"WILLING TO WORK", "LONG HOURS\""],
        body_lines=["Maksud sebenar:", "NO work-life balance."],
        total=5
    )
    make_numbered_card(
        "hari10-slide4.png", 3,
        title_lines=["\"WE'RE LIKE", "A FAMILY\""],
        body_lines=[
            "Maksud sebenar:",
            "free emotional labor +",
            "boundary tak dihormati."
        ],
        total=5
    )
    make_numbered_card(
        "hari10-slide5.png", 4,
        title_lines=["\"FAST-PACED", "ENVIRONMENT\""],
        body_lines=["Maksud sebenar:", "under-staffed +", "over-worked."],
        total=5
    )
    make_numbered_card(
        "hari10-slide6.png", 5,
        title_lines=["\"MULTIPLE HATS\""],
        body_lines=["Maksud sebenar:", "3 jawatan, 1 gaji."],
        total=5
    )


# ----------------------------------------------------------------------
# HARI 17 — 5 tanda underpaid (6 slides)
# ----------------------------------------------------------------------
def hari17_slideshow():
    # HERO NUMBER 5 (gold)
    make_slideshow_intro(
        "hari17-slide1.png",
        hook_lines=["TANDA KAU", "UNDERPAID.", "BUKAN UNDERQUALIFIED"],
        eyebrow="GAJI MALAYSIA · YANG KE-3 RAMAI SLEEP ON",
        gold_idx=[1],
        hero_number="5"
    )
    make_numbered_card(
        "hari17-slide2.png", 1,
        title_lines=["KERJA > JD", "GAJI SAMA"],
        body_lines=[
            "Output kau lebih dari job description,",
            "tapi gaji tak naik.",
            "Tu bukan dedikasi.",
            "Tu exploitation."
        ],
        total=5
    )
    make_numbered_card(
        "hari17-slide3.png", 2,
        title_lines=["NEW JOIN GAJI", "SAMA DENGAN KAU"],
        body_lines=[
            "Kau dah 3 tahun,",
            "junior baru join gaji sama.",
            "Market rate naik — kau stuck."
        ],
        total=5
    )
    make_numbered_card(
        "hari17-slide4.png", 3,
        title_lines=["KAU TRAIN ORANG,", "DIA GAJI LEBIH"],
        body_lines=[
            "Knowledge transfer percuma.",
            "Mereka gaji dia lebih tinggi.",
            "Kau patut juga."
        ],
        total=5
    )
    make_numbered_card(
        "hari17-slide5.png", 4,
        title_lines=["KENAIKAN < 5%", "SETAHUN"],
        body_lines=[
            "Inflation Malaysia 3-4%.",
            "Kenaikan < 5% =",
            "kau actually kena potong gaji."
        ],
        total=5
    )
    make_numbered_card(
        "hari17-slide6.png", 5,
        title_lines=["SCOPE NAIK,", "GAJI TIDAK"],
        body_lines=[
            "Negotiate dulu.",
            "Kalau dia tak naik —",
            "cari tempat baru."
        ],
        total=5
    )


# ----------------------------------------------------------------------
# HARI 22 — 7 ayat negotiate gaji (7 slides)
# ----------------------------------------------------------------------
def hari22_slideshow():
    # HERO NUMBER 7
    make_slideshow_intro(
        "hari22-slide1.png",
        hook_lines=["AYAT NEGOTIATE", "GAJI BILA OFFER", "< EXPECTATION"],
        eyebrow="TIPS · PRINT, GUNA TIME CALL · SAVE",
        gold_idx=[0, 2],
        hero_number="7"
    )
    make_numbered_card(
        "hari22-slide2.png", 1,
        title_lines=["MULAKAN POSITIF"],
        body_lines=[
            "\"Terima kasih untuk offer.",
            "Saya excited dengan peluang ni.\"",
            "",
            "Jangan defensive. Bina rapport dulu."
        ],
        total=6
    )
    make_numbered_card(
        "hari22-slide3.png", 2,
        title_lines=["BAGI RANGE", "DENGAN NOMBOR"],
        body_lines=[
            "\"Based on market research +",
            "skill saya, range saya target",
            "RM[X] – RM[Y].\""
        ],
        total=6
    )
    make_numbered_card(
        "hari22-slide4.png", 3,
        title_lines=["INVITE", "COLLABORATIVE"],
        body_lines=[
            "\"Boleh kita bincang kalau",
            "ada flexibility?\"",
            "",
            "Bukan demand. Invitation."
        ],
        total=6
    )
    make_numbered_card(
        "hari22-slide5.png", 4,
        title_lines=["SENYAP."],
        body_lines=[
            "Biar dia respond dulu.",
            "Jangan justify pre-emptive.",
            "Diam = leverage."
        ],
        total=6
    )
    make_numbered_card(
        "hari22-slide6.png", 5,
        title_lines=["KALAU NO →", "TOTAL PACKAGE"],
        body_lines=[
            "\"Selain base, ada flexibility",
            "dalam allowance / training /",
            "extra leave?\""
        ],
        total=6
    )
    make_numbered_card(
        "hari22-slide7.png", 6,
        title_lines=["DAPAT", "FUTURE COMMITMENT"],
        body_lines=[
            "\"Boleh review dalam 6 bulan",
            "based on performance?\"",
            "",
            "Win bila tak menang sekarang."
        ],
        total=6
    )


# ----------------------------------------------------------------------
# Run all
# ----------------------------------------------------------------------
if __name__ == "__main__":
    print(f"Output: {OUT}\n")

    print("• Hari 1 thumbnail")
    hari1_thumbnail()

    print("• End frame template")
    end_frame()

    print("• Profile cover")
    profile_cover()

    print("• Hari 4 slideshow (5 slides)")
    hari4_slideshow()

    print("• Hari 10 slideshow (6 slides)")
    hari10_slideshow()

    print("• Hari 17 slideshow (6 slides)")
    hari17_slideshow()

    print("• Hari 22 slideshow (7 slides)")
    hari22_slideshow()

    print("\nDone. Generated files:")
    files = sorted(f for f in os.listdir(OUT) if f.endswith(".png"))
    total_bytes = 0
    for f in files:
        size = os.path.getsize(os.path.join(OUT, f))
        total_bytes += size
        print(f"  {f}: {size:,} bytes")
    print(f"\nTotal: {len(files)} files, {total_bytes:,} bytes")
