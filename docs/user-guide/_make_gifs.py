"""
DestinOraclesSolution CRM — animated user guide.

Renders 8 instructional GIFs covering the core team workflows:
  01  Login & navigation
  02  Add a prospect
  03  Move a deal through the pipeline
  04  Schedule a calendar booking
  05  Open a case and log a follow-up
  06  Add a referral and read the tree
  07  Read performance & export a report
  08  Upload to Knowledge HQ

Same approach as docs/stock-take-v2/_make_gifs.py — PIL-rendered mockup
frames (clean, labelled, no live data), not screen recordings. Safe to
re-run any time and the output is deterministic so commits stay small.

Run:  python docs/user-guide/_make_gifs.py
"""

from PIL import Image, ImageDraw, ImageFont
from pathlib import Path
import math

OUT = Path(__file__).parent
W, H = 1200, 720
FRAME_MS = 2000   # ms per frame — slightly longer than stock-take so non-tech team can read

# ── Colours (match the CRM palette) ───────────────────────────────────────
WHITE       = (255, 255, 255)
BG          = (250, 250, 252)
GRAY_50     = (248, 250, 252)
GRAY_100    = (241, 245, 249)
GRAY_200    = (226, 232, 240)
GRAY_300    = (203, 213, 225)
GRAY_400    = (148, 163, 184)
GRAY_500    = (100, 116, 139)
GRAY_600    = (71, 85, 105)
GRAY_700    = (51, 65, 85)
GRAY_900    = (15, 23, 42)
PRIMARY     = (236, 72, 153)        # CRM pink primary
PRIMARY_BG  = (253, 232, 243)
PURPLE      = (124, 58, 237)
PURPLE_BG   = (237, 233, 254)
ORANGE      = (245, 158, 11)
ORANGE_BG   = (255, 247, 237)
ORANGE_HI   = (180, 83, 9)
GREEN       = (5, 150, 105)
GREEN_BG    = (220, 252, 231)
GREEN_HI    = (22, 101, 52)
RED         = (220, 38, 38)
RED_BG      = (254, 226, 226)
RED_HI      = (153, 27, 27)
BLUE        = (14, 165, 233)
BLUE_BG     = (219, 234, 254)
BLUE_HI     = (29, 78, 216)
YELLOW_BG   = (254, 243, 199)
YELLOW_HI   = (146, 64, 14)


def _font(size, bold=False):
    paths = []
    if bold:
        paths += [
            "C:/Windows/Fonts/seguisb.ttf",
            "C:/Windows/Fonts/segoeuib.ttf",
            "C:/Windows/Fonts/arialbd.ttf",
        ]
    paths += [
        "C:/Windows/Fonts/segoeui.ttf",
        "C:/Windows/Fonts/arial.ttf",
    ]
    for p in paths:
        try:
            return ImageFont.truetype(p, size)
        except Exception:
            continue
    return ImageFont.load_default()


def _emoji_font(size):
    """Segoe UI Emoji — Windows-only colour glyph font.
    Use with embedded_color=True for proper colour rendering."""
    for p in ["C:/Windows/Fonts/seguiemj.ttf"]:
        try:
            return ImageFont.truetype(p, size)
        except Exception:
            continue
    # Fallback: monochrome — emojis will show as outlines/boxes
    return _font(size, bold=True)


def draw_emoji(d, x, y, char, size):
    """Render a single emoji glyph using the colour emoji font."""
    font = _emoji_font(size)
    try:
        d.text((x, y), char, font=font, embedded_color=True)
    except Exception:
        d.text((x, y), char, fill=(100, 100, 100), font=font)


def _cjk_font(size, bold=False):
    """Microsoft YaHei — Windows CJK font. Covers Chinese characters."""
    for p in ["C:/Windows/Fonts/msyh.ttc",
              "C:/Windows/Fonts/msyhbd.ttc" if bold else "C:/Windows/Fonts/msyh.ttc",
              "C:/Windows/Fonts/simsun.ttc"]:
        try:
            return ImageFont.truetype(p, size)
        except Exception:
            continue
    return _font(size, bold=bold)


def _has_cjk(text):
    """True if any character is in CJK Unified Ideographs range."""
    return any(0x4E00 <= ord(c) <= 0x9FFF for c in text)


def draw_mixed(d, x, y, text, fill, latin_font, size_for_cjk):
    """Draw text where Latin chars use latin_font and CJK chars use the
    CJK font. Useful for titles like 'Noticeboard · 公告栏'."""
    cjk_font = _cjk_font(size_for_cjk)
    cur_x = x
    buf = ""
    is_cjk = False
    def flush():
        nonlocal cur_x, buf, is_cjk
        if not buf:
            return
        f = cjk_font if is_cjk else latin_font
        d.text((cur_x, y), buf, fill=fill, font=f)
        bbox = d.textbbox((0, 0), buf, font=f)
        cur_x += bbox[2] - bbox[0]
        buf = ""
    for ch in text:
        ch_is_cjk = 0x4E00 <= ord(ch) <= 0x9FFF or 0x3000 <= ord(ch) <= 0x303F
        if ch_is_cjk != is_cjk and buf:
            flush()
            is_cjk = ch_is_cjk
        else:
            is_cjk = is_cjk or ch_is_cjk
        buf += ch
    flush()


F_LOGO    = _font(34, bold=True)
F_TITLE   = _font(28, bold=True)
F_H2      = _font(22, bold=True)
F_STEP    = _font(20, bold=True)
F_BODY    = _font(18)
F_BODY_B  = _font(18, bold=True)
F_SMALL   = _font(14)
F_SMALL_B = _font(14, bold=True)
F_TINY    = _font(12)
F_TINY_B  = _font(12, bold=True)
F_MONO    = _font(15)
F_BIG_NUM = _font(34, bold=True)


def new_frame(bg=BG):
    img = Image.new("RGB", (W, H), bg)
    d = ImageDraw.Draw(img)
    return img, d


# ── Reusable primitives ───────────────────────────────────────────────────
def header(d, step_n, title, caption):
    """Top instructional bar: step badge, title, caption."""
    d.rectangle([0, 0, W, 90], fill=WHITE, outline=GRAY_200)
    if step_n != "":
        bx, by = 24, 22
        d.rounded_rectangle([bx, by, bx + 46, by + 46], radius=23, fill=PRIMARY)
        bbox = d.textbbox((0, 0), str(step_n), font=F_STEP)
        tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
        d.text((bx + (46 - tw) // 2, by + (46 - th) // 2 - 2),
               str(step_n), fill=WHITE, font=F_STEP)
    if _has_cjk(title):
        draw_mixed(d, 90, 16, title, GRAY_900, F_TITLE, 28)
    else:
        d.text((90, 16), title, fill=GRAY_900, font=F_TITLE)
    if _has_cjk(caption):
        draw_mixed(d, 90, 54, caption, GRAY_600, F_BODY, 18)
    else:
        d.text((90, 54), caption, fill=GRAY_600, font=F_BODY)


def footer(d, caption):
    d.rectangle([0, H - 50, W, H], fill=WHITE, outline=GRAY_200)
    d.text((24, H - 38), caption, fill=GRAY_700, font=F_BODY)


def panel(d, x, y, w, h, title=None, fill=WHITE):
    d.rounded_rectangle([x, y, x + w, y + h], radius=8, fill=fill, outline=GRAY_200)
    if title:
        d.text((x + 16, y + 14), title, fill=GRAY_900, font=F_BODY_B)
        d.rectangle([x + 16, y + 44, x + w - 16, y + 45], fill=GRAY_100)


def input_box(d, x, y, w, h, placeholder, value="", mono=False):
    d.rounded_rectangle([x, y, x + w, y + h], radius=6, fill=WHITE, outline=GRAY_300)
    text = value if value else placeholder
    color = GRAY_900 if value else GRAY_500
    f = F_MONO if mono else F_BODY
    d.text((x + 10, y + (h - 18) // 2), text, fill=color, font=f)


def button(d, x, y, w, h, label, bg=PRIMARY, fg=WHITE, icon=None):
    d.rounded_rectangle([x, y, x + w, y + h], radius=6, fill=bg)
    label_to_draw = (icon + " " if icon else "") + label
    bbox = d.textbbox((0, 0), label_to_draw, font=F_BODY_B)
    tw = bbox[2] - bbox[0]
    d.text((x + (w - tw) // 2, y + (h - 22) // 2), label_to_draw, fill=fg, font=F_BODY_B)


def highlight_ring(d, x, y, w, h, color=ORANGE):
    for off in (6, 4, 2):
        d.rounded_rectangle([x - off, y - off, x + w + off, y + h + off],
                            radius=10, outline=color, width=2)


def arrow(d, x1, y1, x2, y2, color=ORANGE, width=4):
    d.line([x1, y1, x2, y2], fill=color, width=width)
    angle = math.atan2(y2 - y1, x2 - x1)
    ah = 14
    p1 = (x2, y2)
    p2 = (x2 - ah * math.cos(angle - 0.5), y2 - ah * math.sin(angle - 0.5))
    p3 = (x2 - ah * math.cos(angle + 0.5), y2 - ah * math.sin(angle + 0.5))
    d.polygon([p1, p2, p3], fill=color)


def status_pill(d, x, y, label, bg, fg):
    pad = 8
    bbox = d.textbbox((0, 0), label, font=F_SMALL_B)
    tw = bbox[2] - bbox[0]
    d.rounded_rectangle([x, y, x + tw + pad * 2, y + 24], radius=12, fill=bg)
    d.text((x + pad, y + 5), label, fill=fg, font=F_SMALL_B)


def avatar(d, x, y, size, initials, bg=PRIMARY):
    d.ellipse([x, y, x + size, y + size], fill=bg)
    bbox = d.textbbox((0, 0), initials, font=F_SMALL_B)
    tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
    d.text((x + (size - tw) // 2, y + (size - th) // 2 - 1),
           initials, fill=WHITE, font=F_SMALL_B)


def darken(img, alpha=130):
    overlay = Image.new("RGBA", (W, H), (15, 23, 42, alpha))
    return Image.alpha_composite(img.convert("RGBA"), overlay).convert("RGB")


# ── Sidebar + top-bar shell that the team will recognise ──────────────────
SIDEBAR_ITEMS = [
    ("📅", "Calendar"),
    ("👥", "Prospects"),
    ("🌳", "Referrals"),
    ("📊", "Pipeline"),
    ("🎁", "Promotions"),
    ("📨", "Automation"),
    ("🗂", "Cases"),
    ("👤", "Agents"),
    ("📈", "Performance"),
    ("📑", "Reports"),
    ("📚", "Knowledge HQ"),
    ("📁", "Documents"),
]


def crm_shell(active_label, page_title, page_subtitle, user_name="Alice (Manager)"):
    """Render the standard sidebar + top bar + empty content well."""
    img, d = new_frame()
    # Sidebar
    sb_w = 200
    d.rectangle([0, 0, sb_w, H], fill=GRAY_900)
    # Brand
    d.text((20, 22), "Destin Oracles", fill=WHITE, font=F_BODY_B)
    d.text((20, 46), "CRM", fill=PRIMARY, font=F_SMALL_B)
    d.rectangle([20, 78, sb_w - 20, 79], fill=GRAY_700)
    # Items
    for i, (icon, label) in enumerate(SIDEBAR_ITEMS):
        y = 96 + i * 38
        is_active = label == active_label
        if is_active:
            d.rounded_rectangle([10, y - 4, sb_w - 10, y + 28],
                                radius=6, fill=PRIMARY)
            draw_emoji(d, 22, y - 2, icon, 20)
            d.text((54, y + 2), label, fill=WHITE, font=F_BODY_B)
        else:
            draw_emoji(d, 22, y - 2, icon, 20)
            d.text((54, y + 2), label, fill=GRAY_300, font=F_BODY)
    # Top bar
    d.rectangle([sb_w, 0, W, 56], fill=WHITE, outline=GRAY_200)
    if _has_cjk(page_title):
        draw_mixed(d, sb_w + 24, 18, page_title, GRAY_900, F_H2, 22)
    else:
        d.text((sb_w + 24, 18), page_title, fill=GRAY_900, font=F_H2)
    # user chip top right
    avatar(d, W - 50, 14, 28, "AL", bg=PRIMARY)
    d.text((W - 200, 20), user_name, fill=GRAY_700, font=F_SMALL_B)
    # Page subtitle bar
    d.rectangle([sb_w, 56, W, 90], fill=GRAY_50, outline=GRAY_200)
    d.text((sb_w + 24, 64), page_subtitle, fill=GRAY_500, font=F_SMALL)
    return img, d, sb_w


# ══════════════════════════════════════════════════════════════════════════
# GIF 1 — Login & navigation
# ══════════════════════════════════════════════════════════════════════════
def gif_login():
    frames = []

    # Frame 1 — login screen
    img, d = new_frame(bg=(20, 14, 36))
    # Gradient-ish backdrop with soft pink wash
    for y in range(0, H, 2):
        c = (
            int(20 + (y / H) * 60),
            int(14 + (y / H) * 20),
            int(36 + (y / H) * 40),
        )
        d.rectangle([0, y, W, y + 2], fill=c)
    # Card
    cx, cy, cw, ch = 360, 130, 480, 460
    d.rounded_rectangle([cx, cy, cx + cw, cy + ch], radius=14, fill=WHITE)
    # Logo
    d.ellipse([cx + cw // 2 - 36, cy + 32, cx + cw // 2 + 36, cy + 104],
              fill=PRIMARY)
    d.text((cx + cw // 2 - 16, cy + 54), "D", fill=WHITE, font=F_LOGO)
    d.text((cx + 60, cy + 130), "Destin Oracles CRM",
           fill=GRAY_900, font=F_TITLE)
    d.text((cx + 60, cy + 168), "Sign in to continue",
           fill=GRAY_500, font=F_BODY)
    # Email
    d.text((cx + 60, cy + 210), "● Email", fill=GRAY_700, font=F_SMALL_B)
    input_box(d, cx + 60, cy + 232, 360, 40, "you@example.com")
    # Password
    d.text((cx + 60, cy + 282), "● Password", fill=GRAY_700, font=F_SMALL_B)
    input_box(d, cx + 60, cy + 304, 360, 40, "••••••••")
    # button
    button(d, cx + 60, cy + 364, 360, 44, "Sign in →")
    highlight_ring(d, cx + 60, cy + 364, 360, 44)
    d.text((cx + 60, cy + 420), "Enter your email and password to continue",
           fill=GRAY_500, font=F_SMALL)
    # Step header
    header(d, 1, "Sign in", "Use the email your manager sent you.")
    footer(d, "Forgot password? Ask your Marketing Manager to reset it.")
    frames.append(img)

    # Frame 2 — Calendar lands first, point to sidebar
    img, d, sb_w = crm_shell(
        active_label="Calendar",
        page_title="Calendar",
        page_subtitle="Today · Week · Month — your bookings appear here",
    )
    # Mini calendar grid in content area
    panel(d, sb_w + 24, 110, W - sb_w - 48, H - 170, title="May 2026")
    # 7-col header
    days = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
    col_w = (W - sb_w - 48 - 32) // 7
    for i, day in enumerate(days):
        d.text((sb_w + 40 + i * col_w + 6, 160), day,
               fill=GRAY_500, font=F_SMALL_B)
    # grid
    for r in range(5):
        for c in range(7):
            x = sb_w + 40 + c * col_w
            y = 185 + r * 88
            d.rounded_rectangle([x, y, x + col_w - 4, y + 80],
                                radius=4, fill=GRAY_50, outline=GRAY_200)
            d.text((x + 6, y + 4), str(r * 7 + c + 1), fill=GRAY_500, font=F_TINY_B)
    # one event chip on day 14
    cx = sb_w + 40 + 6 * col_w + 6
    cy = 185 + 1 * 88 + 22
    d.rounded_rectangle([cx, cy, cx + col_w - 16, cy + 22], radius=4, fill=PRIMARY)
    d.text((cx + 4, cy + 3), "10:00 Liaw Wei Da", fill=WHITE, font=F_TINY_B)
    # Highlight the sidebar
    highlight_ring(d, 4, 88, sb_w - 8, 12 * 38, color=ORANGE)
    arrow(d, sb_w + 60, 360, sb_w + 8, 360)
    # Re-draw the step header on top
    header(d, 2, "You land on Calendar",
           "Switch modules from the dark sidebar on the left.")
    footer(d, "Today's events show up here. Drag-select a slot to add a new booking.")
    frames.append(img)

    # Frame 3 — sidebar tour, label each section
    img, d, sb_w = crm_shell(
        active_label="Calendar",
        page_title="Sidebar tour",
        page_subtitle="Each item opens a different module — click to switch.",
    )
    # Pull-out labels on the right of the sidebar for each item
    labels = [
        ("Your bookings + agent meetings"),
        ("New leads, before they become a deal"),
        ("Who-referred-whom tree"),
        ("Deal stages: New → Contacted → Won"),
        ("Discount codes & campaigns"),
        ("Auto follow-up rules"),
        ("Customer issues / complaints"),
        ("Team members + roles"),
        ("Your KPIs vs target"),
        ("Saved exports (CSV / XLSX / PDF)"),
        ("Shared docs, SOPs, scripts"),
        ("File library"),
    ]
    for i, lbl in enumerate(labels):
        y = 96 + i * 38 + 8
        d.line([sb_w - 6, y, sb_w + 30, y], fill=GRAY_400, width=1)
        d.text((sb_w + 36, y - 9), lbl, fill=GRAY_700, font=F_SMALL)
    header(d, 3, "What each menu does",
           "12 modules in total. Greyed-out items appear only for Super Admin.")
    footer(d, "Tip: top-right shows your name + role. Click it to sign out.")
    frames.append(img)

    # Frame 4 — user menu open
    img, d, sb_w = crm_shell(
        active_label="Calendar",
        page_title="Calendar",
        page_subtitle="Top-right avatar opens the account menu.",
    )
    # darken
    img = darken(img, alpha=80)
    d = ImageDraw.Draw(img)
    # Dropdown
    mx, my = W - 250, 50
    d.rounded_rectangle([mx, my, mx + 220, my + 230], radius=8, fill=WHITE,
                        outline=GRAY_300)
    avatar(d, mx + 16, my + 16, 40, "AL")
    d.text((mx + 66, my + 18), "Alice Lee", fill=GRAY_900, font=F_BODY_B)
    d.text((mx + 66, my + 38), "Manager · Level 2", fill=GRAY_500, font=F_SMALL)
    d.rectangle([mx + 12, my + 70, mx + 208, my + 71], fill=GRAY_200)
    rows = [("👤", "My profile"),
            ("🔑", "Change password"),
            ("🌙", "Dark mode"),
            ("🚪", "Sign out")]
    for i, (icon, lbl) in enumerate(rows):
        y = my + 84 + i * 36
        draw_emoji(d, mx + 14, y - 2, icon, 20)
        d.text((mx + 46, y), lbl, fill=GRAY_700, font=F_BODY)
    highlight_ring(d, mx, my, 220, 230)
    arrow(d, mx - 60, my + 20, mx - 8, my + 20)
    header(d, 4, "Profile & sign-out",
           "Click your initials top-right to open the account menu.")
    footer(d, "Always sign out on shared tablets at the end of your shift.")
    frames.append(img)

    return frames


# ══════════════════════════════════════════════════════════════════════════
# GIF 2 — Add a prospect
# ══════════════════════════════════════════════════════════════════════════
def gif_add_prospect():
    frames = []

    # Frame 1 — Prospects list, highlight "+ Add Prospect"
    img, d, sb_w = crm_shell(
        active_label="Prospects",
        page_title="Prospects",
        page_subtitle="New leads before they become a deal. 42 prospects.",
    )
    # Filter row
    bx = sb_w + 24
    input_box(d, bx, 110, 240, 36, "Search name / phone…")
    button(d, bx + 252, 110, 110, 36, "Source v", bg=WHITE, fg=GRAY_700)
    button(d, bx + 370, 110, 110, 36, "Status v", bg=WHITE, fg=GRAY_700)
    # Add button at right
    add_x = W - 200
    button(d, add_x, 110, 160, 36, "+ Add Prospect")
    highlight_ring(d, add_x, 110, 160, 36)
    arrow(d, add_x - 50, 80, add_x - 6, 124)
    # Table
    panel(d, bx, 168, W - bx - 24, H - 220, title=None)
    cols = [("Name", 180), ("Phone", 150), ("Email", 240),
            ("Source", 140), ("Stage", 130), ("Agent", 120)]
    cur = bx + 16
    for label, w in cols:
        d.text((cur, 188), label, fill=GRAY_500, font=F_SMALL_B)
        cur += w
    d.rectangle([bx + 16, 210, W - 40, 211], fill=GRAY_200)
    rows = [
        ("Tan Mei Ling", "012-345 6789", "mei@example.com", "Facebook Ad",  "New",       "Alice"),
        ("Ahmad Rahman", "017-222 1188", "ahmad@email.my",  "Referral",     "Contacted", "Brian"),
        ("Lim Siew Hua", "016-908 7654", "siew@gmail.com",  "Walk-in",      "Qualified", "Alice"),
    ]
    for i, row in enumerate(rows):
        ry = 234 + i * 56
        cur = bx + 16
        for v, w in zip(row, [c[1] for c in cols]):
            d.text((cur, ry), v, fill=GRAY_900, font=F_BODY)
            cur += w
    footer(d, "Click + Add Prospect to capture a new lead before they convert.")
    frames.append(img)

    # Frame 2 — modal opens with empty fields
    img, d, sb_w = crm_shell(
        active_label="Prospects",
        page_title="Prospects",
        page_subtitle="New leads before they become a deal.",
    )
    img = darken(img, alpha=130)
    d = ImageDraw.Draw(img)
    # modal
    mx, my, mw, mh = 240, 90, 720, 540
    d.rounded_rectangle([mx, my, mx + mw, my + mh], radius=12, fill=WHITE)
    d.text((mx + 24, my + 20), "New Prospect", fill=GRAY_900, font=F_TITLE)
    d.text((mx + 24, my + 56), "Mandatory: Name and Phone. Everything else is optional.",
           fill=GRAY_500, font=F_SMALL)
    # 2-column form
    def lbl(text, x, y):
        d.text((x, y), text, fill=GRAY_700, font=F_SMALL_B)
    lbl("● Full name", mx + 24, my + 100)
    input_box(d, mx + 24, my + 122, 320, 38, "e.g. Tan Mei Ling")
    lbl("● Phone", mx + 368, my + 100)
    input_box(d, mx + 368, my + 122, 320, 38, "012-345 6789", mono=True)
    lbl("Email", mx + 24, my + 180)
    input_box(d, mx + 24, my + 202, 320, 38, "name@email.com")
    lbl("Source", mx + 368, my + 180)
    input_box(d, mx + 368, my + 202, 320, 38, "Facebook / Referral / Walk-in")
    lbl("Date of birth", mx + 24, my + 260)
    input_box(d, mx + 24, my + 282, 320, 38, "yyyy-mm-dd")
    lbl("Assigned agent", mx + 368, my + 260)
    input_box(d, mx + 368, my + 282, 320, 38, "Pick an agent…")
    lbl("Notes", mx + 24, my + 340)
    d.rounded_rectangle([mx + 24, my + 362, mx + 24 + 664, my + 362 + 80],
                        radius=6, fill=WHITE, outline=GRAY_300)
    d.text((mx + 34, my + 372),
           "Anything you want the next person to know (e.g. \"prefers Mandarin\").",
           fill=GRAY_500, font=F_BODY)
    # Buttons
    button(d, mx + mw - 240, my + mh - 56, 100, 38, "Cancel",
           bg=GRAY_100, fg=GRAY_700)
    button(d, mx + mw - 130, my + mh - 56, 110, 38, "Save")
    highlight_ring(d, mx + 24, my + 122, 320, 38)
    highlight_ring(d, mx + 368, my + 122, 320, 38)
    header(d, 1, "Open the New Prospect form",
           "Two fields are required — Name and Phone. Save the rest as you learn more.")
    footer(d, "Tip: pick the Source accurately — it powers your campaign ROI numbers.")
    frames.append(img)

    # Frame 3 — fields filled, point at Save
    img, d, sb_w = crm_shell(
        active_label="Prospects",
        page_title="Prospects",
        page_subtitle="New leads before they become a deal.",
    )
    img = darken(img, alpha=130)
    d = ImageDraw.Draw(img)
    mx, my, mw, mh = 240, 90, 720, 540
    d.rounded_rectangle([mx, my, mx + mw, my + mh], radius=12, fill=WHITE)
    d.text((mx + 24, my + 20), "New Prospect", fill=GRAY_900, font=F_TITLE)
    d.text((mx + 24, my + 56), "Looking good — click Save.", fill=GRAY_500, font=F_SMALL)
    def lbl(text, x, y):
        d.text((x, y), text, fill=GRAY_700, font=F_SMALL_B)
    lbl("● Full name", mx + 24, my + 100)
    input_box(d, mx + 24, my + 122, 320, 38, "", "Wong Kar Mun")
    lbl("● Phone", mx + 368, my + 100)
    input_box(d, mx + 368, my + 122, 320, 38, "", "011-456 7890", mono=True)
    lbl("Email", mx + 24, my + 180)
    input_box(d, mx + 24, my + 202, 320, 38, "", "karmun@gmail.com")
    lbl("Source", mx + 368, my + 180)
    input_box(d, mx + 368, my + 202, 320, 38, "", "Facebook Ad")
    lbl("Date of birth", mx + 24, my + 260)
    input_box(d, mx + 24, my + 282, 320, 38, "", "1988-09-12")
    lbl("Assigned agent", mx + 368, my + 260)
    input_box(d, mx + 368, my + 282, 320, 38, "", "Alice Lee")
    lbl("Notes", mx + 24, my + 340)
    d.rounded_rectangle([mx + 24, my + 362, mx + 24 + 664, my + 362 + 80],
                        radius=6, fill=WHITE, outline=GRAY_300)
    d.text((mx + 34, my + 372),
           "Saw the May Hidden-Talent ad. Wants a reading for her husband.",
           fill=GRAY_900, font=F_BODY)
    button(d, mx + mw - 240, my + mh - 56, 100, 38, "Cancel",
           bg=GRAY_100, fg=GRAY_700)
    bx, by, bw, bh = mx + mw - 130, my + mh - 56, 110, 38
    button(d, bx, by, bw, bh, "Save")
    highlight_ring(d, bx, by, bw, bh)
    arrow(d, bx - 60, by + 80, bx + 30, by + 8)
    header(d, 2, "Fill in what you know — click Save",
           "Save closes the modal and writes to Supabase straight away.")
    footer(d, "Save fails on duplicates → the system asks if you want to open the existing record instead.")
    frames.append(img)

    # Frame 4 — new row appears at top, toast
    img, d, sb_w = crm_shell(
        active_label="Prospects",
        page_title="Prospects",
        page_subtitle="43 prospects — Wong Kar Mun added just now.",
    )
    bx = sb_w + 24
    input_box(d, bx, 110, 240, 36, "Search name / phone…")
    button(d, bx + 252, 110, 110, 36, "Source v", bg=WHITE, fg=GRAY_700)
    button(d, bx + 370, 110, 110, 36, "Status v", bg=WHITE, fg=GRAY_700)
    add_x = W - 200
    button(d, add_x, 110, 160, 36, "+ Add Prospect")
    panel(d, bx, 168, W - bx - 24, H - 220, title=None)
    cols = [("Name", 180), ("Phone", 150), ("Email", 240),
            ("Source", 140), ("Stage", 130), ("Agent", 120)]
    cur = bx + 16
    for label, w in cols:
        d.text((cur, 188), label, fill=GRAY_500, font=F_SMALL_B)
        cur += w
    d.rectangle([bx + 16, 210, W - 40, 211], fill=GRAY_200)
    rows = [
        ("Wong Kar Mun", "011-456 7890", "karmun@gmail.com", "Facebook Ad", "New", "Alice"),
        ("Tan Mei Ling", "012-345 6789", "mei@example.com",  "Facebook Ad", "New", "Alice"),
        ("Ahmad Rahman", "017-222 1188", "ahmad@email.my",   "Referral",    "Contacted", "Brian"),
    ]
    for i, row in enumerate(rows):
        ry = 234 + i * 56
        if i == 0:
            d.rounded_rectangle([bx + 4, ry - 10, W - 28, ry + 38],
                                radius=6, fill=GREEN_BG)
        cur = bx + 16
        for v, w in zip(row, [c[1] for c in cols]):
            color = GREEN_HI if (i == 0 and v == row[0]) else GRAY_900
            d.text((cur, ry), v, fill=color,
                   font=F_BODY_B if i == 0 and v == row[0] else F_BODY)
            cur += w
    # Toast
    tx, ty, tw, th = W - 360, 70, 320, 50
    d.rounded_rectangle([tx, ty, tx + tw, ty + th], radius=8, fill=GREEN_HI)
    d.text((tx + 14, ty + 14), "✓ Prospect created.", fill=WHITE, font=F_BODY_B)
    header(d, 3, "Saved — new row appears at the top",
           "The green toast confirms it. Click the row to open the full detail page.")
    footer(d, "When this prospect is ready to buy, drag them to the Pipeline (next GIF).")
    frames.append(img)

    return frames


# ══════════════════════════════════════════════════════════════════════════
# GIF 3 — Pipeline kanban
# ══════════════════════════════════════════════════════════════════════════
PIPELINE_STAGES = ["New", "Contacted", "Qualified", "Proposal", "Won"]
STAGE_COLORS = {
    "New":       (GRAY_100, GRAY_700),
    "Contacted": (BLUE_BG, BLUE_HI),
    "Qualified": (PURPLE_BG, PURPLE),
    "Proposal":  (ORANGE_BG, ORANGE_HI),
    "Won":       (GREEN_BG, GREEN_HI),
}


def kanban_card(d, x, y, w, name, value, agent, accent=PRIMARY):
    d.rounded_rectangle([x, y, x + w, y + 84], radius=6, fill=WHITE, outline=GRAY_200)
    d.rectangle([x, y, x + 4, y + 84], fill=accent)
    d.text((x + 12, y + 8), name, fill=GRAY_900, font=F_BODY_B)
    d.text((x + 12, y + 30), value, fill=GRAY_700, font=F_SMALL)
    avatar(d, x + 12, y + 54, 20, agent[:2].upper(), bg=GRAY_500)
    d.text((x + 38, y + 58), agent, fill=GRAY_500, font=F_TINY_B)


def kanban_board(d, sb_w, deals_by_stage, ghost_card=None):
    """deals_by_stage: {stage_name: [(name, value, agent), ...]}
       ghost_card: (stage_idx, name) — render a translucent placeholder."""
    n = len(PIPELINE_STAGES)
    col_w = (W - sb_w - 48 - (n - 1) * 12) // n
    for i, stage in enumerate(PIPELINE_STAGES):
        x = sb_w + 24 + i * (col_w + 12)
        # Column header
        bg, fg = STAGE_COLORS[stage]
        d.rounded_rectangle([x, 110, x + col_w, 144], radius=6, fill=bg)
        d.text((x + 12, 118), stage, fill=fg, font=F_BODY_B)
        # count pill
        cnt = len(deals_by_stage.get(stage, []))
        d.rounded_rectangle([x + col_w - 38, 116, x + col_w - 10, 138],
                            radius=11, fill=WHITE)
        d.text((x + col_w - 30, 119), str(cnt), fill=fg, font=F_SMALL_B)
        # Column body
        d.rounded_rectangle([x, 152, x + col_w, H - 70],
                            radius=6, fill=GRAY_50)
        # cards
        cy = 164
        for (name, value, agent) in deals_by_stage.get(stage, []):
            kanban_card(d, x + 6, cy, col_w - 12, name, value, agent,
                        accent=fg)
            cy += 96
        if ghost_card and ghost_card[0] == i:
            # translucent placeholder
            gx, gy = x + 6, cy
            d.rounded_rectangle([gx, gy, gx + col_w - 12, gy + 84],
                                radius=6, outline=PRIMARY, width=2)
            d.text((gx + 12, gy + 30), ghost_card[1] + "  (dropping…)",
                   fill=PRIMARY, font=F_BODY_B)


def gif_pipeline():
    frames = []

    BASE_DEALS = {
        "New":       [("Wong Kar Mun", "RM 1,800", "Alice"),
                      ("Lee Chee Wai", "RM 2,400", "Brian")],
        "Contacted": [("Tan Mei Ling", "RM 3,200", "Alice"),
                      ("Ahmad Rahman", "RM 1,500", "Brian")],
        "Qualified": [("Lim Siew Hua", "RM 4,800", "Alice")],
        "Proposal":  [("Chong Kah Wai", "RM 6,000", "Brian")],
        "Won":       [("Datin Sarah",  "RM 12,000", "Alice")],
    }

    # Frame 1 — overview
    img, d, sb_w = crm_shell(
        active_label="Pipeline",
        page_title="Sales Pipeline",
        page_subtitle="Drag a card right as the deal moves toward Won.",
    )
    kanban_board(d, sb_w, BASE_DEALS)
    header(d, 1, "Five stages, left → right",
           "New leads enter on the left. The goal is to push each card to Won.")
    footer(d, "Each column has a count badge so you can see your funnel shape at a glance.")
    frames.append(img)

    # Frame 2 — picking up a card from Contacted
    img, d, sb_w = crm_shell(
        active_label="Pipeline",
        page_title="Sales Pipeline",
        page_subtitle="Long-press / click-and-hold a card to start dragging.",
    )
    moved = {k: list(v) for k, v in BASE_DEALS.items()}
    # remove Tan Mei Ling from Contacted
    moved["Contacted"] = [d_ for d_ in moved["Contacted"] if d_[0] != "Tan Mei Ling"]
    kanban_board(d, sb_w, moved, ghost_card=(2, "Tan Mei Ling"))
    # Floating card mid-drag
    fcx, fcy = 660, 280
    d.rounded_rectangle([fcx, fcy, fcx + 200, fcy + 84],
                        radius=6, fill=WHITE, outline=PRIMARY)
    d.rectangle([fcx, fcy, fcx + 4, fcy + 84], fill=PURPLE)
    d.text((fcx + 12, fcy + 8), "Tan Mei Ling", fill=GRAY_900, font=F_BODY_B)
    d.text((fcx + 12, fcy + 30), "RM 3,200", fill=GRAY_700, font=F_SMALL)
    avatar(d, fcx + 12, fcy + 54, 20, "AL")
    d.text((fcx + 38, fcy + 58), "Alice", fill=GRAY_500, font=F_TINY_B)
    arrow(d, fcx - 80, fcy + 40, fcx - 10, fcy + 40)
    header(d, 2, "Drag a deal to Qualified",
           "After a discovery call, drag the card right by one column.")
    footer(d, "Drop it in the dashed outline. The stage updates and the count badges adjust.")
    frames.append(img)

    # Frame 3 — dropped, click to open detail
    img, d, sb_w = crm_shell(
        active_label="Pipeline",
        page_title="Sales Pipeline",
        page_subtitle="Click any card to open the deal detail.",
    )
    after = {k: list(v) for k, v in BASE_DEALS.items()}
    after["Contacted"] = [d_ for d_ in after["Contacted"] if d_[0] != "Tan Mei Ling"]
    after["Qualified"].insert(0, ("Tan Mei Ling", "RM 3,200", "Alice"))
    kanban_board(d, sb_w, after)
    # Highlight the moved card
    n = len(PIPELINE_STAGES)
    col_w = (W - sb_w - 48 - (n - 1) * 12) // n
    qx = sb_w + 24 + 2 * (col_w + 12) + 6
    qy = 164
    highlight_ring(d, qx, qy, col_w - 12, 84, color=PURPLE)
    arrow(d, qx - 80, qy + 40, qx - 10, qy + 40, color=PURPLE)
    header(d, 3, "Deal landed in Qualified",
           "Click the card itself to open the full deal page.")
    footer(d, "The detail page shows contact info, history log, and a Mark Won button.")
    frames.append(img)

    # Frame 4 — detail modal, mark Won
    img, d, sb_w = crm_shell(
        active_label="Pipeline",
        page_title="Sales Pipeline",
        page_subtitle="Update value, agent, or stage from the detail card.",
    )
    img = darken(img, alpha=130)
    d = ImageDraw.Draw(img)
    mx, my, mw, mh = 280, 120, 640, 480
    d.rounded_rectangle([mx, my, mx + mw, my + mh], radius=12, fill=WHITE)
    d.text((mx + 24, my + 20), "Tan Mei Ling", fill=GRAY_900, font=F_TITLE)
    status_pill(d, mx + 240, my + 28, "Qualified", PURPLE_BG, PURPLE)
    d.text((mx + 24, my + 60), "Deal #DL-1042 · created 14 May 2026",
           fill=GRAY_500, font=F_SMALL)
    # info grid
    info = [("Phone",   "012-345 6789"),
            ("Email",   "mei@example.com"),
            ("Value",   "RM 3,200"),
            ("Agent",   "Alice Lee"),
            ("Source",  "Facebook Ad"),
            ("Created", "2026-05-14")]
    for i, (k, v) in enumerate(info):
        cx = mx + 24 + (i % 2) * 300
        cy = my + 100 + (i // 2) * 56
        d.text((cx, cy), k, fill=GRAY_500, font=F_SMALL_B)
        d.text((cx, cy + 18), v, fill=GRAY_900, font=F_BODY_B)
    # Activity log header
    d.text((mx + 24, my + 280), "History", fill=GRAY_500, font=F_SMALL_B)
    d.rectangle([mx + 24, my + 302, mx + mw - 24, my + 303], fill=GRAY_200)
    log = [("14 May", "Created from Facebook Ad lead"),
           ("16 May", "Alice called — interested in 八字 reading"),
           ("18 May", "Stage changed: Contacted → Qualified")]
    for i, (when, what) in enumerate(log):
        ly = my + 312 + i * 24
        d.text((mx + 24, ly), when, fill=GRAY_500, font=F_SMALL_B)
        d.text((mx + 96, ly), what, fill=GRAY_700, font=F_SMALL)
    # Buttons
    button(d, mx + 24, my + mh - 56, 130, 38, "Edit",
           bg=GRAY_100, fg=GRAY_700)
    button(d, mx + 168, my + mh - 56, 150, 38, "→ Proposal",
           bg=ORANGE, fg=WHITE)
    bx, by, bw, bh = mx + mw - 180, my + mh - 56, 160, 38
    button(d, bx, by, bw, bh, "★ Mark Won", bg=GREEN_HI)
    highlight_ring(d, bx, by, bw, bh, color=GREEN_HI)
    arrow(d, bx - 60, by + 70, bx + 30, by + 8, color=GREEN_HI)
    header(d, 4, "Move it forward — or close it",
           "Use the orange button for next stage, green Mark Won when paid.")
    footer(d, "Marking Won writes a purchase record and updates the agent's KPI.")
    frames.append(img)

    return frames


# ══════════════════════════════════════════════════════════════════════════
# GIF 4 — Calendar booking
# ══════════════════════════════════════════════════════════════════════════
def calendar_grid(d, sb_w, highlight_day=None, events=None):
    panel(d, sb_w + 24, 110, W - sb_w - 48, H - 170, title=None)
    # Toolbar inside panel
    d.text((sb_w + 40, 124), "←  May 2026  →", fill=GRAY_900, font=F_H2)
    button(d, sb_w + 220, 122, 80, 28, "Day", bg=GRAY_100, fg=GRAY_700)
    button(d, sb_w + 308, 122, 80, 28, "Week", bg=GRAY_100, fg=GRAY_700)
    button(d, sb_w + 396, 122, 80, 28, "Month", bg=PRIMARY)
    button(d, W - 200, 122, 160, 28, "+ New Booking")
    # Day-of-week header
    days = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
    col_w = (W - sb_w - 80) // 7
    for i, day in enumerate(days):
        d.text((sb_w + 48 + i * col_w + 6, 168),
               day, fill=GRAY_500, font=F_SMALL_B)
    # Grid 5 rows
    cells = {}
    for r in range(5):
        for c in range(7):
            x = sb_w + 48 + c * col_w
            y = 192 + r * 86
            day_num = r * 7 + c + 1
            if day_num > 31:
                continue
            bg = GRAY_50
            if highlight_day == day_num:
                bg = PRIMARY_BG
            d.rounded_rectangle([x, y, x + col_w - 6, y + 80],
                                radius=4, fill=bg, outline=GRAY_200)
            d.text((x + 8, y + 4),
                   str(day_num),
                   fill=PRIMARY if highlight_day == day_num else GRAY_500,
                   font=F_SMALL_B if highlight_day == day_num else F_TINY_B)
            cells[day_num] = (x, y, col_w - 6, 80)
    # Events
    if events:
        for (day, time_lbl, title, color) in events:
            if day not in cells:
                continue
            x, y, w, h = cells[day]
            chips_y = y + 24 + (cells[day] != cells.get(day, (0,0,0,0)) and 0)
            d.rounded_rectangle([x + 4, chips_y, x + w - 4, chips_y + 20],
                                radius=4, fill=color)
            d.text((x + 6, chips_y + 2),
                   f"{time_lbl} {title}", fill=WHITE, font=F_TINY_B)
    return cells


def gif_calendar():
    frames = []

    # Frame 1 — month view
    img, d, sb_w = crm_shell(
        active_label="Calendar",
        page_title="Calendar",
        page_subtitle="Your bookings show as pink chips. Click any day to add one.",
    )
    calendar_grid(d, sb_w, highlight_day=None,
                  events=[(7, "10:00", "Mei Ling", PRIMARY),
                          (14, "14:00", "Datin Sarah", PURPLE),
                          (21, "11:00", "Kar Mun", PRIMARY)])
    # highlight new booking button
    highlight_ring(d, W - 200, 122, 160, 28)
    arrow(d, W - 240, 80, W - 130, 120)
    header(d, 1, "Open Calendar",
           "Month view is the default. Pink = your bookings, purple = team.")
    footer(d, "Click + New Booking, OR just click an empty day cell.")
    frames.append(img)

    # Frame 2 — click empty day → new booking modal
    img, d, sb_w = crm_shell(
        active_label="Calendar",
        page_title="Calendar",
        page_subtitle="Click an empty day → modal opens prefilled with that date.",
    )
    cells = calendar_grid(d, sb_w, highlight_day=22,
                          events=[(7, "10:00", "Mei Ling", PRIMARY),
                                  (14, "14:00", "Datin Sarah", PURPLE)])
    # Hover ring on day 22
    if 22 in cells:
        x, y, w, h = cells[22]
        highlight_ring(d, x, y, w, h, color=PRIMARY)
        arrow(d, x - 60, y + 40, x - 8, y + 40, color=PRIMARY)
    header(d, 2, "Click an empty day",
           "Pick the date by clicking — easier than typing it.")
    footer(d, "If you need a time slot, switch to Week view first then drag-select.")
    frames.append(img)

    # Frame 3 — booking modal
    img, d, sb_w = crm_shell(
        active_label="Calendar",
        page_title="Calendar",
        page_subtitle="Fill in the booking — customer, time, location.",
    )
    img = darken(img, alpha=130)
    d = ImageDraw.Draw(img)
    mx, my, mw, mh = 260, 100, 680, 520
    d.rounded_rectangle([mx, my, mx + mw, my + mh], radius=12, fill=WHITE)
    d.text((mx + 24, my + 20), "New Booking", fill=GRAY_900, font=F_TITLE)
    d.text((mx + 24, my + 56), "Date pre-filled from the day you clicked.",
           fill=GRAY_500, font=F_SMALL)
    def lbl(text, x, y):
        d.text((x, y), text, fill=GRAY_700, font=F_SMALL_B)
    lbl("● Title", mx + 24, my + 100)
    input_box(d, mx + 24, my + 122, mw - 48, 38, "", "BaZi reading — Wong Kar Mun")
    lbl("● Date", mx + 24, my + 180)
    input_box(d, mx + 24, my + 202, 200, 38, "", "2026-05-22", mono=True)
    lbl("Start time", mx + 240, my + 180)
    input_box(d, mx + 240, my + 202, 140, 38, "", "14:00", mono=True)
    lbl("Duration", mx + 396, my + 180)
    input_box(d, mx + 396, my + 202, 140, 38, "", "60 min")
    lbl("Color", mx + 552, my + 180)
    # color swatches
    for i, c in enumerate([PRIMARY, PURPLE, GREEN, BLUE, ORANGE]):
        d.ellipse([mx + 552 + i * 22, my + 208,
                   mx + 552 + i * 22 + 16, my + 224], fill=c)
    lbl("Customer", mx + 24, my + 260)
    input_box(d, mx + 24, my + 282, mw - 48, 38, "", "Wong Kar Mun  📞 011-456 7890")
    lbl("Location", mx + 24, my + 340)
    input_box(d, mx + 24, my + 362, mw - 48, 38, "", "Puchong office — Room 2")
    button(d, mx + mw - 240, my + mh - 56, 100, 38, "Cancel",
           bg=GRAY_100, fg=GRAY_700)
    bx, by, bw, bh = mx + mw - 130, my + mh - 56, 110, 38
    button(d, bx, by, bw, bh, "Save")
    highlight_ring(d, bx, by, bw, bh)
    header(d, 3, "Fill the form — click Save",
           "Customer field auto-suggests existing prospects as you type.")
    footer(d, "Save creates a calendar entry AND links it to the customer's history.")
    frames.append(img)

    # Frame 4 — booking shows on calendar
    img, d, sb_w = crm_shell(
        active_label="Calendar",
        page_title="Calendar",
        page_subtitle="New booking — Wong Kar Mun, 22 May 14:00.",
    )
    cells = calendar_grid(d, sb_w,
                          events=[(7, "10:00", "Mei Ling", PRIMARY),
                                  (14, "14:00", "Datin Sarah", PURPLE),
                                  (22, "14:00", "Kar Mun ★", PRIMARY)])
    if 22 in cells:
        x, y, w, h = cells[22]
        highlight_ring(d, x, y, w, h, color=PRIMARY)
    # toast
    tx, ty, tw, th = W - 340, 60, 300, 50
    d.rounded_rectangle([tx, ty, tx + tw, ty + th], radius=8, fill=GREEN_HI)
    d.text((tx + 14, ty + 14), "✓ Booking saved.", fill=WHITE, font=F_BODY_B)
    header(d, 4, "Saved — chip appears on the date",
           "Click the chip to edit, move, or cancel the booking.")
    footer(d, "Customer gets an SMS reminder 1 day before (if automation is on).")
    frames.append(img)

    return frames


# ══════════════════════════════════════════════════════════════════════════
# GIF 5 — Cases & follow-ups
# ══════════════════════════════════════════════════════════════════════════
def gif_cases():
    frames = []

    # Frame 1 — Cases list
    img, d, sb_w = crm_shell(
        active_label="Cases",
        page_title="Cases",
        page_subtitle="Issues, complaints, and follow-ups that need closing.",
    )
    bx = sb_w + 24
    input_box(d, bx, 110, 240, 36, "Search subject / customer…")
    button(d, bx + 252, 110, 110, 36, "Status v", bg=WHITE, fg=GRAY_700)
    button(d, bx + 370, 110, 110, 36, "Priority v", bg=WHITE, fg=GRAY_700)
    add_x = W - 200
    button(d, add_x, 110, 160, 36, "+ New Case")
    highlight_ring(d, add_x, 110, 160, 36)
    arrow(d, add_x - 50, 80, add_x - 6, 124)
    panel(d, bx, 168, W - bx - 24, H - 220, title=None)
    cols = [("#", 70), ("Subject", 320), ("Customer", 180),
            ("Priority", 110), ("Status", 130), ("Owner", 120)]
    cur = bx + 16
    for label, w in cols:
        d.text((cur, 188), label, fill=GRAY_500, font=F_SMALL_B)
        cur += w
    d.rectangle([bx + 16, 210, W - 40, 211], fill=GRAY_200)
    rows = [
        ("#1023", "Late delivery of reading report",   "Lim Siew Hua",  "High",   "Open",        "Alice"),
        ("#1022", "Wrong birth date on receipt",        "Tan Mei Ling",  "Medium", "In Progress", "Brian"),
        ("#1021", "Question about referral commission", "Ahmad Rahman",  "Low",    "Open",        "Alice"),
    ]
    for i, row in enumerate(rows):
        ry = 234 + i * 56
        cur = bx + 16
        for j, (v, w) in enumerate(zip(row, [c[1] for c in cols])):
            if j == 3:
                bg = RED_BG if v == "High" else (ORANGE_BG if v == "Medium" else GRAY_100)
                fg = RED_HI if v == "High" else (ORANGE_HI if v == "Medium" else GRAY_700)
                status_pill(d, cur, ry - 2, v, bg, fg)
            elif j == 4:
                bg = BLUE_BG if v == "In Progress" else GRAY_100
                fg = BLUE_HI if v == "In Progress" else GRAY_700
                status_pill(d, cur, ry - 2, v, bg, fg)
            else:
                d.text((cur, ry), v, fill=GRAY_900, font=F_BODY)
            cur += w
    footer(d, "+ New Case opens the form. Every case must have an owner.")
    frames.append(img)

    # Frame 2 — new case modal
    img, d, sb_w = crm_shell(
        active_label="Cases",
        page_title="Cases",
        page_subtitle="Log the issue, assign an owner, set the priority.",
    )
    img = darken(img, alpha=130)
    d = ImageDraw.Draw(img)
    mx, my, mw, mh = 260, 100, 680, 500
    d.rounded_rectangle([mx, my, mx + mw, my + mh], radius=12, fill=WHITE)
    d.text((mx + 24, my + 20), "New Case", fill=GRAY_900, font=F_TITLE)
    d.text((mx + 24, my + 56), "Be specific in the subject — your future self will thank you.",
           fill=GRAY_500, font=F_SMALL)
    def lbl(text, x, y):
        d.text((x, y), text, fill=GRAY_700, font=F_SMALL_B)
    lbl("● Subject", mx + 24, my + 100)
    input_box(d, mx + 24, my + 122, mw - 48, 38, "", "Customer wants refund — wrong report sent")
    lbl("● Customer", mx + 24, my + 180)
    input_box(d, mx + 24, my + 202, 380, 38, "", "Wong Kar Mun")
    lbl("● Priority", mx + 420, my + 180)
    # priority chips
    for i, (label_, bg, fg) in enumerate([("Low", GRAY_100, GRAY_700),
                                          ("Medium", ORANGE_BG, ORANGE_HI),
                                          ("High", RED_BG, RED_HI)]):
        x = mx + 420 + i * 70
        status_pill(d, x, my + 208, label_, bg, fg)
    lbl("● Owner", mx + 24, my + 260)
    input_box(d, mx + 24, my + 282, 380, 38, "", "Alice Lee (you)")
    lbl("Status", mx + 420, my + 260)
    input_box(d, mx + 420, my + 282, 180, 38, "", "Open")
    lbl("Description", mx + 24, my + 340)
    d.rounded_rectangle([mx + 24, my + 362, mx + mw - 24, my + 362 + 70],
                        radius=6, fill=WHITE, outline=GRAY_300)
    d.text((mx + 34, my + 372),
           "Customer received Mei Ling's report by mistake. Wants the correct one + a 20% credit.",
           fill=GRAY_900, font=F_BODY)
    button(d, mx + mw - 240, my + mh - 56, 100, 38, "Cancel",
           bg=GRAY_100, fg=GRAY_700)
    bx, by, bw, bh = mx + mw - 130, my + mh - 56, 110, 38
    button(d, bx, by, bw, bh, "Create")
    highlight_ring(d, bx, by, bw, bh)
    header(d, 1, "Open the New Case form",
           "Subject + Customer + Priority + Owner are all required.")
    footer(d, "Create writes the case and sends an in-app notification to the owner.")
    frames.append(img)

    # Frame 3 — case detail page, add follow-up
    img, d, sb_w = crm_shell(
        active_label="Cases",
        page_title="Case #1024",
        page_subtitle="Customer wants refund — wrong report sent.",
    )
    # Left column: details
    panel(d, sb_w + 24, 110, 420, H - 170, title="Details")
    rows_d = [("Status",   "Open"),
              ("Priority", "High"),
              ("Owner",    "Alice Lee"),
              ("Customer", "Wong Kar Mun"),
              ("Created",  "2026-05-20 09:14")]
    for i, (k, v) in enumerate(rows_d):
        y = 160 + i * 36
        d.text((sb_w + 40, y), k, fill=GRAY_500, font=F_SMALL_B)
        d.text((sb_w + 180, y), v, fill=GRAY_900, font=F_BODY_B)
    # Right column: activity + follow-up form
    rx = sb_w + 460
    panel(d, rx, 110, W - rx - 24, H - 170, title="Activity & follow-ups")
    log = [("20 May 09:14", "Case created — High priority", PRIMARY),
           ("20 May 10:02", "Alice called the customer — voicemail", BLUE),
           ("20 May 11:30", "Customer SMS'd: prefers WhatsApp", BLUE)]
    for i, (when, what, c) in enumerate(log):
        ly = 160 + i * 50
        d.ellipse([rx + 20, ly + 6, rx + 30, ly + 16], fill=c)
        d.text((rx + 44, ly), when, fill=GRAY_500, font=F_SMALL_B)
        d.text((rx + 44, ly + 18), what, fill=GRAY_700, font=F_BODY)
    # follow-up input at bottom
    fy = 340
    d.text((rx + 20, fy), "+ Add follow-up", fill=GRAY_700, font=F_BODY_B)
    d.rounded_rectangle([rx + 20, fy + 28, W - 44, fy + 28 + 80],
                        radius=6, fill=WHITE, outline=GRAY_300)
    d.text((rx + 30, fy + 38),
           "Sent corrected report via WhatsApp. Awaiting confirmation.",
           fill=GRAY_900, font=F_BODY)
    button(d, rx + 20, fy + 124, 130, 36, "Save note")
    button(d, rx + 160, fy + 124, 160, 36, "Mark Resolved", bg=GREEN_HI)
    highlight_ring(d, rx + 160, fy + 124, 160, 36, color=GREEN_HI)
    arrow(d, rx + 380, fy + 200, rx + 250, fy + 150, color=GREEN_HI)
    header(d, 2, "Log every follow-up",
           "Each note becomes a timestamped row. When fixed, Mark Resolved.")
    footer(d, "Resolved cases are removed from your open queue but stay searchable.")
    frames.append(img)

    return frames


# ══════════════════════════════════════════════════════════════════════════
# GIF 6 — Referrals
# ══════════════════════════════════════════════════════════════════════════
def gif_referrals():
    frames = []

    # Frame 1 — Referrals list + Add button
    img, d, sb_w = crm_shell(
        active_label="Referrals",
        page_title="Referrals",
        page_subtitle="Who introduced whom — the engine of word-of-mouth revenue.",
    )
    # Toolbar
    button(d, sb_w + 24, 110, 130, 36, "List", bg=PRIMARY)
    button(d, sb_w + 162, 110, 130, 36, "Tree", bg=WHITE, fg=GRAY_700)
    add_x = W - 200
    button(d, add_x, 110, 160, 36, "+ Add Referral")
    highlight_ring(d, add_x, 110, 160, 36)
    arrow(d, add_x - 50, 80, add_x - 6, 124)
    panel(d, sb_w + 24, 168, W - sb_w - 48, H - 220, title=None)
    cols = [("Referrer", 220), ("Referred", 220), ("Date", 140),
            ("Commission", 140), ("Status", 140)]
    cur = sb_w + 40
    for label, w in cols:
        d.text((cur, 188), label, fill=GRAY_500, font=F_SMALL_B)
        cur += w
    d.rectangle([sb_w + 40, 210, W - 40, 211], fill=GRAY_200)
    rows = [
        ("Datin Sarah",   "Wong Kar Mun",   "2026-05-12", "RM 180", "Paid"),
        ("Datin Sarah",   "Tan Mei Ling",   "2026-04-30", "RM 240", "Paid"),
        ("Wong Kar Mun",  "Lee Chee Wai",   "2026-05-18", "RM 120", "Pending"),
    ]
    for i, row in enumerate(rows):
        ry = 234 + i * 50
        cur = sb_w + 40
        for j, (v, w) in enumerate(zip(row, [c[1] for c in cols])):
            if j == 4:
                bg = GREEN_BG if v == "Paid" else YELLOW_BG
                fg = GREEN_HI if v == "Paid" else YELLOW_HI
                status_pill(d, cur, ry - 2, v, bg, fg)
            else:
                d.text((cur, ry), v, fill=GRAY_900, font=F_BODY)
            cur += w
    header(d, 1, "Open Referrals → click + Add Referral",
           "Record the introduction the moment you hear about it.")
    footer(d, "Even pending referrals show in the tree so you can see your network forming.")
    frames.append(img)

    # Frame 2 — add referral modal
    img, d, sb_w = crm_shell(
        active_label="Referrals",
        page_title="Referrals",
        page_subtitle="Type the names — auto-complete picks from your customers list.",
    )
    img = darken(img, alpha=130)
    d = ImageDraw.Draw(img)
    mx, my, mw, mh = 300, 140, 600, 420
    d.rounded_rectangle([mx, my, mx + mw, my + mh], radius=12, fill=WHITE)
    d.text((mx + 24, my + 20), "Add Referral", fill=GRAY_900, font=F_TITLE)
    d.text((mx + 24, my + 56), "Commission auto-calculates from the referrer's tier.",
           fill=GRAY_500, font=F_SMALL)
    def lbl(text, x, y):
        d.text((x, y), text, fill=GRAY_700, font=F_SMALL_B)
    lbl("● Referrer (existing customer)", mx + 24, my + 100)
    input_box(d, mx + 24, my + 122, mw - 48, 38, "", "Datin Sarah")
    lbl("● Referred (new customer)", mx + 24, my + 180)
    input_box(d, mx + 24, my + 202, mw - 48, 38, "", "Wong Kar Mun")
    lbl("Date of referral", mx + 24, my + 260)
    input_box(d, mx + 24, my + 282, 220, 38, "", "2026-05-22", mono=True)
    lbl("Commission (auto)", mx + 264, my + 260)
    input_box(d, mx + 264, my + 282, 220, 38, "", "RM 180")
    button(d, mx + mw - 240, my + mh - 56, 100, 38, "Cancel",
           bg=GRAY_100, fg=GRAY_700)
    bx, by, bw, bh = mx + mw - 130, my + mh - 56, 110, 38
    button(d, bx, by, bw, bh, "Save")
    highlight_ring(d, bx, by, bw, bh)
    header(d, 2, "Save the referral",
           "It also links the two customers in the tree view.")
    footer(d, "Commission Paid is set later — when finance confirms payout.")
    frames.append(img)

    # Frame 3 — tree view
    img, d, sb_w = crm_shell(
        active_label="Referrals",
        page_title="Referrals",
        page_subtitle="Tree view — see your top referrers and their networks.",
    )
    button(d, sb_w + 24, 110, 130, 36, "List", bg=WHITE, fg=GRAY_700)
    button(d, sb_w + 162, 110, 130, 36, "Tree", bg=PRIMARY)
    panel(d, sb_w + 24, 168, W - sb_w - 48, H - 220, title=None)
    # Draw a simple tree
    cx = (sb_w + W) // 2
    # Root
    root = (cx, 230)
    d.ellipse([root[0] - 50, root[1] - 30, root[0] + 50, root[1] + 30],
              fill=PRIMARY)
    d.text((root[0] - 38, root[1] - 18), "Datin", fill=WHITE, font=F_BODY_B)
    d.text((root[0] - 40, root[1] + 4), "Sarah", fill=WHITE, font=F_BODY_B)
    # Children
    children = [(cx - 240, 380, "Wong\nKar Mun"),
                (cx, 380, "Tan\nMei Ling"),
                (cx + 240, 380, "Ahmad\nRahman")]
    for (kx, ky, name) in children:
        d.line([root[0], root[1] + 30, kx, ky - 30], fill=GRAY_400, width=2)
        d.ellipse([kx - 45, ky - 30, kx + 45, ky + 30], fill=PURPLE)
        for i, line in enumerate(name.split("\n")):
            d.text((kx - 30, ky - 14 + i * 16), line, fill=WHITE, font=F_SMALL_B)
    # Grandchildren under Wong Kar Mun
    gx_root = cx - 240
    grand = [(gx_root - 90, 520, "Lee\nChee Wai"),
             (gx_root + 90, 520, "Chong\nKah Wai")]
    for (gx, gy, name) in grand:
        d.line([gx_root, 410, gx, gy - 30], fill=GRAY_400, width=2)
        d.ellipse([gx - 42, gy - 28, gx + 42, gy + 28], fill=BLUE)
        for i, line in enumerate(name.split("\n")):
            d.text((gx - 24, gy - 14 + i * 16), line, fill=WHITE, font=F_TINY_B)
    # Legend
    d.text((sb_w + 40, H - 100), "● Top referrer", fill=PRIMARY, font=F_SMALL_B)
    d.text((sb_w + 200, H - 100), "● Direct referrals", fill=PURPLE, font=F_SMALL_B)
    d.text((sb_w + 380, H - 100), "● Second-level", fill=BLUE, font=F_SMALL_B)
    highlight_ring(d, sb_w + 162, 110, 130, 36)
    header(d, 3, "Switch to Tree view",
           "See referrer → referrals at a glance. Click any node to drill in.")
    footer(d, "Datin Sarah brought in 3 customers — who brought 2 more. Compound effect.")
    frames.append(img)

    return frames


# ══════════════════════════════════════════════════════════════════════════
# GIF 7 — Performance & reports
# ══════════════════════════════════════════════════════════════════════════
def gif_performance():
    frames = []

    # Frame 1 — Performance KPIs
    img, d, sb_w = crm_shell(
        active_label="Performance",
        page_title="Performance",
        page_subtitle="Your KPIs against target for this month.",
    )
    # 4 KPI cards
    kpis = [
        ("Leads",          "43",       "+12% vs Apr", GREEN_HI),
        ("Deals Won",      "9",        "Target: 10",  ORANGE_HI),
        ("Revenue (RM)",   "38,400",   "+18% vs Apr", GREEN_HI),
        ("Referrals",      "5",        "Target: 6",   ORANGE_HI),
    ]
    for i, (label, val, sub, c) in enumerate(kpis):
        x = sb_w + 24 + i * 232
        d.rounded_rectangle([x, 110, x + 220, 220], radius=8, fill=WHITE,
                            outline=GRAY_200)
        d.text((x + 16, 122), label, fill=GRAY_500, font=F_SMALL_B)
        d.text((x + 16, 142), val, fill=GRAY_900, font=F_BIG_NUM)
        d.text((x + 16, 192), sub, fill=c, font=F_SMALL_B)
    # Two charts placeholder
    # Left: bar chart
    panel(d, sb_w + 24, 240, 540, H - 290, title="Daily revenue — May")
    bx0, by0 = sb_w + 50, H - 100
    bw, gap = 14, 4
    days = 22
    heights = [40, 60, 30, 80, 55, 70, 90, 50, 65, 100, 75, 88, 60, 110, 95,
               72, 80, 130, 100, 88, 95, 70]
    for i, h in enumerate(heights):
        x = bx0 + i * (bw + gap)
        d.rectangle([x, by0 - h, x + bw, by0], fill=PRIMARY)
    d.line([bx0 - 6, by0, bx0 + days * (bw + gap), by0], fill=GRAY_300, width=1)
    # Right: pie-ish summary
    panel(d, sb_w + 584, 240, W - sb_w - 608, H - 290,
          title="Won deals by source")
    cx_, cy_ = sb_w + 720, 420
    # ring slices (approximate)
    d.pieslice([cx_ - 80, cy_ - 80, cx_ + 80, cy_ + 80], 0, 130, fill=PRIMARY)
    d.pieslice([cx_ - 80, cy_ - 80, cx_ + 80, cy_ + 80], 130, 240, fill=PURPLE)
    d.pieslice([cx_ - 80, cy_ - 80, cx_ + 80, cy_ + 80], 240, 320, fill=BLUE)
    d.pieslice([cx_ - 80, cy_ - 80, cx_ + 80, cy_ + 80], 320, 360, fill=ORANGE)
    d.ellipse([cx_ - 40, cy_ - 40, cx_ + 40, cy_ + 40], fill=WHITE)
    lbls = [(PRIMARY, "Facebook (36%)"),
            (PURPLE, "Referral (30%)"),
            (BLUE, "Walk-in (22%)"),
            (ORANGE, "Other (12%)")]
    for i, (c, t) in enumerate(lbls):
        ly = 280 + i * 26
        d.ellipse([cx_ + 110, ly + 3, cx_ + 124, ly + 17], fill=c)
        d.text((cx_ + 132, ly), t, fill=GRAY_700, font=F_SMALL_B)
    header(d, 1, "Read your scoreboard",
           "Big numbers up top, daily trend bottom-left, source mix bottom-right.")
    footer(d, "Numbers under target turn orange. Below 50% turns red.")
    frames.append(img)

    # Frame 2 — Reports list
    img, d, sb_w = crm_shell(
        active_label="Reports",
        page_title="Reports",
        page_subtitle="Saved exports — CSV, XLSX, PDF. Re-run anytime.",
    )
    bx = sb_w + 24
    input_box(d, bx, 110, 240, 36, "Search reports…")
    button(d, bx + 252, 110, 110, 36, "Type v", bg=WHITE, fg=GRAY_700)
    add_x = W - 220
    button(d, add_x, 110, 180, 36, "+ New Report")
    panel(d, bx, 168, W - bx - 24, H - 220, title=None)
    cols = [("Report name", 320), ("Period", 160), ("Last run", 160),
            ("Format", 110), ("Owner", 120)]
    cur = bx + 16
    for label, w in cols:
        d.text((cur, 188), label, fill=GRAY_500, font=F_SMALL_B)
        cur += w
    d.rectangle([bx + 16, 210, W - 40, 211], fill=GRAY_200)
    rows = [
        ("Monthly revenue by source",   "May 2026", "26 May 09:00", "XLSX", "Alice"),
        ("Open cases (Marketing)",      "All",      "29 May 18:00", "CSV",  "Brian"),
        ("Pipeline aging — over 30 days","Live",    "30 May 08:00", "PDF",  "Alice"),
    ]
    for i, row in enumerate(rows):
        ry = 234 + i * 60
        if i == 0:
            d.rounded_rectangle([bx + 4, ry - 12, W - 28, ry + 38],
                                radius=6, fill=PRIMARY_BG)
        cur = bx + 16
        for v, w in zip(row, [c[1] for c in cols]):
            d.text((cur, ry), v, fill=GRAY_900,
                   font=F_BODY_B if i == 0 else F_BODY)
            cur += w
        # Action buttons on far right
        bxa = W - 280
        button(d, bxa, ry - 6, 80, 30, "Run",
               bg=PRIMARY if i == 0 else GRAY_100,
               fg=WHITE if i == 0 else GRAY_700)
        button(d, bxa + 90, ry - 6, 100, 30, "Download",
               bg=GRAY_100, fg=GRAY_700)
        if i == 0:
            highlight_ring(d, bxa, ry - 6, 80, 30)
    header(d, 2, "Pick a saved report — click Run",
           "Reports re-execute against today's data. Download is the last cached file.")
    footer(d, "+ New Report opens the report builder (Super Admin / Marketing Manager only).")
    frames.append(img)

    # Frame 3 — export dialog
    img, d, sb_w = crm_shell(
        active_label="Reports",
        page_title="Reports",
        page_subtitle="Pick a format and the file downloads.",
    )
    img = darken(img, alpha=130)
    d = ImageDraw.Draw(img)
    mx, my, mw, mh = 360, 200, 480, 320
    d.rounded_rectangle([mx, my, mx + mw, my + mh], radius=12, fill=WHITE)
    d.text((mx + 24, my + 20), "Export report", fill=GRAY_900, font=F_TITLE)
    d.text((mx + 24, my + 56), "Monthly revenue by source · May 2026",
           fill=GRAY_500, font=F_SMALL)
    # format options
    formats = [("📄  CSV",  "Plain text, opens in Excel / Sheets",   GRAY_100, GRAY_700),
               ("📊  XLSX", "Formatted spreadsheet with charts",      PRIMARY_BG, PRIMARY),
               ("📕  PDF",  "Print-ready, share with senior team",    GRAY_100, GRAY_700)]
    for i, (icon_label, sub, bg, fg) in enumerate(formats):
        ry = my + 100 + i * 60
        d.rounded_rectangle([mx + 24, ry, mx + mw - 24, ry + 50],
                            radius=8, fill=bg)
        d.text((mx + 36, ry + 8), icon_label, fill=fg, font=F_BODY_B)
        d.text((mx + 36, ry + 28), sub, fill=GRAY_500, font=F_SMALL)
    highlight_ring(d, mx + 24, my + 160, mw - 48, 50, color=PRIMARY)
    button(d, mx + mw - 130, my + mh - 50, 110, 36, "Download")
    header(d, 3, "Pick a format",
           "XLSX is the team default — includes the chart preview.")
    footer(d, "File downloads to your browser's Downloads folder. WhatsApp it to the group.")
    frames.append(img)

    return frames


# ══════════════════════════════════════════════════════════════════════════
# GIF 8 — Knowledge HQ
# ══════════════════════════════════════════════════════════════════════════
def gif_knowledge():
    frames = []

    # Frame 1 — Knowledge HQ landing
    img, d, sb_w = crm_shell(
        active_label="Knowledge HQ",
        page_title="Knowledge HQ",
        page_subtitle="Shared playbooks, scripts, SOPs — the team library.",
    )
    bx = sb_w + 24
    input_box(d, bx, 110, 280, 36, "Search title / tag…")
    button(d, bx + 292, 110, 120, 36, "Category v", bg=WHITE, fg=GRAY_700)
    add_x = W - 200
    button(d, add_x, 110, 160, 36, "+ Upload")
    highlight_ring(d, add_x, 110, 160, 36)
    arrow(d, add_x - 50, 80, add_x - 6, 124)
    # Card grid
    cards = [
        ("📖", "Cold-call script — May 2026", "Sales · 4 min read", PRIMARY),
        ("📋", "Refund handling SOP",          "Cases · 6 min read", PURPLE),
        ("🎯", "Lead qualification checklist", "Sales · 2 min read", GREEN),
        ("📝", "Birthday-month promo flyer",   "Marketing · PDF",    ORANGE),
        ("📚", "Onboarding for new agents",    "HR · 12 min read",   BLUE),
        ("⭐", "Top objections + answers",     "Sales · 5 min read", PRIMARY),
    ]
    for i, (icon, title, meta, c) in enumerate(cards):
        x = sb_w + 24 + (i % 3) * 245
        y = 170 + (i // 3) * 200
        d.rounded_rectangle([x, y, x + 230, y + 180], radius=8, fill=WHITE,
                            outline=GRAY_200)
        d.rounded_rectangle([x, y, x + 230, y + 6], radius=0, fill=c)
        draw_emoji(d, x + 14, y + 16, icon, 30)
        d.text((x + 16, y + 70), title, fill=GRAY_900, font=F_BODY_B)
        d.text((x + 16, y + 120), meta, fill=GRAY_500, font=F_SMALL)
        button(d, x + 16, y + 140, 100, 28, "Open",
               bg=GRAY_100, fg=GRAY_700)
    header(d, 1, "Knowledge HQ — your team playbook",
           "Cards by topic. Search up top, upload on the right.")
    footer(d, "Click + Upload to add a script, SOP, flyer, or anything the team reuses.")
    frames.append(img)

    # Frame 2 — upload modal
    img, d, sb_w = crm_shell(
        active_label="Knowledge HQ",
        page_title="Knowledge HQ",
        page_subtitle="Drag the file in, fill the title + category.",
    )
    img = darken(img, alpha=130)
    d = ImageDraw.Draw(img)
    mx, my, mw, mh = 280, 100, 640, 520
    d.rounded_rectangle([mx, my, mx + mw, my + mh], radius=12, fill=WHITE)
    d.text((mx + 24, my + 20), "Upload to Knowledge HQ", fill=GRAY_900, font=F_TITLE)
    d.text((mx + 24, my + 56),
           "Drop in any file — PDF, DOCX, image, video.",
           fill=GRAY_500, font=F_SMALL)
    # Dropzone
    dz_y = my + 100
    d.rounded_rectangle([mx + 24, dz_y, mx + mw - 24, dz_y + 140],
                        radius=10, outline=PRIMARY, width=2)
    d.rounded_rectangle([mx + 24, dz_y, mx + mw - 24, dz_y + 140],
                        radius=10, fill=PRIMARY_BG, outline=PRIMARY, width=2)
    draw_emoji(d, mx + mw // 2 - 24, dz_y + 28, "📁", 48)
    d.text((mx + mw // 2 - 110, dz_y + 90),
           "Drag a file here or click to browse",
           fill=PRIMARY, font=F_BODY_B)
    # Fields
    def lbl(text, x, y):
        d.text((x, y), text, fill=GRAY_700, font=F_SMALL_B)
    lbl("● Title", mx + 24, my + 270)
    input_box(d, mx + 24, my + 292, mw - 48, 38, "", "Top objections + answers — May 2026")
    lbl("Category", mx + 24, my + 350)
    input_box(d, mx + 24, my + 372, 280, 38, "", "Sales")
    lbl("Tags", mx + 320, my + 350)
    input_box(d, mx + 320, my + 372, mw - 344, 38, "",
              "objection, closing, script")
    button(d, mx + mw - 240, my + mh - 56, 100, 38, "Cancel",
           bg=GRAY_100, fg=GRAY_700)
    bx, by, bw, bh = mx + mw - 130, my + mh - 56, 110, 38
    button(d, bx, by, bw, bh, "Upload")
    highlight_ring(d, bx, by, bw, bh)
    header(d, 2, "Drop the file → fill title + tags",
           "Tags make the search work — be generous with them.")
    footer(d, "Upload syncs to Supabase Storage — the whole team sees it instantly.")
    frames.append(img)

    # Frame 3 — preview the doc
    img, d, sb_w = crm_shell(
        active_label="Knowledge HQ",
        page_title="Top objections + answers",
        page_subtitle="Sales · 5 min read · uploaded by Alice · just now",
    )
    panel(d, sb_w + 24, 110, W - sb_w - 48, H - 170, title=None)
    # tags row
    tags = [("Sales", PRIMARY_BG, PRIMARY),
            ("Closing", PURPLE_BG, PURPLE),
            ("Script", BLUE_BG, BLUE_HI)]
    tx = sb_w + 40
    for (lbl_, bg, fg) in tags:
        status_pill(d, tx, 130, lbl_, bg, fg)
        tx += 100
    # Body content
    by = 180
    d.text((sb_w + 40, by), "Top 5 objections we hear in May",
           fill=GRAY_900, font=F_H2)
    by += 40
    objections = [
        ("\"Too expensive\"",
         "→ Anchor on lifetime value, not one-off price. Show the 3-year package."),
        ("\"Need to ask my spouse\"",
         "→ Offer a joint reading slot — converts 60% of these."),
        ("\"Already tried this before\"",
         "→ Ask what felt missing. Frame our approach as complementary."),
        ("\"Send me info first\"",
         "→ Send 1-pager + book a 15 min call in the same message."),
        ("\"Not the right time\"",
         "→ Park gently, set a 30-day follow-up in the CRM."),
    ]
    for (q, a) in objections:
        d.text((sb_w + 40, by), q, fill=GRAY_900, font=F_BODY_B)
        by += 22
        d.text((sb_w + 60, by), a, fill=GRAY_700, font=F_BODY)
        by += 36
    # Action buttons on the right
    by_b = H - 110
    button(d, W - 380, by_b, 110, 36, "✓ Helpful", bg=GRAY_100, fg=GRAY_700)
    button(d, W - 260, by_b, 110, 36, "✏ Edit", bg=GRAY_100, fg=GRAY_700)
    button(d, W - 140, by_b, 100, 36, "Share")
    highlight_ring(d, W - 140, by_b, 100, 36)
    header(d, 3, "Open + share with the team",
           "Hit Share to copy a deep link — paste it into WhatsApp / email.")
    footer(d, "Edits keep a version history so you never lose the last good copy.")
    frames.append(img)

    return frames


# ══════════════════════════════════════════════════════════════════════════
# GIF 9 — Promotions
# ══════════════════════════════════════════════════════════════════════════
def gif_promotions():
    frames = []

    # Frame 1 — promotions list
    img, d, sb_w = crm_shell(
        active_label="Promotions",
        page_title="Promotions",
        page_subtitle="Discount codes & campaigns — redeemable at checkout.",
    )
    bx = sb_w + 24
    input_box(d, bx, 110, 240, 36, "Search code…")
    button(d, bx + 252, 110, 110, 36, "Status v", bg=WHITE, fg=GRAY_700)
    add_x = W - 200
    button(d, add_x, 110, 160, 36, "+ New Promo")
    highlight_ring(d, add_x, 110, 160, 36)
    arrow(d, add_x - 50, 80, add_x - 6, 124)
    panel(d, bx, 168, W - bx - 24, H - 220, title=None)
    cols = [("Code", 180), ("Discount", 130), ("Valid", 200),
            ("Used", 100), ("Cap", 100), ("Status", 130)]
    cur = bx + 16
    for label, w in cols:
        d.text((cur, 188), label, fill=GRAY_500, font=F_SMALL_B)
        cur += w
    d.rectangle([bx + 16, 210, W - 40, 211], fill=GRAY_200)
    rows = [
        ("MAY15",      "15% off", "1–31 May 2026", "47", "100", "Active"),
        ("BIRTHDAY10", "RM 100",  "All year",      "12", "—",   "Active"),
        ("APRFLASH",   "20% off", "1–7 Apr 2026",  "63", "75",  "Ended"),
    ]
    for i, row in enumerate(rows):
        ry = 234 + i * 56
        cur = bx + 16
        for j, (v, w) in enumerate(zip(row, [c[1] for c in cols])):
            if j == 0:
                d.text((cur, ry), v, fill=PRIMARY, font=F_MONO)
            elif j == 5:
                bg = GREEN_BG if v == "Active" else GRAY_100
                fg = GREEN_HI if v == "Active" else GRAY_700
                status_pill(d, cur, ry - 2, v, bg, fg)
            else:
                d.text((cur, ry), v, fill=GRAY_900, font=F_BODY)
            cur += w
    header(d, 1, "Promotions list",
           "Each code has a percentage / amount discount and a usage cap.")
    footer(d, "+ New Promo creates a discount code you can hand to a customer.")
    frames.append(img)

    # Frame 2 — new promo modal
    img, d, sb_w = crm_shell(
        active_label="Promotions",
        page_title="Promotions",
        page_subtitle="Fill the form — the code is what customers type at checkout.",
    )
    img = darken(img, alpha=130)
    d = ImageDraw.Draw(img)
    mx, my, mw, mh = 280, 90, 640, 540
    d.rounded_rectangle([mx, my, mx + mw, my + mh], radius=12, fill=WHITE)
    d.text((mx + 24, my + 20), "New Promo", fill=GRAY_900, font=F_TITLE)
    d.text((mx + 24, my + 56),
           "Codes are case-insensitive. Keep them short and easy to spell.",
           fill=GRAY_500, font=F_SMALL)
    def lbl(text, x, y):
        d.text((x, y), text, fill=GRAY_700, font=F_SMALL_B)
    lbl("● Code", mx + 24, my + 100)
    input_box(d, mx + 24, my + 122, 300, 38, "", "JUNE20", mono=True)
    lbl("● Discount type", mx + 348, my + 100)
    d.rounded_rectangle([mx + 348, my + 122, mx + 458, my + 160],
                        radius=6, fill=PRIMARY)
    d.text((mx + 372, my + 132), "%  off", fill=WHITE, font=F_BODY_B)
    d.rounded_rectangle([mx + 466, my + 122, mx + 576, my + 160],
                        radius=6, fill=GRAY_100, outline=GRAY_300)
    d.text((mx + 488, my + 132), "RM off", fill=GRAY_700, font=F_BODY)
    lbl("● Amount", mx + 24, my + 180)
    input_box(d, mx + 24, my + 202, 200, 38, "", "20")
    d.text((mx + 230, my + 213), "%", fill=GRAY_500, font=F_BODY_B)
    lbl("Usage cap", mx + 348, my + 180)
    input_box(d, mx + 348, my + 202, 240, 38, "", "150")
    lbl("● Valid from", mx + 24, my + 260)
    input_box(d, mx + 24, my + 282, 240, 38, "", "2026-06-01", mono=True)
    lbl("● Valid to", mx + 288, my + 260)
    input_box(d, mx + 288, my + 282, 240, 38, "", "2026-06-30", mono=True)
    lbl("Applies to", mx + 24, my + 340)
    input_box(d, mx + 24, my + 362, mw - 48, 38, "",
              "All services  ·  or pick specific products")
    lbl("Internal note", mx + 24, my + 410)
    d.rounded_rectangle([mx + 24, my + 432, mx + mw - 24, my + 432 + 50],
                        radius=6, fill=WHITE, outline=GRAY_300)
    d.text((mx + 34, my + 442),
           "Booster campaign — Mid-Year Hidden Talent push.",
           fill=GRAY_900, font=F_BODY)
    button(d, mx + mw - 240, my + mh - 56, 100, 38, "Cancel",
           bg=GRAY_100, fg=GRAY_700)
    bx, by, bw, bh = mx + mw - 130, my + mh - 56, 110, 38
    button(d, bx, by, bw, bh, "Save")
    highlight_ring(d, bx, by, bw, bh)
    header(d, 2, "Fill the promo form",
           "Code, discount, dates, and an optional usage cap. Save activates it.")
    footer(d, "Once saved, the code is live — anyone who types it gets the discount.")
    frames.append(img)

    # Frame 3 — promo live + share card
    img, d, sb_w = crm_shell(
        active_label="Promotions",
        page_title="Promo · JUNE20",
        page_subtitle="20% off, valid 1–30 June. Click the row to see this detail.",
    )
    panel(d, sb_w + 24, 110, 420, H - 170, title="Details")
    rows_d = [("Code",     "JUNE20"),
              ("Discount", "20% off"),
              ("Valid",    "1–30 June 2026"),
              ("Cap",      "150 uses"),
              ("Used",     "0 (just created)"),
              ("Status",   "Active")]
    for i, (k, v) in enumerate(rows_d):
        y = 160 + i * 36
        d.text((sb_w + 40, y), k, fill=GRAY_500, font=F_SMALL_B)
        if k == "Code":
            d.text((sb_w + 180, y), v, fill=PRIMARY, font=F_MONO)
        elif k == "Status":
            status_pill(d, sb_w + 180, y - 2, v, GREEN_BG, GREEN_HI)
        else:
            d.text((sb_w + 180, y), v, fill=GRAY_900, font=F_BODY_B)
    rx = sb_w + 460
    panel(d, rx, 110, W - rx - 24, H - 170, title="Share this promo")
    sc_y = 160
    d.rounded_rectangle([rx + 24, sc_y, W - 48, sc_y + 140],
                        radius=10, fill=PRIMARY_BG)
    d.text((rx + 40, sc_y + 18), "20% OFF",
           fill=PRIMARY, font=F_BIG_NUM)
    d.text((rx + 40, sc_y + 60), "Type code  JUNE20  at booking",
           fill=GRAY_900, font=F_BODY_B)
    d.text((rx + 40, sc_y + 88), "Valid 1–30 June 2026",
           fill=GRAY_700, font=F_SMALL)
    d.text((rx + 40, sc_y + 110), "destinoraclessolution.com",
           fill=PRIMARY, font=F_SMALL_B)
    button(d, rx + 24, sc_y + 170, 160, 36, "Copy code")
    button(d, rx + 192, sc_y + 170, 180, 36, "Download PNG flyer",
           bg=GRAY_100, fg=GRAY_700)
    button(d, rx + 380, sc_y + 170, 140, 36, "WhatsApp",
           bg=GREEN_HI)
    highlight_ring(d, rx + 380, sc_y + 170, 140, 36, color=GREEN_HI)
    tx, ty, tw, th = W - 320, 70, 280, 50
    d.rounded_rectangle([tx, ty, tx + tw, ty + th], radius=8, fill=GREEN_HI)
    d.text((tx + 14, ty + 14), "✓ Promo JUNE20 activated.",
           fill=WHITE, font=F_BODY_B)
    header(d, 3, "Share — three formats",
           "Copy the code, download a flyer, or push to WhatsApp.")
    footer(d, "Redemption counter ticks up each time a customer types the code at checkout.")
    frames.append(img)

    return frames


# ══════════════════════════════════════════════════════════════════════════
# GIF 10 — Marketing Automation
# ══════════════════════════════════════════════════════════════════════════
def gif_automation():
    frames = []

    # Frame 1 — rules list
    img, d, sb_w = crm_shell(
        active_label="Automation",
        page_title="Marketing Automation",
        page_subtitle="Rules that run themselves: trigger → condition → action.",
    )
    bx = sb_w + 24
    button(d, bx, 110, 130, 36, "Active", bg=PRIMARY)
    button(d, bx + 138, 110, 130, 36, "Paused", bg=WHITE, fg=GRAY_700)
    button(d, bx + 276, 110, 150, 36, "Run history",
           bg=WHITE, fg=GRAY_700)
    add_x = W - 200
    button(d, add_x, 110, 160, 36, "+ New Rule")
    highlight_ring(d, add_x, 110, 160, 36)
    arrow(d, add_x - 50, 80, add_x - 6, 124)
    panel(d, bx, 168, W - bx - 24, H - 220, title=None)
    cols = [("Rule name", 340), ("Trigger", 180),
            ("Action", 240), ("Last run", 140), ("Runs", 60)]
    cur = bx + 16
    for label, w in cols:
        d.text((cur, 188), label, fill=GRAY_500, font=F_SMALL_B)
        cur += w
    d.rectangle([bx + 16, 210, W - 40, 211], fill=GRAY_200)
    rows = [
        ("SMS reminder · 1 day before",         "Booking ≤ 24h",
         "Send SMS template #4",                "29 May 18:00", "412"),
        ("Birthday WhatsApp · 2 days before",   "DOB ≤ 48h",
         "Send WhatsApp template",              "30 May 06:00", "89"),
        ("Re-engage · 90 days no contact",      "No activity 90d",
         "Move to 'Cold' + assign Brian",       "30 May 09:00", "24"),
    ]
    for i, row in enumerate(rows):
        ry = 234 + i * 56
        cur = bx + 16
        for j, (v, w) in enumerate(zip(row, [c[1] for c in cols])):
            if j == 0:
                d.text((cur, ry), v, fill=GRAY_900, font=F_BODY_B)
            else:
                d.text((cur, ry), v, fill=GRAY_700, font=F_SMALL)
            cur += w
    header(d, 1, "Your automation rules",
           "Each row runs on its own schedule — no manual action needed.")
    footer(d, "Toggle Paused at any time to stop a rule without deleting it.")
    frames.append(img)

    # Frame 2 — wizard
    img, d, sb_w = crm_shell(
        active_label="Automation",
        page_title="Marketing Automation",
        page_subtitle="Build a rule in 3 steps: When → If → Then.",
    )
    img = darken(img, alpha=130)
    d = ImageDraw.Draw(img)
    mx, my, mw, mh = 200, 100, 800, 520
    d.rounded_rectangle([mx, my, mx + mw, my + mh], radius=12, fill=WHITE)
    d.text((mx + 24, my + 20), "New Automation Rule", fill=GRAY_900, font=F_TITLE)
    d.text((mx + 24, my + 56),
           "Test in Paused mode first — once happy, set to Active.",
           fill=GRAY_500, font=F_SMALL)
    step_y = my + 100
    for i, (label_, color, body) in enumerate([
        ("WHEN  ·  Trigger",
         BLUE,    "Booking is created  ·  AND date is in next 24h"),
        ("IF  ·  Condition",
         PURPLE,  "Customer has phone number  ·  Customer opted in to SMS"),
        ("THEN  ·  Action",
         PRIMARY, "Send SMS using template #4  ·  Log to activity"),
    ]):
        bx0 = mx + 24
        by = step_y + i * 130
        d.ellipse([bx0, by, bx0 + 44, by + 44], fill=color)
        d.text((bx0 + 17, by + 12), str(i + 1), fill=WHITE, font=F_STEP)
        d.rounded_rectangle([bx0 + 60, by, bx0 + mw - 108, by + 110],
                            radius=8, fill=GRAY_50, outline=GRAY_200)
        d.text((bx0 + 76, by + 12), label_, fill=color, font=F_SMALL_B)
        d.text((bx0 + 76, by + 36), body, fill=GRAY_900, font=F_BODY_B)
        button(d, bx0 + mw - 200, by + 12, 80, 28, "Edit",
               bg=WHITE, fg=GRAY_700)
        if i < 2:
            d.line([bx0 + 22, by + 44, bx0 + 22, by + 130],
                   fill=GRAY_300, width=2)
    button(d, mx + mw - 320, my + mh - 56, 110, 38, "Save as Paused",
           bg=GRAY_100, fg=GRAY_700)
    bx2, by2, bw, bh = mx + mw - 200, my + mh - 56, 180, 38
    button(d, bx2, by2, bw, bh, "Activate")
    highlight_ring(d, bx2, by2, bw, bh)
    header(d, 2, "When → If → Then",
           "Pick the trigger, narrow with conditions, define the action.")
    footer(d, "Activating sends real messages. Save as Paused to dry-run first.")
    frames.append(img)

    # Frame 3 — run log
    img, d, sb_w = crm_shell(
        active_label="Automation",
        page_title="Rule · SMS reminder",
        page_subtitle="Run history — every fire is logged.",
    )
    panel(d, sb_w + 24, 110, W - sb_w - 48, H - 170,
          title="Last 7 days · 142 runs · 0 errors")
    for i, (label, val, c) in enumerate(
            [("Runs",      "142", GRAY_900),
             ("Delivered", "138", GREEN_HI),
             ("Failed",    "0",   GREEN_HI),
             ("Opt-outs",  "4",   ORANGE_HI)]):
        x = sb_w + 40 + i * 220
        d.rounded_rectangle([x, 160, x + 200, 240], radius=8, fill=GRAY_50)
        d.text((x + 16, 170), label, fill=GRAY_500, font=F_SMALL_B)
        d.text((x + 16, 194), val, fill=c, font=F_BIG_NUM)
    d.text((sb_w + 40, 260), "Recent runs", fill=GRAY_700, font=F_BODY_B)
    log = [
        ("30 May 06:00", "Sent to Wong Kar Mun · ✓ delivered"),
        ("30 May 06:00", "Sent to Lim Siew Hua · ✓ delivered"),
        ("29 May 18:00", "Sent to Tan Mei Ling · ✓ delivered"),
        ("29 May 18:00", "Sent to Ahmad Rahman · ✓ delivered"),
        ("29 May 06:00", "Skipped Datin Sarah · no opt-in"),
    ]
    for i, (when, what) in enumerate(log):
        ly = 296 + i * 30
        d.text((sb_w + 40, ly), when, fill=GRAY_500, font=F_SMALL_B)
        d.text((sb_w + 180, ly), what, fill=GRAY_700, font=F_BODY)
    bx2, by2, bw, bh = W - 200, 168, 160, 36
    button(d, bx2, by2, bw, bh, "Pause rule",
           bg=GRAY_100, fg=GRAY_700)
    highlight_ring(d, bx2, by2, bw, bh, color=GRAY_500)
    header(d, 3, "Read the run log",
           "Stats up top, individual fires below. Pause anytime.")
    footer(d, "Opt-outs auto-pause the customer — they won't be hit again until they re-opt-in.")
    frames.append(img)

    return frames


# ══════════════════════════════════════════════════════════════════════════
# GIF 11 — Agents & roles
# ══════════════════════════════════════════════════════════════════════════
def gif_agents():
    frames = []

    # Frame 1 — agents list
    img, d, sb_w = crm_shell(
        active_label="Agents",
        page_title="Agents",
        page_subtitle="Your team — roles, KPIs, and access levels.",
    )
    bx = sb_w + 24
    input_box(d, bx, 110, 260, 36, "Search name…")
    button(d, bx + 272, 110, 130, 36, "Role v", bg=WHITE, fg=GRAY_700)
    add_x = W - 200
    button(d, add_x, 110, 160, 36, "+ Add Agent")
    highlight_ring(d, add_x, 110, 160, 36)
    arrow(d, add_x - 50, 80, add_x - 6, 124)
    panel(d, bx, 168, W - bx - 24, H - 220, title=None)
    cols = [("Agent", 240), ("Email", 240), ("Role", 180),
            ("Deals (May)", 130), ("Status", 110)]
    cur = bx + 16
    for label, w in cols:
        d.text((cur, 188), label, fill=GRAY_500, font=F_SMALL_B)
        cur += w
    d.rectangle([bx + 16, 210, W - 40, 211], fill=GRAY_200)
    rows = [
        ("AL", "Alice Lee",  PRIMARY, "alice@destinoraclessolution.com", "Manager",        "12", "Active"),
        ("BR", "Brian Raj",  PURPLE,  "brian@destinoraclessolution.com", "Agent",          "8",  "Active"),
        ("CY", "Chong Yi",   GREEN,   "yi@destinoraclessolution.com",    "Agent",          "5",  "Active"),
        ("MM", "Mei Mei",    BLUE,    "mei@destinoraclessolution.com",   "Marketing Mgr",  "—",  "Active"),
        ("KS", "Kevin Soon", ORANGE,  "kevin@destinoraclessolution.com", "Agent",          "0",  "Onboarding"),
    ]
    for i, (init, name, c, email, role, deals, status) in enumerate(rows):
        ry = 234 + i * 56
        avatar(d, bx + 16, ry - 4, 30, init, bg=c)
        d.text((bx + 54, ry), name, fill=GRAY_900, font=F_BODY_B)
        d.text((bx + 256, ry), email, fill=GRAY_700, font=F_SMALL)
        role_bg = {
            "Super Admin":   (RED_BG,    RED_HI),
            "Marketing Mgr": (PURPLE_BG, PURPLE),
            "Manager":       (PRIMARY_BG, PRIMARY),
            "Agent":         (GRAY_100,  GRAY_700),
        }
        rb, rf = role_bg.get(role, (GRAY_100, GRAY_700))
        status_pill(d, bx + 496, ry - 2, role, rb, rf)
        d.text((bx + 676, ry), deals, fill=GRAY_900, font=F_BODY_B)
        sbg = GREEN_BG if status == "Active" else YELLOW_BG
        sfg = GREEN_HI if status == "Active" else YELLOW_HI
        status_pill(d, bx + 806, ry - 2, status, sbg, sfg)
    header(d, 1, "Agents list",
           "Each row is one team member. Role drives sidebar access.")
    footer(d, "Only Super Admin and Marketing Manager can add or edit roles.")
    frames.append(img)

    # Frame 2 — add agent modal
    img, d, sb_w = crm_shell(
        active_label="Agents",
        page_title="Agents",
        page_subtitle="Invite a new team member — they'll get an email to set their password.",
    )
    img = darken(img, alpha=130)
    d = ImageDraw.Draw(img)
    mx, my, mw, mh = 280, 100, 640, 520
    d.rounded_rectangle([mx, my, mx + mw, my + mh], radius=12, fill=WHITE)
    d.text((mx + 24, my + 20), "Add Agent", fill=GRAY_900, font=F_TITLE)
    d.text((mx + 24, my + 56),
           "Email + role is enough — system sends invite to set password.",
           fill=GRAY_500, font=F_SMALL)
    def lbl(text, x, y):
        d.text((x, y), text, fill=GRAY_700, font=F_SMALL_B)
    lbl("● Full name", mx + 24, my + 100)
    input_box(d, mx + 24, my + 122, mw - 48, 38, "", "Lim Pei Ying")
    lbl("● Work email", mx + 24, my + 180)
    input_box(d, mx + 24, my + 202, mw - 48, 38, "",
              "peiying@destinoraclessolution.com")
    lbl("● Role", mx + 24, my + 260)
    roles = [
        ("Manager",       "Level 2",  PRIMARY_BG, PRIMARY,
         "Sees own team's KPIs + all sales modules"),
        ("Agent",         "Level 3+", GRAY_100,   GRAY_700,
         "Sees own pipeline, prospects, calendar, cases"),
        ("Marketing Mgr", "Level 2",  PURPLE_BG,  PURPLE,
         "Campaigns, reports, automation — usually 1 person"),
    ]
    for i, (name, lvl, bg, fg, desc) in enumerate(roles):
        ry = my + 282 + i * 64
        is_selected = i == 1
        d.rounded_rectangle([mx + 24, ry, mx + mw - 24, ry + 54],
                            radius=8, fill=bg,
                            outline=PRIMARY if is_selected else None,
                            width=2 if is_selected else 0)
        d.text((mx + 40, ry + 8), name, fill=fg, font=F_BODY_B)
        d.text((mx + 200, ry + 8), lvl, fill=GRAY_500, font=F_SMALL_B)
        d.text((mx + 40, ry + 30), desc, fill=GRAY_700, font=F_SMALL)
        if is_selected:
            d.ellipse([mx + mw - 48, ry + 18, mx + mw - 28, ry + 38],
                      fill=PRIMARY)
            d.text((mx + mw - 42, ry + 22), "✓", fill=WHITE, font=F_SMALL_B)
    button(d, mx + mw - 280, my + mh - 56, 100, 38, "Cancel",
           bg=GRAY_100, fg=GRAY_700)
    bx, by, bw, bh = mx + mw - 170, my + mh - 56, 150, 38
    button(d, bx, by, bw, bh, "Send invite")
    highlight_ring(d, bx, by, bw, bh)
    header(d, 2, "Pick the role",
           "Click a card to assign. Send invite emails the new agent.")
    footer(d, "New agent appears as 'Onboarding' until they set their password.")
    frames.append(img)

    # Frame 3 — agent profile
    img, d, sb_w = crm_shell(
        active_label="Agents",
        page_title="Brian Raj",
        page_subtitle="Agent · Joined Jan 2026 · 8 deals won in May",
    )
    panel(d, sb_w + 24, 110, 320, H - 170, title="Profile")
    avatar(d, sb_w + 60, 160, 80, "BR", bg=PURPLE)
    d.text((sb_w + 160, 168), "Brian Raj", fill=GRAY_900, font=F_TITLE)
    status_pill(d, sb_w + 160, 200, "Agent", GRAY_100, GRAY_700)
    info = [("Email",   "brian@destinoraclessolution.com"),
            ("Phone",   "012-980 1188"),
            ("Joined",  "2026-01-15"),
            ("Manager", "Alice Lee")]
    for i, (k, v) in enumerate(info):
        y = 260 + i * 40
        d.text((sb_w + 60, y), k, fill=GRAY_500, font=F_SMALL_B)
        d.text((sb_w + 60, y + 18), v, fill=GRAY_900, font=F_BODY)
    button(d, sb_w + 60, H - 110, 130, 36, "✏ Edit profile",
           bg=GRAY_100, fg=GRAY_700)
    button(d, sb_w + 200, H - 110, 130, 36, "Reset password",
           bg=GRAY_100, fg=GRAY_700)
    rx = sb_w + 360
    panel(d, rx, 110, W - rx - 24, H - 170, title="KPIs · May 2026")
    kpis = [("Leads",        "18",     "Target 20", ORANGE_HI),
            ("Deals Won",    "8",      "Target 8",  GREEN_HI),
            ("Revenue (RM)", "24,600", "+15%",      GREEN_HI),
            ("Open cases",   "2",      "—",         GRAY_900)]
    for i, (label, val, sub, c) in enumerate(kpis):
        col = i % 2
        row = i // 2
        x = rx + 24 + col * 240
        y = 160 + row * 110
        d.rounded_rectangle([x, y, x + 220, y + 90], radius=8, fill=WHITE,
                            outline=GRAY_200)
        d.text((x + 16, y + 8), label, fill=GRAY_500, font=F_SMALL_B)
        d.text((x + 16, y + 28), val, fill=GRAY_900, font=F_BIG_NUM)
        d.text((x + 16, y + 70), sub, fill=c, font=F_SMALL_B)
    d.text((rx + 24, 400), "Recent activity", fill=GRAY_500, font=F_SMALL_B)
    d.rectangle([rx + 24, 422, W - 48, 423], fill=GRAY_200)
    log = [("30 May", "Marked Won: Ahmad Rahman — RM 1,500"),
           ("29 May", "Moved to Qualified: Lee Chee Wai"),
           ("28 May", "Logged 4 follow-up calls")]
    for i, (when, what) in enumerate(log):
        ly = 434 + i * 26
        d.text((rx + 24, ly), when, fill=GRAY_500, font=F_SMALL_B)
        d.text((rx + 100, ly), what, fill=GRAY_700, font=F_SMALL)
    header(d, 3, "Click an agent for their profile",
           "Manager view: their KPIs, recent activity, and admin actions.")
    footer(d, "Reset password emails the agent a temporary one — they change it on next sign-in.")
    frames.append(img)

    return frames


# ══════════════════════════════════════════════════════════════════════════
# GIF 12 — Documents
# ══════════════════════════════════════════════════════════════════════════
def gif_documents():
    frames = []

    # Frame 1 — library
    img, d, sb_w = crm_shell(
        active_label="Documents",
        page_title="Documents",
        page_subtitle="Customer-facing files — contracts, reports, receipts.",
    )
    bx = sb_w + 24
    input_box(d, bx, 110, 240, 36, "Search files…")
    button(d, bx + 252, 110, 110, 36, "Type v", bg=WHITE, fg=GRAY_700)
    button(d, bx + 370, 110, 130, 36, "Linked to v", bg=WHITE, fg=GRAY_700)
    add_x = W - 200
    button(d, add_x, 110, 160, 36, "+ Upload")
    highlight_ring(d, add_x, 110, 160, 36)
    arrow(d, add_x - 50, 80, add_x - 6, 124)
    # Folder strip
    folders = [("Contracts", PRIMARY),
               ("Reports",   PURPLE),
               ("Receipts",  GREEN),
               ("ID copies", BLUE),
               ("Misc",      ORANGE)]
    for i, (name, c) in enumerate(folders):
        fx = bx + i * 190
        d.rounded_rectangle([fx, 168, fx + 170, 220], radius=8, fill=WHITE,
                            outline=GRAY_200)
        d.rectangle([fx, 168, fx + 8, 220], fill=c)
        draw_emoji(d, fx + 16, 176, "📁", 28)
        d.text((fx + 56, 178), name, fill=GRAY_900, font=F_BODY_B)
        d.text((fx + 56, 198),
               f"{12 + i * 4} files", fill=GRAY_500, font=F_SMALL)
    # Recent files
    panel(d, bx, 240, W - bx - 24, H - 290, title="Recent files")
    files = [
        ("📄", "Contract — Datin Sarah (3-year).pdf",  "Contracts", "30 May 14:00", "Alice"),
        ("📊", "BaZi report — Wong Kar Mun.docx",      "Reports",   "30 May 09:14", "Brian"),
        ("📑", "Receipt — JUNE20 redemption.pdf",      "Receipts",  "29 May 18:00", "System"),
        ("🪪", "IC copy — Tan Mei Ling.jpg",           "ID copies", "28 May 11:22", "Alice"),
        ("📷", "Birthday flyer May 2026.png",          "Misc",      "26 May 09:00", "Mei Mei"),
    ]
    for i, (icon, name, folder, when, by_) in enumerate(files):
        ry = 290 + i * 50
        draw_emoji(d, bx + 16, ry, icon, 20)
        d.text((bx + 50, ry + 2), name, fill=GRAY_900, font=F_BODY_B)
        d.text((bx + 510, ry + 4), folder, fill=GRAY_500, font=F_SMALL)
        d.text((bx + 640, ry + 4), when, fill=GRAY_500, font=F_SMALL)
        d.text((bx + 780, ry + 4), by_, fill=GRAY_700, font=F_SMALL_B)
        button(d, bx + 880, ry, 60, 28, "Open",
               bg=GRAY_100, fg=GRAY_700)
    header(d, 1, "Documents library",
           "Folders by type up top, latest files below.")
    footer(d, "+ Upload accepts PDF, DOCX, images, anything ≤ 25 MB.")
    frames.append(img)

    # Frame 2 — upload modal
    img, d, sb_w = crm_shell(
        active_label="Documents",
        page_title="Documents",
        page_subtitle="Drag a file in — it links to the customer automatically.",
    )
    img = darken(img, alpha=130)
    d = ImageDraw.Draw(img)
    mx, my, mw, mh = 280, 100, 640, 520
    d.rounded_rectangle([mx, my, mx + mw, my + mh], radius=12, fill=WHITE)
    d.text((mx + 24, my + 20), "Upload document", fill=GRAY_900, font=F_TITLE)
    d.text((mx + 24, my + 56),
           "Picks the folder from the file type. You can change it after.",
           fill=GRAY_500, font=F_SMALL)
    dz_y = my + 100
    d.rounded_rectangle([mx + 24, dz_y, mx + mw - 24, dz_y + 140],
                        radius=10, fill=GREEN_BG, outline=GREEN_HI, width=2)
    draw_emoji(d, mx + 60, dz_y + 30, "📄", 60)
    d.text((mx + 140, dz_y + 36),
           "Contract — Wong Kar Mun (3-year).pdf",
           fill=GRAY_900, font=F_BODY_B)
    d.text((mx + 140, dz_y + 64),
           "PDF · 2.4 MB · ready to upload",
           fill=GREEN_HI, font=F_SMALL_B)
    button(d, mx + mw - 160, dz_y + 50, 60, 28, "Remove",
           bg=GRAY_100, fg=GRAY_700)
    def lbl(text, x, y):
        d.text((x, y), text, fill=GRAY_700, font=F_SMALL_B)
    lbl("Folder", mx + 24, my + 270)
    input_box(d, mx + 24, my + 292, 280, 38, "", "Contracts")
    lbl("Link to customer", mx + 320, my + 270)
    input_box(d, mx + 320, my + 292, 272, 38, "", "Wong Kar Mun")
    lbl("Visible to", mx + 24, my + 350)
    chips = [("Just me",  GRAY_100,   GRAY_700),
             ("My team",  PRIMARY_BG, PRIMARY),
             ("Everyone", PURPLE_BG,  PURPLE)]
    for i, (label, bg, fg) in enumerate(chips):
        cx = mx + 24 + i * 130
        is_selected = i == 1
        d.rounded_rectangle([cx, my + 372, cx + 120, my + 408],
                            radius=18, fill=bg,
                            outline=fg if is_selected else None,
                            width=2 if is_selected else 0)
        bbox = d.textbbox((0, 0), label, font=F_BODY_B)
        tw = bbox[2] - bbox[0]
        d.text((cx + (120 - tw) // 2, my + 380), label,
               fill=fg, font=F_BODY_B)
    button(d, mx + mw - 240, my + mh - 56, 100, 38, "Cancel",
           bg=GRAY_100, fg=GRAY_700)
    bx, by, bw, bh = mx + mw - 130, my + mh - 56, 110, 38
    button(d, bx, by, bw, bh, "Upload")
    highlight_ring(d, bx, by, bw, bh)
    header(d, 2, "Drop the file, pick visibility",
           "Linking to a customer makes it show in their profile too.")
    footer(d, "Just me = private. My team = your reports. Everyone = company-wide.")
    frames.append(img)

    # Frame 3 — preview
    img, d, sb_w = crm_shell(
        active_label="Documents",
        page_title="Contract — Wong Kar Mun (3-year).pdf",
        page_subtitle="2.4 MB · uploaded by Alice · just now · linked to Wong Kar Mun",
    )
    panel(d, sb_w + 24, 110, 460, H - 170, title=None)
    px, py, pw, ph = sb_w + 40, 130, 428, H - 210
    d.rounded_rectangle([px, py, px + pw, py + ph], radius=6, fill=WHITE,
                        outline=GRAY_300)
    d.text((px + 28, py + 30), "DESTIN ORACLES SOLUTION",
           fill=GRAY_900, font=F_H2)
    d.text((px + 28, py + 60), "Service Agreement",
           fill=GRAY_500, font=F_BODY)
    d.rectangle([px + 28, py + 90, px + pw - 28, py + 91], fill=GRAY_300)
    for i in range(8):
        ly = py + 110 + i * 28
        line_w = pw - 56 - (i * 10 if i % 3 == 2 else 0)
        d.rounded_rectangle([px + 28, ly, px + 28 + line_w, ly + 8],
                            radius=2, fill=GRAY_200)
    d.text((px + 28, py + ph - 100), "Customer signature:",
           fill=GRAY_500, font=F_SMALL_B)
    d.line([px + 28, py + ph - 50, px + 220, py + ph - 50],
           fill=GRAY_400, width=1)
    d.text((px + pw - 100, py + ph - 28), "Page 1 / 6",
           fill=GRAY_500, font=F_TINY)
    rx = sb_w + 500
    panel(d, rx, 110, W - rx - 24, H - 170, title="Details")
    meta = [("Folder",   "Contracts"),
            ("Linked",   "Wong Kar Mun"),
            ("Uploader", "Alice Lee"),
            ("Size",     "2.4 MB"),
            ("Visible",  "My team")]
    for i, (k, v) in enumerate(meta):
        y = 160 + i * 36
        d.text((rx + 24, y), k, fill=GRAY_500, font=F_SMALL_B)
        d.text((rx + 24, y + 18), v, fill=GRAY_900, font=F_BODY_B)
    button(d, rx + 24, 360, W - rx - 72, 40, "Download")
    button(d, rx + 24, 410, W - rx - 72, 40, "Share link",
           bg=GRAY_100, fg=GRAY_700)
    button(d, rx + 24, 460, W - rx - 72, 40, "Send via WhatsApp",
           bg=GREEN_HI)
    highlight_ring(d, rx + 24, 460, W - rx - 72, 40, color=GREEN_HI)
    button(d, rx + 24, 540, W - rx - 72, 40, "Delete",
           bg=WHITE, fg=RED_HI)
    header(d, 3, "Open the file",
           "Preview on the left, actions on the right.")
    footer(d, "Send via WhatsApp pushes the file to the linked customer's number.")
    frames.append(img)

    return frames


# ══════════════════════════════════════════════════════════════════════════
# GIF 13 — AI Insights Dashboard
# ══════════════════════════════════════════════════════════════════════════
def gif_ai_insights():
    frames = []

    img, d, sb_w = crm_shell(
        active_label="",
        page_title="AI Insights",
        page_subtitle="Top-bar  AI ▸ Insights  — what the model spotted overnight.",
    )
    # Header card
    panel(d, sb_w + 24, 110, W - sb_w - 48, 80, title=None,
          fill=PURPLE_BG)
    d.text((sb_w + 40, 124), "Overnight scan · 30 May 2026",
           fill=PURPLE, font=F_BODY_B)
    d.text((sb_w + 40, 152),
           "6 actionable signals across your book.",
           fill=GRAY_700, font=F_SMALL)
    # Signal cards
    signals = [
        ("🔥", "5 hot leads need a call today",
         "Auto-scored ≥ 80. Open the Lead Scoring page.", PRIMARY),
        ("⚠", "3 customers at churn risk",
         "No activity 45+ days + sentiment drop.", ORANGE),
        ("💰", "RM 18,200 in pipeline likely to close",
         "Deals in Proposal stage 14+ days.", GREEN),
        ("📉", "Brian's win rate dropped 18%",
         "Vs Apr. Check his last 10 deal logs.", RED),
        ("⭐", "Datin Sarah pattern detected",
         "Top referrer's network keeps converting.", PURPLE),
        ("📞", "Best time to call: 11am–1pm",
         "62% pickup rate (vs 38% avg).", BLUE),
    ]
    for i, (icon, title, sub, c) in enumerate(signals):
        x = sb_w + 24 + (i % 3) * 313
        y = 210 + (i // 3) * 200
        d.rounded_rectangle([x, y, x + 295, y + 180],
                            radius=10, fill=WHITE, outline=GRAY_200)
        d.rectangle([x, y, x + 6, y + 180], fill=c)
        draw_emoji(d, x + 18, y + 14, icon, 30)
        d.text((x + 18, y + 60), title, fill=GRAY_900, font=F_BODY_B)
        d.text((x + 18, y + 100), sub, fill=GRAY_600, font=F_SMALL)
        button(d, x + 18, y + 138, 100, 28, "Open",
               bg=PURPLE_BG, fg=PURPLE)
    header(d, 1, "AI Insights — your morning brief",
           "Six cards highlight what changed overnight. Click any to drill in.")
    footer(d, "Insights refresh nightly. Click Open to act on the underlying records.")
    frames.append(img)

    # Frame 2 — drill into one signal
    img, d, sb_w = crm_shell(
        active_label="",
        page_title="AI ▸ Hot leads need a call",
        page_subtitle="5 leads with AI score ≥ 80 — sorted by score.",
    )
    panel(d, sb_w + 24, 110, W - sb_w - 48, H - 170, title=None)
    cols = [("Lead", 220), ("Score", 100), ("Why hot",  360),
            ("Last contact", 160), ("Action", 140)]
    cur = sb_w + 40
    for label, w in cols:
        d.text((cur, 130), label, fill=GRAY_500, font=F_SMALL_B)
        cur += w
    d.rectangle([sb_w + 40, 152, W - 40, 153], fill=GRAY_200)
    rows = [
        ("Wong Kar Mun", "94", "Opened email + form 3×, on website 18 min", "Today",     PRIMARY),
        ("Tan Mei Ling", "88", "Asked for pricing twice, referrer is top customer", "Yesterday", PRIMARY),
        ("Ahmad Rahman", "85", "Booked + cancelled twice — fence-sitter",  "2 days ago", ORANGE),
        ("Lim Pei Ying", "82", "Birthday this week + opted in to promo",   "3 days ago", ORANGE),
        ("Chong Yi Han", "80", "Came from Datin Sarah referral",            "5 days ago", ORANGE),
    ]
    for i, (name, score, why, last, c) in enumerate(rows):
        ry = 176 + i * 64
        d.text((sb_w + 40, ry), name, fill=GRAY_900, font=F_BODY_B)
        # Score badge
        d.rounded_rectangle([sb_w + 260, ry - 4, sb_w + 320, ry + 28],
                            radius=14, fill=c)
        d.text((sb_w + 274, ry), score, fill=WHITE, font=F_BODY_B)
        d.text((sb_w + 360, ry), why, fill=GRAY_700, font=F_SMALL)
        d.text((sb_w + 720, ry), last, fill=GRAY_500, font=F_SMALL)
        button(d, sb_w + 880, ry - 4, 130, 30, "Call now")
    highlight_ring(d, sb_w + 880, 172, 130, 30)
    header(d, 2, "Drill in — call hot leads first",
           "Sorted by score descending. Pink = highest urgency.")
    footer(d, "Tip: open in 5 separate tabs so you can rip through all 5 calls.")
    frames.append(img)

    # Frame 3 — settings / how scoring works
    img, d, sb_w = crm_shell(
        active_label="",
        page_title="AI ▸ Settings",
        page_subtitle="Tune what the model weighs.",
    )
    panel(d, sb_w + 24, 110, W - sb_w - 48, H - 170,
          title="Lead-scoring weights · saved")
    weights = [("Recency of contact",    "30%",   PRIMARY),
               ("Engagement (opens, clicks)", "25%",   PURPLE),
               ("Source quality",         "15%",   BLUE),
               ("Referrer's track record", "15%",   GREEN),
               ("Time on site",           "10%",   ORANGE),
               ("BaZi compatibility",     "5%",    GRAY_500)]
    by = 160
    for (label, val, c) in weights:
        d.text((sb_w + 40, by), label, fill=GRAY_900, font=F_BODY_B)
        d.text((W - 200, by), val, fill=c, font=F_BODY_B)
        # bar
        bw_pct = int(label.split()[0] != "BaZi" and int(val[:-1]) * 8 or 40)
        d.rounded_rectangle([sb_w + 40, by + 26, W - 80, by + 32],
                            radius=3, fill=GRAY_100)
        d.rounded_rectangle([sb_w + 40, by + 26, sb_w + 40 + int(val[:-1]) * 8, by + 32],
                            radius=3, fill=c)
        by += 58
    d.text((sb_w + 40, by + 20),
           "Note: the 'BaZi compatibility' factor is hidden from customer-visible reports.",
           fill=GRAY_500, font=F_SMALL_B)
    button(d, W - 220, H - 110, 160, 36, "Save & re-score")
    highlight_ring(d, W - 220, H - 110, 160, 36)
    header(d, 3, "Tune the weights",
           "Pick what matters to your business. Re-score recalculates overnight.")
    footer(d, "Marketing Manager / Super Admin only. Default weights work for most teams.")
    frames.append(img)

    return frames


# ══════════════════════════════════════════════════════════════════════════
# GIF 14 — Lead Scoring
# ══════════════════════════════════════════════════════════════════════════
def gif_lead_scoring():
    frames = []

    img, d, sb_w = crm_shell(
        active_label="",
        page_title="Lead Scoring",
        page_subtitle="Every prospect ranked 0–100 — focus your time on the top.",
    )
    bx = sb_w + 24
    # Buckets row
    buckets = [("Hot (80+)",   "12", PRIMARY, PRIMARY_BG),
               ("Warm (50–79)", "28", ORANGE,  ORANGE_BG),
               ("Cold (<50)",   "73", GRAY_500, GRAY_100),
               ("Unranked",     "5",  GRAY_400, GRAY_50)]
    for i, (label, val, c, bg) in enumerate(buckets):
        x = bx + i * 232
        d.rounded_rectangle([x, 110, x + 220, 200], radius=10, fill=bg)
        d.text((x + 18, 122), label, fill=c, font=F_BODY_B)
        d.text((x + 18, 146), val, fill=c, font=F_BIG_NUM)
        d.text((x + 18, 184), "prospects", fill=GRAY_600, font=F_SMALL)
    # Highlight the hot bucket
    highlight_ring(d, bx, 110, 220, 90, color=PRIMARY)
    # Filter + table
    button(d, bx, 220, 130, 36, "All",  bg=PRIMARY)
    button(d, bx + 138, 220, 130, 36, "Hot only", bg=WHITE, fg=GRAY_700)
    button(d, bx + 276, 220, 130, 36, "Warm only", bg=WHITE, fg=GRAY_700)
    panel(d, bx, 270, W - bx - 24, H - 320, title=None)
    cols = [("Lead", 220), ("Score", 90), ("Trend", 110),
            ("Reason", 360), ("Stage", 140)]
    cur = bx + 16
    for label, w in cols:
        d.text((cur, 290), label, fill=GRAY_500, font=F_SMALL_B)
        cur += w
    d.rectangle([bx + 16, 312, W - 40, 313], fill=GRAY_200)
    rows = [
        ("Wong Kar Mun", 94, "↑ +8",  "Email open 3×, on site 18 min",      "Qualified",  PRIMARY),
        ("Tan Mei Ling", 88, "↑ +5",  "Asked pricing twice",                 "Contacted",  PRIMARY),
        ("Ahmad Rahman", 72, "→  0",  "Fence-sitter — cancelled twice",      "Contacted",  ORANGE),
        ("Lim Siew Hua", 65, "↓ −3",  "No reply to last 2 follow-ups",       "Contacted",  ORANGE),
        ("Lee Chee Wai", 42, "↓ −11", "Cold — referred by lapsed customer",  "New",        GRAY_500),
    ]
    for i, (name, score, trend, why, stage, c) in enumerate(rows):
        ry = 336 + i * 52
        d.text((bx + 16, ry), name, fill=GRAY_900, font=F_BODY_B)
        # score chip
        d.rounded_rectangle([bx + 236, ry - 4, bx + 296, ry + 28],
                            radius=14, fill=c)
        d.text((bx + 252, ry), str(score), fill=WHITE, font=F_BODY_B)
        # trend
        tcolor = GREEN_HI if trend.startswith("↑") else (RED_HI if trend.startswith("↓") else GRAY_500)
        d.text((bx + 326, ry), trend, fill=tcolor, font=F_BODY_B)
        d.text((bx + 436, ry), why, fill=GRAY_700, font=F_SMALL)
        d.text((bx + 796, ry), stage, fill=GRAY_700, font=F_BODY)
    header(d, 1, "Hot first, cold last",
           "Trend column tells you if the score moved this week. Up = act now.")
    footer(d, "Click any row to open the prospect's full timeline.")
    frames.append(img)

    # Frame 2 — drill into a lead's score factors
    img, d, sb_w = crm_shell(
        active_label="",
        page_title="Wong Kar Mun · Score 94",
        page_subtitle="What's driving the score — and what would push it higher.",
    )
    # Big score circle on left
    panel(d, sb_w + 24, 110, 360, H - 170, title=None)
    cx_, cy_ = sb_w + 200, 230
    d.ellipse([cx_ - 70, cy_ - 70, cx_ + 70, cy_ + 70], fill=PRIMARY)
    d.text((cx_ - 30, cy_ - 22), "94", fill=WHITE, font=_font(48, bold=True))
    d.text((cx_ - 22, cy_ + 18), "Hot", fill=WHITE, font=F_BODY_B)
    d.text((sb_w + 80, 330), "Score moved", fill=GRAY_500, font=F_SMALL_B)
    d.text((sb_w + 80, 352), "+8 in past 7 days", fill=GREEN_HI, font=F_H2)
    # Sparkline
    pts = [(sb_w + 80 + i * 30, 440 - h * 3)
           for i, h in enumerate([12, 14, 18, 22, 28, 32, 40])]
    for i in range(len(pts) - 1):
        d.line([pts[i], pts[i + 1]], fill=PRIMARY, width=3)
    for p in pts:
        d.ellipse([p[0] - 4, p[1] - 4, p[0] + 4, p[1] + 4], fill=PRIMARY)
    d.text((sb_w + 80, 460), "Mon  Tue  Wed  Thu  Fri  Sat  Sun",
           fill=GRAY_500, font=F_TINY_B)
    # Right: factor breakdown
    rx = sb_w + 400
    panel(d, rx, 110, W - rx - 24, H - 170, title="Why 94?")
    factors = [("Email opens (3 this week)",  "+22", GREEN),
               ("On-site time 18 min",          "+18", GREEN),
               ("Referrer is top customer",     "+15", GREEN),
               ("Source: Facebook Ad",          "+8",  GREEN),
               ("BaZi compatibility",           "+5",  GREEN),
               ("Hasn't replied to last SMS",   "−4",  RED)]
    for i, (k, v, c) in enumerate(factors):
        y = 160 + i * 38
        d.text((rx + 24, y), k, fill=GRAY_900, font=F_BODY)
        d.text((W - 130, y), v, fill=c, font=F_BODY_B)
    # Recommendation
    d.rounded_rectangle([rx + 24, H - 200, W - 48, H - 110],
                        radius=10, fill=PRIMARY_BG)
    d.text((rx + 40, H - 188), "Next best action",
           fill=PRIMARY, font=F_SMALL_B)
    d.text((rx + 40, H - 168),
           "Call within 24h. 73% close-rate at this score.",
           fill=GRAY_900, font=F_BODY_B)
    button(d, rx + 40, H - 138, 140, 30, "Schedule call")
    highlight_ring(d, rx + 40, H - 138, 140, 30)
    header(d, 2, "The score isn't magic — see why",
           "Positive factors in green, drag-down factors in red.")
    footer(d, "Schedule call drops a booking into your calendar for the next free slot.")
    frames.append(img)

    return frames


# ══════════════════════════════════════════════════════════════════════════
# GIF 15 — Sales Forecast
# ══════════════════════════════════════════════════════════════════════════
def gif_sales_forecast():
    frames = []

    img, d, sb_w = crm_shell(
        active_label="",
        page_title="Sales Forecast",
        page_subtitle="AI-projected revenue for next 90 days, by confidence band.",
    )
    # KPI strip
    kpis = [("Locked",     "RM 24,800", "Won + signed",         GREEN_HI),
            ("Likely",     "RM 38,600", "P > 70%",              PRIMARY),
            ("At-risk",    "RM 12,400", "P 30–70%",             ORANGE_HI),
            ("Stretch",    "RM 8,200",  "P < 30%",              GRAY_600)]
    for i, (label, val, sub, c) in enumerate(kpis):
        x = sb_w + 24 + i * 232
        d.rounded_rectangle([x, 110, x + 220, 200], radius=8, fill=WHITE,
                            outline=GRAY_200)
        d.text((x + 16, 122), label, fill=GRAY_500, font=F_SMALL_B)
        d.text((x + 16, 142), val, fill=c, font=F_BIG_NUM)
        d.text((x + 16, 182), sub, fill=GRAY_500, font=F_SMALL)
    # Forecast chart
    panel(d, sb_w + 24, 220, W - sb_w - 48, H - 270,
          title="90-day forecast · updated nightly")
    # axes baseline
    ax_x = sb_w + 60
    ax_y = H - 110
    d.line([ax_x, ax_y, W - 60, ax_y], fill=GRAY_300, width=1)
    d.line([ax_x, ax_y, ax_x, 270], fill=GRAY_300, width=1)
    # Three projection lines
    import math as _m
    n_pts = 30
    span = W - 60 - ax_x
    # Likely (solid pink)
    pts_likely = []
    for i in range(n_pts):
        x = ax_x + i * (span / (n_pts - 1))
        h = 50 + 30 * _m.sin(i * 0.3) + i * 4
        pts_likely.append((x, ax_y - h))
    # Optimistic (dashed green)
    pts_opt = [(p[0], p[1] - 40 - i * 2) for i, p in enumerate(pts_likely)]
    # Pessimistic (dashed gray)
    pts_pess = [(p[0], p[1] + 30 + i * 1) for i, p in enumerate(pts_likely)]
    # Confidence band shading
    band_pts = pts_opt + list(reversed(pts_pess))
    d.polygon(band_pts, fill=(253, 232, 243))
    # Lines
    for i in range(len(pts_likely) - 1):
        d.line([pts_likely[i], pts_likely[i + 1]], fill=PRIMARY, width=3)
    # Dashed opt/pess
    for pts, col in [(pts_opt, GREEN_HI), (pts_pess, GRAY_500)]:
        for i in range(0, len(pts) - 1, 2):
            d.line([pts[i], pts[i + 1]], fill=col, width=2)
    # Labels
    d.text((ax_x + 10, 260), "RM", fill=GRAY_500, font=F_SMALL_B)
    d.text((W - 200, ax_y + 10), "30 / 60 / 90 days",
           fill=GRAY_500, font=F_SMALL_B)
    # Legend
    lx, ly = sb_w + 60, H - 90
    d.line([lx, ly, lx + 24, ly], fill=PRIMARY, width=3)
    d.text((lx + 30, ly - 8), "Most likely",   fill=GRAY_700, font=F_SMALL_B)
    d.line([lx + 140, ly, lx + 164, ly], fill=GREEN_HI, width=2)
    d.text((lx + 170, ly - 8), "Optimistic",   fill=GRAY_700, font=F_SMALL_B)
    d.line([lx + 290, ly, lx + 314, ly], fill=GRAY_500, width=2)
    d.text((lx + 320, ly - 8), "Pessimistic",  fill=GRAY_700, font=F_SMALL_B)
    header(d, 1, "Where is the next 90 days headed?",
           "Pink = most likely. Green + grey lines = the spread either way.")
    footer(d, "Locked + Likely sums to RM 63,400. The model is 84% accurate on 60-day calls.")
    frames.append(img)

    # Frame 2 — deal-by-deal breakdown
    img, d, sb_w = crm_shell(
        active_label="",
        page_title="Forecast · Deal contributions",
        page_subtitle="Which specific deals make up the number.",
    )
    panel(d, sb_w + 24, 110, W - sb_w - 48, H - 170, title=None)
    cols = [("Deal", 240), ("Stage", 140), ("Value", 130),
            ("P(close)", 100), ("Expected", 130), ("Owner", 100)]
    cur = sb_w + 40
    for label, w in cols:
        d.text((cur, 130), label, fill=GRAY_500, font=F_SMALL_B)
        cur += w
    d.rectangle([sb_w + 40, 152, W - 40, 153], fill=GRAY_200)
    rows = [
        ("Wong Kar Mun · 3-yr",    "Proposal",  "RM 12,000", "85%", "RM 10,200", "Alice"),
        ("Tan Mei Ling · annual",   "Qualified", "RM 4,800",  "70%", "RM 3,360",  "Alice"),
        ("Chong Kah Wai · 3-yr",    "Proposal",  "RM 12,000", "65%", "RM 7,800",  "Brian"),
        ("Lim Siew Hua · annual",   "Qualified", "RM 4,800",  "55%", "RM 2,640",  "Alice"),
        ("Datin Sarah · upgrade",   "Won",       "RM 6,000",  "100%","RM 6,000",  "Alice"),
        ("Ahmad Rahman · annual",   "Contacted", "RM 4,800",  "40%", "RM 1,920",  "Brian"),
    ]
    for i, row in enumerate(rows):
        ry = 176 + i * 56
        cur = sb_w + 40
        for j, (v, w) in enumerate(zip(row, [c[1] for c in cols])):
            if j == 3:
                # P(close) bar
                pct = int(v.replace("%", ""))
                d.rounded_rectangle([cur, ry + 4, cur + 80, ry + 18],
                                    radius=3, fill=GRAY_100)
                color = GREEN if pct >= 70 else (ORANGE if pct >= 40 else GRAY_500)
                d.rounded_rectangle([cur, ry + 4, cur + int(80 * pct / 100), ry + 18],
                                    radius=3, fill=color)
                d.text((cur, ry - 12), v, fill=color, font=F_TINY_B)
            else:
                d.text((cur, ry), v, fill=GRAY_900, font=F_BODY)
            cur += w
    # totals row
    ry = 176 + 6 * 56 + 10
    d.line([sb_w + 40, ry, W - 40, ry], fill=GRAY_300, width=1)
    d.text((sb_w + 40, ry + 12), "Forecast total (Expected)",
           fill=GRAY_700, font=F_BODY_B)
    d.text((sb_w + 750, ry + 12), "RM 31,920", fill=PRIMARY, font=F_H2)
    header(d, 2, "Drill in — by deal",
           "Expected = Value × P(close). The forecast is the sum.")
    footer(d, "Updating any deal in Pipeline auto-recalculates the forecast.")
    frames.append(img)

    return frames


# ══════════════════════════════════════════════════════════════════════════
# GIF 16 — Churn Risk
# ══════════════════════════════════════════════════════════════════════════
def gif_churn_risk():
    frames = []

    img, d, sb_w = crm_shell(
        active_label="",
        page_title="Churn Risk Analysis",
        page_subtitle="Active customers most likely to leave in the next 60 days.",
    )
    # Summary cards
    for i, (label, val, c, bg) in enumerate(
            [("Critical",  "3",  RED_HI,    RED_BG),
             ("Elevated",  "8",  ORANGE_HI, ORANGE_BG),
             ("Watch",     "14", YELLOW_HI, YELLOW_BG),
             ("Healthy",   "187", GREEN_HI, GREEN_BG)]):
        x = sb_w + 24 + i * 232
        d.rounded_rectangle([x, 110, x + 220, 200], radius=10, fill=bg)
        d.text((x + 16, 122), label, fill=c, font=F_BODY_B)
        d.text((x + 16, 142), val, fill=c, font=F_BIG_NUM)
        d.text((x + 16, 184), "customers", fill=c, font=F_SMALL)
    # At-risk table
    panel(d, sb_w + 24, 220, W - sb_w - 48, H - 270, title="Top at-risk")
    cols = [("Customer", 220), ("Risk", 100), ("Reasons", 460),
            ("Action", 200)]
    cur = sb_w + 40
    for label, w in cols:
        d.text((cur, 264), label, fill=GRAY_500, font=F_SMALL_B)
        cur += w
    d.rectangle([sb_w + 40, 286, W - 40, 287], fill=GRAY_200)
    rows = [
        ("Datin Wendy",    "92", "No contact 90d · ignored 3 emails · downgraded last quarter", RED_HI),
        ("Tan Pei Ling",   "85", "Cancelled 2 bookings · sentiment drop on last NPS",            RED_HI),
        ("Ahmad Hisham",   "78", "Late payment · referred 0 customers (used to refer 3/mo)",     ORANGE_HI),
        ("Lim Pek Yong",   "71", "Reduced session frequency 60% over 90d",                       ORANGE_HI),
        ("Chong Mei Yee",  "64", "Opens emails but no clicks — quiet engagement",                YELLOW_HI),
    ]
    for i, (name, risk, why, c) in enumerate(rows):
        ry = 308 + i * 56
        d.text((sb_w + 40, ry), name, fill=GRAY_900, font=F_BODY_B)
        d.rounded_rectangle([sb_w + 260, ry - 4, sb_w + 320, ry + 28],
                            radius=14, fill=c)
        d.text((sb_w + 274, ry), risk, fill=WHITE, font=F_BODY_B)
        d.text((sb_w + 360, ry), why, fill=GRAY_700, font=F_SMALL)
        # Action button
        button(d, sb_w + 820, ry - 4, 160, 30, "Save action plan",
               bg=GRAY_100, fg=GRAY_700)
    highlight_ring(d, sb_w + 820, 304, 160, 30)
    header(d, 1, "Who's about to leave",
           "Risk score 0–100. Anything ≥ 70 is critical — call this week.")
    footer(d, "Save action plan creates a Case + assigns you as owner.")
    frames.append(img)

    # Frame 2 — action plan dialog
    img, d, sb_w = crm_shell(
        active_label="",
        page_title="Churn Risk · Datin Wendy",
        page_subtitle="Pick a save-action — the system templates the follow-up for you.",
    )
    img = darken(img, alpha=130)
    d = ImageDraw.Draw(img)
    mx, my, mw, mh = 240, 100, 720, 520
    d.rounded_rectangle([mx, my, mx + mw, my + mh], radius=12, fill=WHITE)
    d.text((mx + 24, my + 20),
           "Save plan — Datin Wendy (risk 92)",
           fill=GRAY_900, font=F_TITLE)
    d.text((mx + 24, my + 56),
           "Pick one or more — each turns into a scheduled Case.",
           fill=GRAY_500, font=F_SMALL)
    actions = [
        ("📞", "Personal call within 48h",
         "Apologise for the silence + ask what's missing.", PRIMARY, True),
        ("🎁", "Loyalty gift (≤ RM 200)",
         "Auto-creates a voucher tied to her account.", PURPLE, True),
        ("⭐", "VIP upgrade — 3 months free",
         "Marketing Manager approval required.", ORANGE, False),
        ("📧", "Re-engagement email sequence",
         "5 emails over 14 days, ends with 20% off code.", BLUE, False),
        ("📅", "Free 1-on-1 session",
         "Books an hour with the founder.", GREEN, False),
    ]
    for i, (icon, name, sub, c, checked) in enumerate(actions):
        ry = my + 100 + i * 76
        d.rounded_rectangle([mx + 24, ry, mx + mw - 24, ry + 64],
                            radius=8, fill=GRAY_50, outline=GRAY_200)
        # Checkbox
        if checked:
            d.rounded_rectangle([mx + 36, ry + 20, mx + 60, ry + 44],
                                radius=4, fill=c)
            d.text((mx + 42, ry + 23), "✓", fill=WHITE, font=F_BODY_B)
        else:
            d.rounded_rectangle([mx + 36, ry + 20, mx + 60, ry + 44],
                                radius=4, fill=WHITE, outline=GRAY_300)
        draw_emoji(d, mx + 76, ry + 18, icon, 24)
        d.text((mx + 116, ry + 12), name, fill=GRAY_900, font=F_BODY_B)
        d.text((mx + 116, ry + 36), sub, fill=GRAY_500, font=F_SMALL)
    button(d, mx + mw - 320, my + mh - 56, 110, 38, "Cancel",
           bg=GRAY_100, fg=GRAY_700)
    bx, by, bw, bh = mx + mw - 200, my + mh - 56, 180, 38
    button(d, bx, by, bw, bh, "Save 2 actions")
    highlight_ring(d, bx, by, bw, bh)
    header(d, 2, "Pick save-actions",
           "Two ticked — Save creates 2 Cases assigned to you.")
    footer(d, "VIP upgrade and similar high-cost actions need Marketing Manager approval first.")
    frames.append(img)

    return frames


# ══════════════════════════════════════════════════════════════════════════
# GIF 17 — Performance Insights (team AI tips)
# ══════════════════════════════════════════════════════════════════════════
def gif_performance_insights():
    frames = []

    img, d, sb_w = crm_shell(
        active_label="",
        page_title="Performance Insights",
        page_subtitle="Team-level AI tips — what changed, who needs help, what to copy.",
    )
    # Tip cards
    tips = [
        ("🏆", "Alice's win rate +14% this month",
         "Pattern: she calls within 2 hours of lead arrival.",
         "Encourage Brian + Yi to copy the timing.", GREEN),
        ("⚠", "Brian's response time slipped to 18h",
         "Was 4h in March. 3 leads went cold waiting.",
         "1-on-1 + share Alice's call-template.", ORANGE),
        ("📅", "Mondays close 38% more deals",
         "Likely because customers planned their week.",
         "Block Mon mornings for the team's hottest leads.", PRIMARY),
        ("📞", "WhatsApp beats SMS for re-engagement",
         "62% vs 24% reply rate on cold leads.",
         "Move re-engagement automation off SMS.", PURPLE),
    ]
    for i, (icon, title, body, action, c) in enumerate(tips):
        x = sb_w + 24 + (i % 2) * 480
        y = 110 + (i // 2) * 240
        d.rounded_rectangle([x, y, x + 462, y + 220],
                            radius=10, fill=WHITE, outline=GRAY_200)
        d.rectangle([x, y, x + 6, y + 220], fill=c)
        draw_emoji(d, x + 24, y + 16, icon, 30)
        d.text((x + 24, y + 60), title, fill=GRAY_900, font=F_BODY_B)
        d.text((x + 24, y + 96), body, fill=GRAY_700, font=F_BODY)
        d.text((x + 24, y + 142), "→ " + action, fill=c, font=F_BODY_B)
        button(d, x + 24, y + 172, 130, 32, "Apply tip",
               bg=PURPLE_BG, fg=PURPLE)
        button(d, x + 162, y + 172, 100, 32, "Dismiss",
               bg=GRAY_100, fg=GRAY_700)
    header(d, 1, "What the data noticed about your team",
           "Each card has a finding, a why, and a recommended action.")
    footer(d, "Dismissing a tip teaches the model — it won't surface that pattern again.")
    frames.append(img)

    # Frame 2 — applying a tip
    img, d, sb_w = crm_shell(
        active_label="",
        page_title="Apply tip · Alice's win rate pattern",
        page_subtitle="Generate templates + 1-on-1 talking points for the rest of the team.",
    )
    panel(d, sb_w + 24, 110, W - sb_w - 48, H - 170, title=None)
    d.text((sb_w + 40, 130),
           "The model will:",
           fill=GRAY_700, font=F_BODY_B)
    actions = [
        ("📄", "Extract Alice's call-template from her last 20 calls"),
        ("📨", "Email it to Brian + Yi with annotated highlights"),
        ("📅", "Schedule a 30-min 1-on-1 for Brian on Friday"),
        ("📈", "Add a KPI tile to Brian's dashboard: 'avg first-touch ≤ 2h'"),
        ("🔁", "Re-check the pattern in 30 days — auto-report"),
    ]
    for i, (icon, txt) in enumerate(actions):
        y = 168 + i * 50
        draw_emoji(d, sb_w + 56, y, icon, 24)
        d.text((sb_w + 100, y + 4), txt, fill=GRAY_900, font=F_BODY)
    # confirmation card
    d.rounded_rectangle([sb_w + 40, H - 220, W - 70, H - 130],
                        radius=10, fill=PRIMARY_BG)
    d.text((sb_w + 56, H - 206),
           "Reversible. You can undo any action from Audit Logs within 24h.",
           fill=PRIMARY, font=F_BODY_B)
    d.text((sb_w + 56, H - 182),
           "Brian gets one notification — phrased gently, not as a callout.",
           fill=GRAY_700, font=F_SMALL)
    button(d, W - 350, H - 100, 120, 36, "Edit steps",
           bg=GRAY_100, fg=GRAY_700)
    bx, by, bw, bh = W - 220, H - 100, 160, 36
    button(d, bx, by, bw, bh, "Apply all")
    highlight_ring(d, bx, by, bw, bh)
    header(d, 2, "Preview before applying",
           "The model lists every action it'll take — you can edit or cancel.")
    footer(d, "Manager / Marketing Manager only. The team never sees the raw insights.")
    frames.append(img)

    return frames


# ══════════════════════════════════════════════════════════════════════════
# GIF 18 — Lead Capture Forms
# ══════════════════════════════════════════════════════════════════════════
def gif_lead_forms():
    frames = []

    img, d, sb_w = crm_shell(
        active_label="",
        page_title="Lead Capture Forms",
        page_subtitle="Public forms embedded on your website or shared as a link.",
    )
    bx = sb_w + 24
    input_box(d, bx, 110, 240, 36, "Search forms…")
    button(d, bx + 252, 110, 110, 36, "Status v", bg=WHITE, fg=GRAY_700)
    add_x = W - 200
    button(d, add_x, 110, 160, 36, "+ New Form")
    highlight_ring(d, add_x, 110, 160, 36)
    arrow(d, add_x - 50, 80, add_x - 6, 124)
    panel(d, bx, 168, W - bx - 24, H - 220, title=None)
    cols = [("Form", 280), ("Embed", 160), ("Submissions", 130),
            ("Last", 140), ("Status", 100)]
    cur = bx + 16
    for label, w in cols:
        d.text((cur, 188), label, fill=GRAY_500, font=F_SMALL_B)
        cur += w
    d.rectangle([bx + 16, 210, W - 40, 211], fill=GRAY_200)
    rows = [
        ("Free BaZi consultation",  "/free-bazi",  "284", "1h ago", "Active"),
        ("May newsletter sign-up",   "/newsletter", "157", "3h ago", "Active"),
        ("Refer a friend",            "/refer",      "42",  "1d ago", "Active"),
        ("Cancelled — Apr promo",     "/apr-promo",  "63",  "30d ago","Off"),
    ]
    for i, (name, slug, subs, last, status) in enumerate(rows):
        ry = 234 + i * 56
        d.text((bx + 16, ry), name, fill=GRAY_900, font=F_BODY_B)
        d.text((bx + 296, ry + 2), slug, fill=PRIMARY, font=F_MONO)
        d.text((bx + 456, ry), subs, fill=GRAY_900, font=F_BODY_B)
        d.text((bx + 586, ry), last, fill=GRAY_500, font=F_SMALL)
        bg = GREEN_BG if status == "Active" else GRAY_100
        fg = GREEN_HI if status == "Active" else GRAY_700
        status_pill(d, bx + 716, ry - 2, status, bg, fg)
        # quick action
        button(d, bx + 820, ry - 4, 130, 30, "Copy embed",
               bg=GRAY_100, fg=GRAY_700)
    header(d, 1, "Lead Capture Forms",
           "Each row is a public form. Submissions appear in Prospects.")
    footer(d, "Embed = copy the iframe snippet for your website / link-in-bio.")
    frames.append(img)

    # Frame 2 — form builder
    img, d, sb_w = crm_shell(
        active_label="",
        page_title="Form builder",
        page_subtitle="Drag fields from the left into the form. Auto-saves.",
    )
    # Left: field palette
    panel(d, sb_w + 24, 110, 260, H - 170, title="Fields")
    fields_pal = [("📝", "Short text"),
                  ("🔢", "Number"),
                  ("📞", "Phone"),
                  ("📧", "Email"),
                  ("📅", "Date"),
                  ("🔘", "Single choice"),
                  ("☑", "Multi choice"),
                  ("📋", "Long text"),
                  ("📁", "File upload"),
                  ("✔", "Consent")]
    for i, (icon, name) in enumerate(fields_pal):
        y = 160 + i * 38
        d.rounded_rectangle([sb_w + 40, y, sb_w + 264, y + 32],
                            radius=6, fill=WHITE, outline=GRAY_200)
        draw_emoji(d, sb_w + 50, y + 4, icon, 20)
        d.text((sb_w + 84, y + 6), name, fill=GRAY_900, font=F_BODY)
    # Right: form preview
    rx = sb_w + 304
    panel(d, rx, 110, W - rx - 24, H - 170, title="Free BaZi consultation")
    # form fields stacked
    fy = 160
    d.text((rx + 24, fy), "Name *", fill=GRAY_700, font=F_SMALL_B)
    input_box(d, rx + 24, fy + 22, W - rx - 72, 38, "Your full name")
    fy += 80
    d.text((rx + 24, fy), "Phone *", fill=GRAY_700, font=F_SMALL_B)
    input_box(d, rx + 24, fy + 22, W - rx - 72, 38, "012-xxx xxxx")
    fy += 80
    d.text((rx + 24, fy), "Date of birth *", fill=GRAY_700, font=F_SMALL_B)
    input_box(d, rx + 24, fy + 22, 300, 38, "dd / mm / yyyy")
    fy += 80
    d.text((rx + 24, fy), "How did you hear about us?", fill=GRAY_700, font=F_SMALL_B)
    input_box(d, rx + 24, fy + 22, W - rx - 72, 38,
              "Friend · IG · Google · Other")
    # Highlight new field being dragged in
    fy += 80
    d.rounded_rectangle([rx + 24, fy, W - 48, fy + 60],
                        radius=6, outline=PRIMARY, width=2)
    d.text((rx + 36, fy + 18), "(Drop the next field here)",
           fill=PRIMARY, font=F_BODY_B)
    highlight_ring(d, rx + 24, fy, W - rx - 72, 60, color=PRIMARY)
    arrow(d, sb_w + 260, fy + 30, rx + 16, fy + 30, color=PRIMARY)
    header(d, 2, "Drag a field onto the form",
           "Required fields get a red asterisk automatically.")
    footer(d, "Auto-saves on every change. Publish when ready.")
    frames.append(img)

    # Frame 3 — embed dialog
    img, d, sb_w = crm_shell(
        active_label="",
        page_title="Lead Capture Forms",
        page_subtitle="Publish + embed.",
    )
    img = darken(img, alpha=130)
    d = ImageDraw.Draw(img)
    mx, my, mw, mh = 280, 130, 640, 460
    d.rounded_rectangle([mx, my, mx + mw, my + mh], radius=12, fill=WHITE)
    d.text((mx + 24, my + 20),
           "Embed · Free BaZi consultation",
           fill=GRAY_900, font=F_TITLE)
    d.text((mx + 24, my + 56),
           "Three ways to share the form.",
           fill=GRAY_500, font=F_SMALL)
    # 1) Iframe snippet
    d.text((mx + 24, my + 100), "1.  Embed in your website",
           fill=GRAY_700, font=F_SMALL_B)
    d.rounded_rectangle([mx + 24, my + 122, mx + mw - 24, my + 174],
                        radius=6, fill=GRAY_900)
    d.text((mx + 40, my + 134),
           '<iframe src="destinoraclessolution.com/forms/free-bazi"',
           fill=GREEN_BG, font=F_MONO)
    d.text((mx + 40, my + 152),
           '         width="100%" height="600"></iframe>',
           fill=GREEN_BG, font=F_MONO)
    button(d, mx + mw - 130, my + 134, 100, 30, "Copy",
           bg=PRIMARY, fg=WHITE)
    # 2) Public link
    d.text((mx + 24, my + 196), "2.  Public link (paste anywhere)",
           fill=GRAY_700, font=F_SMALL_B)
    d.rounded_rectangle([mx + 24, my + 218, mx + mw - 24, my + 256],
                        radius=6, fill=GRAY_100)
    d.text((mx + 40, my + 226),
           "https://destinoraclessolution.com/forms/free-bazi",
           fill=PRIMARY, font=F_MONO)
    button(d, mx + mw - 130, my + 220, 100, 30, "Copy",
           bg=GRAY_100, fg=GRAY_700)
    # 3) QR code
    d.text((mx + 24, my + 278), "3.  QR code (print for events)",
           fill=GRAY_700, font=F_SMALL_B)
    # fake QR
    qx, qy, qs = mx + 40, my + 300, 100
    d.rectangle([qx, qy, qx + qs, qy + qs], fill=WHITE, outline=GRAY_300)
    import random as _r
    _r.seed(7)
    for ri in range(10):
        for ci in range(10):
            if _r.random() > 0.5:
                d.rectangle([qx + ci * 10, qy + ri * 10,
                             qx + ci * 10 + 10, qy + ri * 10 + 10],
                            fill=GRAY_900)
    d.text((qx + 120, qy + 36),
           "Download as PNG / SVG.", fill=GRAY_700, font=F_BODY)
    button(d, qx + 120, qy + 60, 130, 32, "Download QR",
           bg=GRAY_100, fg=GRAY_700)
    highlight_ring(d, mx + mw - 130, my + 134, 100, 30, color=PRIMARY)
    header(d, 3, "Publish & embed",
           "Pick whichever fits the channel — IG bio link, website, event flyer.")
    footer(d, "Every submission flows straight into Prospects with Source = form name.")
    frames.append(img)

    return frames


# ══════════════════════════════════════════════════════════════════════════
# GIF 19 — NPS Surveys
# ══════════════════════════════════════════════════════════════════════════
def gif_nps_surveys():
    frames = []

    img, d, sb_w = crm_shell(
        active_label="",
        page_title="NPS Surveys",
        page_subtitle="How likely are your customers to recommend you?",
    )
    # Big NPS score
    panel(d, sb_w + 24, 110, 360, 240, title="NPS score · last 30 days")
    d.text((sb_w + 60, 170), "62", fill=GREEN_HI, font=_font(70, bold=True))
    d.text((sb_w + 200, 200), "↑ +8 vs Apr", fill=GREEN_HI, font=F_BODY_B)
    d.text((sb_w + 200, 224), "Industry avg: 31", fill=GRAY_500, font=F_SMALL)
    # Breakdown bars
    cats = [("Promoters (9-10)", "68%", GREEN_HI),
            ("Passives (7-8)",   "26%", YELLOW_HI),
            ("Detractors (0-6)", "6%",  RED_HI)]
    for i, (label, val, c) in enumerate(cats):
        y = 270 + i * 24
        d.text((sb_w + 60, y), label, fill=GRAY_700, font=F_SMALL_B)
        d.text((sb_w + 280, y), val, fill=c, font=F_SMALL_B)
    # Send survey panel
    rx = sb_w + 400
    panel(d, rx, 110, W - rx - 24, 240, title="Send a new survey")
    d.text((rx + 24, 156), "Audience", fill=GRAY_700, font=F_SMALL_B)
    input_box(d, rx + 24, 178, W - rx - 72, 38, "",
              "Customers who closed a deal in May (8)")
    d.text((rx + 24, 230), "Channel", fill=GRAY_700, font=F_SMALL_B)
    # channel chips
    for i, (label, bg, fg, sel) in enumerate([
            ("WhatsApp", GREEN_BG,   GREEN_HI, True),
            ("Email",    GRAY_100,   GRAY_700, False),
            ("SMS",      GRAY_100,   GRAY_700, False)]):
        cx = rx + 24 + i * 110
        d.rounded_rectangle([cx, 252, cx + 100, 286], radius=17,
                            fill=bg, outline=fg if sel else None,
                            width=2 if sel else 0)
        bbox = d.textbbox((0, 0), label, font=F_BODY_B)
        tw = bbox[2] - bbox[0]
        d.text((cx + (100 - tw) // 2, 258), label,
               fill=fg, font=F_BODY_B)
    button(d, W - 200, 300, 160, 36, "Send to 8 people")
    highlight_ring(d, W - 200, 300, 160, 36)
    # Recent responses
    panel(d, sb_w + 24, 370, W - sb_w - 48, H - 420, title="Recent responses")
    rresp = [
        ("Datin Sarah",  "10", "Always feels like Alice listens.",       GREEN_HI),
        ("Wong Kar Mun", "9",  "Quick to reply on WhatsApp.",            GREEN_HI),
        ("Tan Mei Ling", "8",  "Wish reports came in Mandarin.",         YELLOW_HI),
        ("Ahmad Hisham", "5",  "Late by 2 weeks last time.",             RED_HI),
    ]
    for i, (name, score, quote, c) in enumerate(rresp):
        ry = 420 + i * 50
        d.text((sb_w + 40, ry), name, fill=GRAY_900, font=F_BODY_B)
        d.rounded_rectangle([sb_w + 200, ry - 4, sb_w + 248, ry + 28],
                            radius=14, fill=c)
        d.text((sb_w + 214, ry), score, fill=WHITE, font=F_BODY_B)
        d.text((sb_w + 280, ry), '"' + quote + '"',
               fill=GRAY_700, font=F_SMALL)
    header(d, 1, "Read the room",
           "Big score top-left. Send a fresh survey top-right. Quotes below.")
    footer(d, "Detractors (red) auto-open a Case so you don't miss a follow-up.")
    frames.append(img)

    # Frame 2 — survey template editor
    img, d, sb_w = crm_shell(
        active_label="",
        page_title="NPS Surveys · Edit template",
        page_subtitle="What customers see when they tap the message.",
    )
    panel(d, sb_w + 24, 110, 460, H - 170, title="WhatsApp template")
    # Phone mockup
    px = sb_w + 60
    py = 160
    d.rounded_rectangle([px, py, px + 380, py + 400],
                        radius=20, fill=GRAY_900)
    d.rounded_rectangle([px + 12, py + 50, px + 368, py + 388],
                        radius=4, fill=(229, 221, 213))  # WhatsApp bg
    # Header
    d.rectangle([px + 12, py + 50, px + 368, py + 86], fill=(37, 211, 102))
    d.text((px + 30, py + 60), "Destin Oracles",
           fill=WHITE, font=F_BODY_B)
    # Bubble
    d.rounded_rectangle([px + 26, py + 100, px + 320, py + 230],
                        radius=8, fill=WHITE)
    d.text((px + 38, py + 112),
           "Hi Datin Sarah!", fill=GRAY_900, font=F_BODY_B)
    d.text((px + 38, py + 134),
           "Quick question — on a scale of 0–10,",
           fill=GRAY_900, font=F_SMALL)
    d.text((px + 38, py + 154),
           "how likely are you to recommend us to",
           fill=GRAY_900, font=F_SMALL)
    d.text((px + 38, py + 174),
           "a friend?",
           fill=GRAY_900, font=F_SMALL)
    d.text((px + 38, py + 200),
           "Tap a number ↓",
           fill=GREEN_HI, font=F_SMALL_B)
    # number buttons
    for i in range(11):
        nx = px + 26 + (i % 6) * 50
        ny = py + 250 + (i // 6) * 50
        d.rounded_rectangle([nx, ny, nx + 40, ny + 40],
                            radius=20, fill=WHITE)
        bbox = d.textbbox((0, 0), str(i), font=F_BODY_B)
        tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
        d.text((nx + (40 - tw) // 2, ny + (40 - th) // 2 - 2),
               str(i), fill=GRAY_900, font=F_BODY_B)
    # Right: template settings
    rx = sb_w + 500
    panel(d, rx, 110, W - rx - 24, H - 170, title="Template settings")
    def lbl(text, y):
        d.text((rx + 24, y), text, fill=GRAY_700, font=F_SMALL_B)
    lbl("Greeting", 160)
    input_box(d, rx + 24, 182, W - rx - 72, 38, "",
              "Hi {{customer.first_name}}!")
    lbl("Question", 240)
    input_box(d, rx + 24, 262, W - rx - 72, 38, "",
              "How likely to recommend us to a friend?")
    lbl("Auto follow-up on score 0–6", 320)
    d.rounded_rectangle([rx + 24, 342, W - 48, 412],
                        radius=8, fill=PRIMARY_BG)
    d.text((rx + 40, 354),
           "Open Case 'NPS detractor' · assign to Marketing Manager",
           fill=PRIMARY, font=F_BODY_B)
    d.text((rx + 40, 380),
           "Customer gets an apology message within 2 hours.",
           fill=GRAY_700, font=F_SMALL)
    button(d, W - 220, H - 110, 160, 36, "Save template")
    highlight_ring(d, W - 220, H - 110, 160, 36)
    header(d, 2, "What the customer sees",
           "Left = WhatsApp preview. Right = the text + auto-follow-up rule.")
    footer(d, "Variables in {{double braces}} fill from each customer's record.")
    frames.append(img)

    return frames


# ══════════════════════════════════════════════════════════════════════════
# GIF 20 — Contracts
# ══════════════════════════════════════════════════════════════════════════
def gif_contracts():
    frames = []

    img, d, sb_w = crm_shell(
        active_label="",
        page_title="Contracts",
        page_subtitle="Service agreements — drafts, signing, signed copies.",
    )
    bx = sb_w + 24
    input_box(d, bx, 110, 240, 36, "Search customer / ref…")
    button(d, bx + 252, 110, 110, 36, "Status v", bg=WHITE, fg=GRAY_700)
    add_x = W - 220
    button(d, add_x, 110, 180, 36, "+ New Contract")
    highlight_ring(d, add_x, 110, 180, 36)
    arrow(d, add_x - 50, 80, add_x - 6, 124)
    panel(d, bx, 168, W - bx - 24, H - 220, title=None)
    cols = [("Ref", 110), ("Customer", 220), ("Plan", 180),
            ("Value", 130), ("Sent", 140), ("Status", 130)]
    cur = bx + 16
    for label, w in cols:
        d.text((cur, 188), label, fill=GRAY_500, font=F_SMALL_B)
        cur += w
    d.rectangle([bx + 16, 210, W - 40, 211], fill=GRAY_200)
    rows = [
        ("C-1142", "Datin Sarah",   "3-year",  "RM 18,000", "30 May",  "Signed",      GREEN_BG,   GREEN_HI),
        ("C-1143", "Wong Kar Mun",  "3-year",  "RM 12,000", "30 May",  "Awaiting",    YELLOW_BG,  YELLOW_HI),
        ("C-1144", "Tan Mei Ling",  "Annual",  "RM 4,800",  "29 May",  "Draft",       GRAY_100,   GRAY_700),
        ("C-1141", "Ahmad Rahman",  "Annual",  "RM 4,800",  "25 May",  "Declined",    RED_BG,     RED_HI),
        ("C-1140", "Chong Kah Wai", "3-year",  "RM 12,000", "22 May",  "Signed",      GREEN_BG,   GREEN_HI),
    ]
    for i, (ref, name, plan, val, sent, status, sbg, sfg) in enumerate(rows):
        ry = 234 + i * 56
        d.text((bx + 16, ry), ref, fill=PRIMARY, font=F_MONO)
        d.text((bx + 126, ry), name, fill=GRAY_900, font=F_BODY_B)
        d.text((bx + 346, ry), plan, fill=GRAY_700, font=F_BODY)
        d.text((bx + 526, ry), val, fill=GRAY_900, font=F_BODY_B)
        d.text((bx + 656, ry), sent, fill=GRAY_500, font=F_SMALL)
        status_pill(d, bx + 796, ry - 2, status, sbg, sfg)
    header(d, 1, "Contracts list",
           "One row per service agreement. Status badge tells you what's next.")
    footer(d, "Signed copies auto-file into Documents under Contracts folder.")
    frames.append(img)

    # Frame 2 — contract send flow
    img, d, sb_w = crm_shell(
        active_label="",
        page_title="Contracts · C-1143 · Wong Kar Mun",
        page_subtitle="Send the 3-year contract for e-signature.",
    )
    # Left: contract preview
    panel(d, sb_w + 24, 110, 460, H - 170, title=None)
    px, py, pw, ph = sb_w + 40, 130, 428, H - 210
    d.rounded_rectangle([px, py, px + pw, py + ph], radius=6, fill=WHITE,
                        outline=GRAY_300)
    d.text((px + 28, py + 30), "SERVICE AGREEMENT",
           fill=GRAY_900, font=F_H2)
    d.text((px + 28, py + 56), "C-1143 · 30 May 2026",
           fill=GRAY_500, font=F_SMALL)
    d.rectangle([px + 28, py + 90, px + pw - 28, py + 91], fill=GRAY_300)
    for i, line in enumerate([
        "BETWEEN  Destin Oracles Solution Sdn Bhd",
        "AND      Wong Kar Mun (NRIC 880912-08-1234)",
        "",
        "PLAN     3-year package",
        "VALUE    RM 12,000",
        "TERM     1 June 2026 – 31 May 2029",
    ]):
        d.text((px + 28, py + 110 + i * 22), line,
               fill=GRAY_900, font=F_MONO if line.startswith(("BETW", "AND", "PLAN", "VALUE", "TERM")) else F_BODY)
    # signature area
    d.text((px + 28, py + ph - 100), "Signature placeholder:",
           fill=GRAY_500, font=F_SMALL_B)
    d.rounded_rectangle([px + 28, py + ph - 70, px + 220, py + ph - 30],
                        radius=4, fill=YELLOW_BG, outline=YELLOW_HI, width=2)
    d.text((px + 56, py + ph - 58),
           "Awaiting signer", fill=YELLOW_HI, font=F_SMALL_B)
    # Right: send panel
    rx = sb_w + 500
    panel(d, rx, 110, W - rx - 24, H - 170, title="Send for e-signature")
    d.text((rx + 24, 156), "Signer", fill=GRAY_700, font=F_SMALL_B)
    input_box(d, rx + 24, 178, W - rx - 72, 38, "", "Wong Kar Mun")
    d.text((rx + 24, 230), "Email", fill=GRAY_700, font=F_SMALL_B)
    input_box(d, rx + 24, 252, W - rx - 72, 38, "",
              "karmun@gmail.com")
    d.text((rx + 24, 304), "Phone (WhatsApp link)", fill=GRAY_700, font=F_SMALL_B)
    input_box(d, rx + 24, 326, W - rx - 72, 38, "",
              "011-456 7890")
    d.text((rx + 24, 378), "Send via", fill=GRAY_700, font=F_SMALL_B)
    for i, (label, bg, fg, sel) in enumerate([
            ("Email",    PRIMARY_BG, PRIMARY,  True),
            ("WhatsApp", GREEN_BG,   GREEN_HI, True),
            ("SMS link", GRAY_100,   GRAY_700, False)]):
        cx = rx + 24 + i * 130
        d.rounded_rectangle([cx, 400, cx + 120, 434], radius=17, fill=bg,
                            outline=fg if sel else None,
                            width=2 if sel else 0)
        bbox = d.textbbox((0, 0), label, font=F_BODY_B)
        tw = bbox[2] - bbox[0]
        d.text((cx + (120 - tw) // 2, 406), label,
               fill=fg, font=F_BODY_B)
    d.text((rx + 24, 460), "Reminder schedule", fill=GRAY_700, font=F_SMALL_B)
    d.text((rx + 24, 482), "Day 1 · Day 3 · Day 7 (auto)",
           fill=GRAY_900, font=F_BODY)
    button(d, W - 230, H - 110, 170, 38, "Send contract")
    highlight_ring(d, W - 230, H - 110, 170, 38)
    header(d, 2, "Send for signature",
           "E-sign by email + WhatsApp link. Auto-reminders kick in if no reply.")
    footer(d, "Once signed, the file is countersigned by us automatically and filed.")
    frames.append(img)

    return frames


# ══════════════════════════════════════════════════════════════════════════
# GIF 21 — Booking Scheduler
# ══════════════════════════════════════════════════════════════════════════
def gif_booking_scheduler():
    frames = []

    img, d, sb_w = crm_shell(
        active_label="",
        page_title="Booking Scheduler",
        page_subtitle="Public booking pages — customers pick a slot themselves.",
    )
    bx = sb_w + 24
    # Toolbar
    button(d, bx, 110, 130, 36, "Pages", bg=PRIMARY)
    button(d, bx + 138, 110, 130, 36, "Availability", bg=WHITE, fg=GRAY_700)
    button(d, bx + 276, 110, 130, 36, "Bookings", bg=WHITE, fg=GRAY_700)
    add_x = W - 220
    button(d, add_x, 110, 180, 36, "+ New Page")
    highlight_ring(d, add_x, 110, 180, 36)
    arrow(d, add_x - 50, 80, add_x - 6, 124)
    # Page cards
    pages = [
        ("Free BaZi 15-min",  "/free-bazi",        "15 min", "23 booked", PRIMARY),
        ("Full reading 60",   "/reading-60",       "60 min", "8 booked",  PURPLE),
        ("Couple session 90", "/couple",           "90 min", "4 booked",  ORANGE),
        ("Recharge — VIP",    "/vip-recharge",     "60 min", "Hidden",    GREEN),
    ]
    for i, (name, slug, length, booked, c) in enumerate(pages):
        x = bx + (i % 2) * 480
        y = 168 + (i // 2) * 220
        d.rounded_rectangle([x, y, x + 460, y + 200],
                            radius=10, fill=WHITE, outline=GRAY_200)
        d.rectangle([x, y, x + 6, y + 200], fill=c)
        d.text((x + 24, y + 18), name, fill=GRAY_900, font=F_H2)
        d.text((x + 24, y + 50), slug, fill=PRIMARY, font=F_MONO)
        d.text((x + 24, y + 76), length, fill=GRAY_700, font=F_BODY_B)
        d.text((x + 24, y + 102), "This month", fill=GRAY_500, font=F_SMALL_B)
        d.text((x + 24, y + 122), booked, fill=GRAY_900, font=F_BIG_NUM)
        button(d, x + 24, y + 162, 100, 30, "Edit",
               bg=GRAY_100, fg=GRAY_700)
        button(d, x + 132, y + 162, 130, 30, "Copy link",
               bg=PRIMARY_BG, fg=PRIMARY)
        button(d, x + 270, y + 162, 130, 30, "Open page →",
               bg=WHITE, fg=GRAY_700)
    header(d, 1, "Booking pages",
           "Each page is a slot type customers can book online.")
    footer(d, "Copy link → share in WhatsApp / IG bio so they book themselves.")
    frames.append(img)

    # Frame 2 — public booking view
    img, d = new_frame(bg=GRAY_50)
    # Browser chrome
    d.rectangle([0, 0, W, 50], fill=GRAY_900)
    d.ellipse([16, 18, 30, 32], fill=(255, 95, 86))
    d.ellipse([36, 18, 50, 32], fill=(255, 189, 46))
    d.ellipse([56, 18, 70, 32], fill=(39, 201, 63))
    d.rounded_rectangle([90, 14, W - 90, 36], radius=4, fill=WHITE)
    d.text((104, 18), "destinoraclessolution.com/book/free-bazi",
           fill=GRAY_700, font=F_MONO)
    # Page header
    d.text((W // 2 - 200, 80), "Free 15-min BaZi taster",
           fill=GRAY_900, font=F_TITLE)
    d.text((W // 2 - 200, 116),
           "Pick a slot — confirmation sent by WhatsApp.",
           fill=GRAY_500, font=F_BODY)
    # Calendar slots
    panel(d, 200, 160, W - 400, H - 200, title=None)
    days = ["Mon 2", "Tue 3", "Wed 4", "Thu 5", "Fri 6"]
    times = ["10:00", "11:00", "14:00", "15:00", "16:00"]
    col_w = (W - 480) // 5
    # Day headers
    for i, day in enumerate(days):
        d.text((220 + i * col_w + 10, 180), day,
               fill=GRAY_700, font=F_BODY_B)
    d.rectangle([220, 210, W - 240, 211], fill=GRAY_200)
    for r, time_lbl in enumerate(times):
        for c in range(5):
            x = 220 + c * col_w
            y = 220 + r * 60
            taken = (r + c) % 3 == 0
            is_pick = (r == 2 and c == 3)
            if is_pick:
                d.rounded_rectangle([x, y, x + col_w - 10, y + 50],
                                    radius=6, fill=PRIMARY)
                d.text((x + 14, y + 14), time_lbl,
                       fill=WHITE, font=F_BODY_B)
            elif taken:
                d.rounded_rectangle([x, y, x + col_w - 10, y + 50],
                                    radius=6, fill=GRAY_100)
                d.text((x + 14, y + 14), time_lbl,
                       fill=GRAY_400, font=F_BODY)
                d.text((x + 14, y + 30), "taken",
                       fill=GRAY_400, font=F_TINY_B)
            else:
                d.rounded_rectangle([x, y, x + col_w - 10, y + 50],
                                    radius=6, fill=WHITE, outline=GRAY_300)
                d.text((x + 14, y + 14), time_lbl,
                       fill=GRAY_700, font=F_BODY_B)
    # CTA bottom
    bx, by, bw, bh = W // 2 - 110, H - 70, 220, 44
    button(d, bx, by, bw, bh, "Confirm Wed 14:00")
    highlight_ring(d, bx, by, bw, bh)
    header(d, 2, "Customer view",
           "This is what the customer sees on your public booking page.")
    footer(d, "Picked slot becomes a Calendar entry on your side + a confirmation message.")
    frames.append(img)

    return frames


# ══════════════════════════════════════════════════════════════════════════
# GIF 22 — Custom Fields
# ══════════════════════════════════════════════════════════════════════════
def gif_custom_fields():
    frames = []

    img, d, sb_w = crm_shell(
        active_label="",
        page_title="Custom Fields",
        page_subtitle="Add your own data fields to Prospects / Customers / Deals.",
    )
    bx = sb_w + 24
    # Entity tabs
    button(d, bx, 110, 150, 36, "Customers", bg=PRIMARY)
    button(d, bx + 158, 110, 150, 36, "Prospects", bg=WHITE, fg=GRAY_700)
    button(d, bx + 316, 110, 150, 36, "Deals", bg=WHITE, fg=GRAY_700)
    add_x = W - 200
    button(d, add_x, 110, 160, 36, "+ New Field")
    highlight_ring(d, add_x, 110, 160, 36)
    arrow(d, add_x - 50, 80, add_x - 6, 124)
    panel(d, bx, 168, W - bx - 24, H - 220, title=None)
    cols = [("Field name", 260), ("Key", 200), ("Type", 130),
            ("Required", 100), ("Used in", 200)]
    cur = bx + 16
    for label, w in cols:
        d.text((cur, 188), label, fill=GRAY_500, font=F_SMALL_B)
        cur += w
    d.rectangle([bx + 16, 210, W - 40, 211], fill=GRAY_200)
    rows = [
        ("Lucky direction",      "lucky_dir",      "Single",   "No",  "Reports, AI",   PRIMARY),
        ("Preferred language",   "pref_lang",      "Single",   "Yes", "Forms, SMS",    PURPLE),
        ("Marketing consent",    "mkt_consent",    "Checkbox", "Yes", "Automation",    GREEN),
        ("Anniversary",          "anniv_date",     "Date",     "No",  "Promotions",    ORANGE),
        ("Top objection",        "top_objection",  "Long text","No",  "Notes",         BLUE),
    ]
    type_colors = {"Single": PRIMARY, "Checkbox": GREEN, "Date": ORANGE,
                   "Long text": BLUE, "Multi": PURPLE}
    for i, (name, key, ftype, req, used, c) in enumerate(rows):
        ry = 234 + i * 56
        d.text((bx + 16, ry), name, fill=GRAY_900, font=F_BODY_B)
        d.text((bx + 276, ry + 2), key, fill=PRIMARY, font=F_MONO)
        # Type badge
        tc = type_colors.get(ftype, GRAY_700)
        status_pill(d, bx + 476, ry - 2, ftype, GRAY_100, tc)
        d.text((bx + 606, ry), req,
               fill=GREEN_HI if req == "Yes" else GRAY_500,
               font=F_BODY_B if req == "Yes" else F_BODY)
        d.text((bx + 706, ry), used, fill=GRAY_700, font=F_SMALL)
    header(d, 1, "Customise your data model",
           "Three tabs (Customers / Prospects / Deals) — one per record type.")
    footer(d, "Adding a field instantly makes it appear on the relevant edit modals.")
    frames.append(img)

    # Frame 2 — add field modal
    img, d, sb_w = crm_shell(
        active_label="",
        page_title="Custom Fields",
        page_subtitle="Configure a new field — 5 fields in the form, all required.",
    )
    img = darken(img, alpha=130)
    d = ImageDraw.Draw(img)
    mx, my, mw, mh = 280, 90, 640, 540
    d.rounded_rectangle([mx, my, mx + mw, my + mh], radius=12, fill=WHITE)
    d.text((mx + 24, my + 20), "New custom field", fill=GRAY_900, font=F_TITLE)
    d.text((mx + 24, my + 56),
           "On the Customers tab. Will appear in every Customer edit form.",
           fill=GRAY_500, font=F_SMALL)
    def lbl(text, x, y):
        d.text((x, y), text, fill=GRAY_700, font=F_SMALL_B)
    lbl("● Display name", mx + 24, my + 100)
    input_box(d, mx + 24, my + 122, mw - 48, 38, "", "Tea-time preference")
    lbl("● Key (auto)", mx + 24, my + 180)
    input_box(d, mx + 24, my + 202, mw - 48, 38, "", "tea_time_pref", mono=True)
    lbl("● Type", mx + 24, my + 260)
    # type cards
    types_ = [
        ("Short text",  PRIMARY_BG, PRIMARY,  False),
        ("Number",      GRAY_100,   GRAY_700, False),
        ("Date",        GRAY_100,   GRAY_700, False),
        ("Single",      GRAY_100,   GRAY_700, True),
        ("Multi",       GRAY_100,   GRAY_700, False),
        ("Checkbox",    GRAY_100,   GRAY_700, False),
    ]
    cw = (mw - 48 - 5 * 10) // 6
    for i, (n, bg, fg, sel) in enumerate(types_):
        cx = mx + 24 + i * (cw + 10)
        d.rounded_rectangle([cx, my + 282, cx + cw, my + 322],
                            radius=8, fill=PRIMARY_BG if sel else bg,
                            outline=PRIMARY if sel else None,
                            width=2 if sel else 0)
        bbox = d.textbbox((0, 0), n, font=F_SMALL_B)
        tw = bbox[2] - bbox[0]
        d.text((cx + (cw - tw) // 2, my + 295), n,
               fill=PRIMARY if sel else fg, font=F_SMALL_B)
    lbl("● Options (one per line)", mx + 24, my + 340)
    d.rounded_rectangle([mx + 24, my + 362, mx + mw - 24, my + 432],
                        radius=6, fill=WHITE, outline=GRAY_300)
    d.text((mx + 34, my + 370), "Black coffee",  fill=GRAY_900, font=F_BODY)
    d.text((mx + 34, my + 390), "Pu-erh tea",    fill=GRAY_900, font=F_BODY)
    d.text((mx + 34, my + 410), "Just plain water", fill=GRAY_900, font=F_BODY)
    # required toggle
    lbl("Required", mx + 24, my + 450)
    d.rounded_rectangle([mx + 124, my + 450, mx + 174, my + 478],
                        radius=14, fill=GRAY_300)
    d.ellipse([mx + 124, my + 450, mx + 152, my + 478], fill=WHITE)
    button(d, mx + mw - 240, my + mh - 56, 100, 38, "Cancel",
           bg=GRAY_100, fg=GRAY_700)
    bx, by, bw, bh = mx + mw - 130, my + mh - 56, 110, 38
    button(d, bx, by, bw, bh, "Save")
    highlight_ring(d, bx, by, bw, bh)
    header(d, 2, "Configure the field",
           "Name → key (auto-generated) → type → options → required toggle.")
    footer(d, "Single = one choice. Multi = multiple choices. Both need an Options list.")
    frames.append(img)

    return frames


# ══════════════════════════════════════════════════════════════════════════
# GIF 23 — Integrations
# ══════════════════════════════════════════════════════════════════════════
def gif_integrations():
    frames = []

    img, d, sb_w = crm_shell(
        active_label="",
        page_title="Integrations",
        page_subtitle="Connect the CRM to WhatsApp, payment, email, calendar, AI.",
    )
    # Integration cards
    items = [
        ("WhatsApp Business", "Messaging",  "Connected · 1 number",  GREEN_HI, True),
        ("Stripe",            "Payments",   "Connected · MYR",        GREEN_HI, True),
        ("Mailchimp",         "Email",      "Not connected",          GRAY_500, False),
        ("Google Calendar",   "Calendar",   "Connected · Alice",      GREEN_HI, True),
        ("Vercel AI Gateway", "AI",         "Connected · gpt-4o",     GREEN_HI, True),
        ("Telegram",          "Messaging",  "Not connected",          GRAY_500, False),
        ("Twilio",            "SMS",        "Connected · MY senders", GREEN_HI, True),
        ("Zapier",            "Automation", "Not connected",          GRAY_500, False),
    ]
    for i, (name, cat, status, c, conn) in enumerate(items):
        x = sb_w + 24 + (i % 4) * 240
        y = 110 + (i // 4) * 240
        d.rounded_rectangle([x, y, x + 224, y + 220],
                            radius=10, fill=WHITE, outline=GRAY_200)
        # Logo placeholder circle
        logo_c = PRIMARY if i == 0 else (PURPLE if i == 1 else (BLUE if i == 3 else (ORANGE if i == 4 else GRAY_500)))
        d.ellipse([x + 16, y + 16, x + 64, y + 64], fill=logo_c)
        d.text((x + 32, y + 26), name[:1], fill=WHITE, font=F_H2)
        d.text((x + 16, y + 76), name, fill=GRAY_900, font=F_BODY_B)
        d.text((x + 16, y + 98), cat, fill=GRAY_500, font=F_SMALL)
        # Status
        if conn:
            status_pill(d, x + 16, y + 124, "● Connected",
                        GREEN_BG, GREEN_HI)
        else:
            status_pill(d, x + 16, y + 124, "Not connected",
                        GRAY_100, GRAY_700)
        d.text((x + 16, y + 156), status, fill=GRAY_600, font=F_SMALL)
        if conn:
            button(d, x + 16, y + 178, 90, 30, "Manage",
                   bg=GRAY_100, fg=GRAY_700)
        else:
            button(d, x + 16, y + 178, 90, 30, "Connect",
                   bg=PRIMARY, fg=WHITE)
            highlight_ring(d, x + 16, y + 178, 90, 30)
    header(d, 1, "Wire the CRM to the rest of your stack",
           "Connected services unlock features (e.g. Stripe → in-app payments).")
    footer(d, "Most connections take under 3 minutes. WhatsApp is the most useful first.")
    frames.append(img)

    # Frame 2 — OAuth connect flow
    img, d, sb_w = crm_shell(
        active_label="",
        page_title="Integrations · Connect Mailchimp",
        page_subtitle="Three steps — authorise, pick audience, map fields.",
    )
    # Stepper
    for i, (label, done) in enumerate([
            ("Authorise", True),
            ("Pick audience", True),
            ("Map fields", False),
            ("Test send", False)]):
        x = sb_w + 24 + i * 230
        c = GREEN_HI if done else GRAY_400
        d.ellipse([x, 110, x + 32, 142], fill=c)
        d.text((x + 10, 116), "✓" if done else str(i + 1),
               fill=WHITE, font=F_BODY_B)
        d.text((x + 44, 116), label,
               fill=GRAY_900 if done else GRAY_500, font=F_BODY_B)
        if i < 3:
            d.line([x + 200, 126, x + 230, 126], fill=GRAY_300, width=2)
    # Current step (Map fields)
    panel(d, sb_w + 24, 170, W - sb_w - 48, H - 230,
          title="3.  Map our fields → Mailchimp fields")
    # mapping rows
    pairs = [
        ("first_name",   "FNAME"),
        ("last_name",    "LNAME"),
        ("phone",        "PHONE"),
        ("source",       "SIGNUP_SOURCE"),
        ("lucky_dir",    "(skip — Mailchimp has no equivalent)"),
        ("mkt_consent",  "OPT_IN"),
    ]
    for i, (ours, theirs) in enumerate(pairs):
        ry = 220 + i * 50
        d.rounded_rectangle([sb_w + 40, ry, sb_w + 240, ry + 38],
                            radius=6, fill=WHITE, outline=GRAY_300)
        d.text((sb_w + 50, ry + 10), ours, fill=GRAY_900, font=F_MONO)
        arrow(d, sb_w + 250, ry + 19, sb_w + 320, ry + 19, color=GRAY_500, width=2)
        d.rounded_rectangle([sb_w + 330, ry, sb_w + 660, ry + 38],
                            radius=6, fill=WHITE, outline=GRAY_300)
        d.text((sb_w + 340, ry + 10), theirs,
               fill=GRAY_900 if not theirs.startswith("(") else GRAY_500,
               font=F_MONO)
    button(d, W - 380, H - 110, 130, 38, "Back",
           bg=GRAY_100, fg=GRAY_700)
    bx, by, bw, bh = W - 240, H - 110, 180, 38
    button(d, bx, by, bw, bh, "Next: test send")
    highlight_ring(d, bx, by, bw, bh)
    header(d, 2, "Map your fields to theirs",
           "Skipping is fine — only the fields you actually use need to be mapped.")
    footer(d, "Test send fires a fake row through the pipeline so you can verify it lands.")
    frames.append(img)

    return frames


# ══════════════════════════════════════════════════════════════════════════
# GIF 24 — Marketing Lists
# ══════════════════════════════════════════════════════════════════════════
def gif_marketing_lists():
    frames = []

    img, d, sb_w = crm_shell(
        active_label="",
        page_title="Marketing Lists",
        page_subtitle="Saved customer segments — feed campaigns + automations.",
    )
    bx = sb_w + 24
    input_box(d, bx, 110, 240, 36, "Search lists…")
    button(d, bx + 252, 110, 110, 36, "Tag v", bg=WHITE, fg=GRAY_700)
    add_x = W - 220
    button(d, add_x, 110, 180, 36, "+ New Segment")
    highlight_ring(d, add_x, 110, 180, 36)
    arrow(d, add_x - 50, 80, add_x - 6, 124)
    panel(d, bx, 168, W - bx - 24, H - 220, title=None)
    cols = [("List name", 320), ("Definition", 380),
            ("Size", 100), ("Refreshed", 140)]
    cur = bx + 16
    for label, w in cols:
        d.text((cur, 188), label, fill=GRAY_500, font=F_SMALL_B)
        cur += w
    d.rectangle([bx + 16, 210, W - 40, 211], fill=GRAY_200)
    rows = [
        ("Top spenders — last 12 months",
         "Customer · revenue ≥ RM 5,000",                    "42",  "Live"),
        ("Birthday this month",
         "Customer · DOB month = current month",             "18",  "Live"),
        ("Reactivation candidates",
         "Customer · last contact 60–120 days ago",          "73",  "Live"),
        ("Datin Sarah's network",
         "Customer · referred (direct or grandchild)",       "8",   "Live"),
        ("Cancelled May promo",
         "Prospect · clicked APRFLASH but no booking",       "31",  "Static"),
    ]
    for i, (name, defn, size, refresh) in enumerate(rows):
        ry = 234 + i * 56
        d.text((bx + 16, ry), name, fill=GRAY_900, font=F_BODY_B)
        d.text((bx + 336, ry), defn, fill=GRAY_700, font=F_SMALL)
        d.text((bx + 716, ry), size, fill=PRIMARY, font=F_BODY_B)
        bg = GREEN_BG if refresh == "Live" else GRAY_100
        fg = GREEN_HI if refresh == "Live" else GRAY_700
        status_pill(d, bx + 816, ry - 2, refresh, bg, fg)
    header(d, 1, "Segments are reusable",
           "Live = auto-refreshes daily. Static = frozen at creation.")
    footer(d, "Use a list as the audience in Marketing Automation or NPS Surveys.")
    frames.append(img)

    # Frame 2 — segment builder
    img, d, sb_w = crm_shell(
        active_label="",
        page_title="Marketing Lists · New segment",
        page_subtitle="Stack rules — AND between blocks, OR within.",
    )
    panel(d, sb_w + 24, 110, W - sb_w - 48, H - 170, title=None)
    # Top: name + base
    d.text((sb_w + 40, 130), "List name", fill=GRAY_700, font=F_SMALL_B)
    input_box(d, sb_w + 40, 152, 460, 38, "", "VIP — birthday this month")
    d.text((sb_w + 520, 130), "From", fill=GRAY_700, font=F_SMALL_B)
    input_box(d, sb_w + 520, 152, 240, 38, "", "Customers")
    # Rule blocks
    blocks_y = 220
    for i, (op, rule, color) in enumerate([
            ("WHERE", "revenue (last 12 months)  ≥  RM 5,000",       PRIMARY),
            ("AND",   "DOB.month  =  current month",                  PURPLE),
            ("AND",   "marketing consent  =  yes",                    GREEN),
    ]):
        ry = blocks_y + i * 90
        # op chip
        d.rounded_rectangle([sb_w + 40, ry, sb_w + 120, ry + 36],
                            radius=6, fill=color)
        bbox = d.textbbox((0, 0), op, font=F_BODY_B)
        tw = bbox[2] - bbox[0]
        d.text((sb_w + 40 + (80 - tw) // 2, ry + 8), op,
               fill=WHITE, font=F_BODY_B)
        # rule box
        d.rounded_rectangle([sb_w + 140, ry, W - 240, ry + 60],
                            radius=8, fill=GRAY_50, outline=GRAY_200)
        d.text((sb_w + 156, ry + 18), rule, fill=GRAY_900, font=F_BODY_B)
        button(d, W - 220, ry + 14, 80, 32, "Edit",
               bg=WHITE, fg=GRAY_700)
        button(d, W - 130, ry + 14, 80, 32, "Remove",
               bg=WHITE, fg=RED_HI)
    # + add rule
    ry = blocks_y + 3 * 90
    d.rounded_rectangle([sb_w + 40, ry, W - 60, ry + 50],
                        radius=8, outline=GRAY_300, width=2)
    d.text((sb_w + 56, ry + 14), "+ Add another rule (AND / OR)",
           fill=GRAY_500, font=F_BODY_B)
    # Preview
    d.rounded_rectangle([sb_w + 40, H - 180, W - 60, H - 100],
                        radius=10, fill=PRIMARY_BG)
    d.text((sb_w + 56, H - 168), "Live preview",
           fill=PRIMARY, font=F_SMALL_B)
    d.text((sb_w + 56, H - 144), "12 customers match",
           fill=GRAY_900, font=F_H2)
    button(d, W - 220, H - 154, 160, 36, "Save segment")
    highlight_ring(d, W - 220, H - 154, 160, 36)
    header(d, 2, "Stack rules to build a segment",
           "Each block ANDs together. Preview shows live count as you build.")
    footer(d, "Saved segments stay live — count updates whenever the data changes.")
    frames.append(img)

    return frames


# ══════════════════════════════════════════════════════════════════════════
# GIF 25 — Purchases History
# ══════════════════════════════════════════════════════════════════════════
def gif_purchases_history():
    frames = []

    img, d, sb_w = crm_shell(
        active_label="",
        page_title="Purchases History",
        page_subtitle="Every paid invoice across all customers.",
    )
    bx = sb_w + 24
    input_box(d, bx, 110, 240, 36, "Search customer / ref…")
    button(d, bx + 252, 110, 130, 36, "May 2026 v", bg=WHITE, fg=GRAY_700)
    button(d, bx + 390, 110, 110, 36, "Status v", bg=WHITE, fg=GRAY_700)
    add_x = W - 220
    button(d, add_x, 110, 180, 36, "Export to XLSX",
           bg=GRAY_100, fg=GRAY_700)
    # KPI strip
    for i, (label, val, c) in enumerate(
            [("This month",  "RM 38,400",  GREEN_HI),
             ("Invoices",    "32",         GRAY_900),
             ("Avg basket",  "RM 1,200",   GRAY_900),
             ("Refunded",    "RM 600",     RED_HI)]):
        x = sb_w + 24 + i * 232
        d.rounded_rectangle([x, 160, x + 220, 240], radius=8, fill=WHITE,
                            outline=GRAY_200)
        d.text((x + 16, 172), label, fill=GRAY_500, font=F_SMALL_B)
        d.text((x + 16, 192), val, fill=c, font=F_BIG_NUM)
    # Table
    panel(d, bx, 260, W - bx - 24, H - 310, title=None)
    cols = [("Ref", 110), ("Date", 110), ("Customer", 220),
            ("Item", 200), ("Amount", 130), ("Method", 130), ("Status", 100)]
    cur = bx + 16
    for label, w in cols:
        d.text((cur, 280), label, fill=GRAY_500, font=F_SMALL_B)
        cur += w
    d.rectangle([bx + 16, 302, W - 40, 303], fill=GRAY_200)
    rows = [
        ("INV-5042", "30 May", "Datin Sarah",   "3-year package",   "RM 18,000", "Stripe",      "Paid"),
        ("INV-5041", "29 May", "Wong Kar Mun",  "Free BaZi taster", "RM 0",      "Promo",       "Comp"),
        ("INV-5040", "28 May", "Tan Mei Ling",  "Annual package",   "RM 4,800",  "FPX",         "Paid"),
        ("INV-5039", "27 May", "Ahmad Rahman",  "Annual package",   "RM 4,800",  "Cash",        "Paid"),
        ("INV-5038", "26 May", "Lim Siew Hua",  "Annual package",   "RM 4,800",  "Stripe",      "Refunded"),
    ]
    for i, (ref, date, cust, item, amt, method, status) in enumerate(rows):
        ry = 326 + i * 56
        d.text((bx + 16, ry), ref, fill=PRIMARY, font=F_MONO)
        d.text((bx + 126, ry), date, fill=GRAY_500, font=F_SMALL)
        d.text((bx + 236, ry), cust, fill=GRAY_900, font=F_BODY_B)
        d.text((bx + 456, ry), item, fill=GRAY_700, font=F_SMALL)
        d.text((bx + 656, ry), amt, fill=GRAY_900, font=F_BODY_B)
        d.text((bx + 786, ry), method, fill=GRAY_700, font=F_SMALL)
        bg, fg = {"Paid": (GREEN_BG, GREEN_HI),
                  "Comp": (BLUE_BG, BLUE_HI),
                  "Refunded": (RED_BG, RED_HI)}.get(status, (GRAY_100, GRAY_700))
        status_pill(d, bx + 916, ry - 2, status, bg, fg)
    header(d, 1, "Purchases History",
           "Every paid invoice. Export to XLSX for finance reconciliation.")
    footer(d, "Refunded rows stay visible — that's intentional, keeps the audit trail clear.")
    frames.append(img)

    # Frame 2 — invoice detail
    img, d, sb_w = crm_shell(
        active_label="",
        page_title="Purchases · INV-5042",
        page_subtitle="Datin Sarah · 3-year package · 30 May 2026",
    )
    # Left: invoice preview
    panel(d, sb_w + 24, 110, 540, H - 170, title=None)
    px, py = sb_w + 40, 130
    d.text((px + 20, py + 20), "DESTIN ORACLES",
           fill=PRIMARY, font=F_TITLE)
    d.text((px + 20, py + 56), "Tax invoice · INV-5042",
           fill=GRAY_500, font=F_SMALL)
    d.text((px + 380, py + 20), "30 May 2026",
           fill=GRAY_500, font=F_BODY_B)
    d.rectangle([px + 20, py + 90, px + 480, py + 91], fill=GRAY_200)
    # Bill to
    d.text((px + 20, py + 104), "BILL TO", fill=GRAY_500, font=F_SMALL_B)
    d.text((px + 20, py + 124), "Datin Sarah", fill=GRAY_900, font=F_BODY_B)
    d.text((px + 20, py + 146), "012-345 1234 · sarah@example.com",
           fill=GRAY_700, font=F_SMALL)
    # Line items
    d.rectangle([px + 20, py + 190, px + 480, py + 191], fill=GRAY_300)
    d.text((px + 20, py + 200), "ITEM", fill=GRAY_500, font=F_SMALL_B)
    d.text((px + 360, py + 200), "AMOUNT", fill=GRAY_500, font=F_SMALL_B)
    d.rectangle([px + 20, py + 220, px + 480, py + 221], fill=GRAY_200)
    items = [("3-year package · BaZi reading + monthly check-in",  "RM 18,000"),
             ("Subtotal",                                          "RM 18,000"),
             ("Tax (0%)",                                          "RM 0"),
             ("Total paid",                                        "RM 18,000")]
    for i, (it, amt) in enumerate(items):
        y = py + 234 + i * 30
        weight = F_BODY_B if i == 3 else F_BODY
        d.text((px + 20, y), it, fill=GRAY_900, font=weight)
        d.text((px + 360, y), amt, fill=GRAY_900, font=weight)
    # Paid stamp
    d.rounded_rectangle([px + 320, py + 380, px + 480, py + 430],
                        radius=10, outline=GREEN_HI, width=3)
    d.text((px + 360, py + 394), "PAID",
           fill=GREEN_HI, font=_font(28, bold=True))
    # Right: actions
    rx = sb_w + 580
    panel(d, rx, 110, W - rx - 24, H - 170, title="Actions")
    button(d, rx + 24, 160, W - rx - 72, 40, "Download PDF")
    button(d, rx + 24, 210, W - rx - 72, 40, "Email to customer",
           bg=GRAY_100, fg=GRAY_700)
    button(d, rx + 24, 260, W - rx - 72, 40, "Send via WhatsApp",
           bg=GREEN_HI)
    button(d, rx + 24, 320, W - rx - 72, 40, "Issue refund",
           bg=WHITE, fg=RED_HI)
    highlight_ring(d, rx + 24, 320, W - rx - 72, 40, color=RED_HI)
    d.text((rx + 24, 380), "Refund policy",
           fill=GRAY_500, font=F_SMALL_B)
    d.text((rx + 24, 402),
           "Full refund within 7 days. After that — pro-rata only, requires Marketing Manager sign-off.",
           fill=GRAY_700, font=F_SMALL)
    header(d, 2, "Invoice detail · refund flow",
           "PDF + email + WhatsApp send. Refund button highlighted in red.")
    footer(d, "Refunds create a negative INV-* row + reverse the Pipeline 'Won' record.")
    frames.append(img)

    return frames


# ══════════════════════════════════════════════════════════════════════════
# GIF 26 — Audit Logs
# ══════════════════════════════════════════════════════════════════════════
def gif_audit_logs():
    frames = []

    img, d, sb_w = crm_shell(
        active_label="",
        page_title="Audit Logs",
        page_subtitle="Top-bar  Security ▸ Audit Logs  — every change, every actor.",
    )
    bx = sb_w + 24
    input_box(d, bx, 110, 240, 36, "Search actor / action…")
    button(d, bx + 252, 110, 130, 36, "30d v", bg=WHITE, fg=GRAY_700)
    button(d, bx + 390, 110, 130, 36, "Severity v", bg=WHITE, fg=GRAY_700)
    add_x = W - 220
    button(d, add_x, 110, 180, 36, "Export CSV",
           bg=GRAY_100, fg=GRAY_700)
    panel(d, bx, 168, W - bx - 24, H - 220, title=None)
    cols = [("Time", 150), ("Actor", 180), ("Action", 360),
            ("Target", 200), ("Severity", 120)]
    cur = bx + 16
    for label, w in cols:
        d.text((cur, 188), label, fill=GRAY_500, font=F_SMALL_B)
        cur += w
    d.rectangle([bx + 16, 210, W - 40, 211], fill=GRAY_200)
    rows = [
        ("30 May 18:42", "Alice Lee",     "Marked deal Won",                        "Deal #DL-1042",     "info",     GRAY_100, GRAY_700),
        ("30 May 17:30", "Brian Raj",     "Updated phone number",                   "Cust Lim Pei Y.",   "info",     GRAY_100, GRAY_700),
        ("30 May 16:18", "Mei Mei",       "Sent campaign 'May newsletter' (157)",   "Marketing List",    "info",     GRAY_100, GRAY_700),
        ("30 May 14:02", "System",        "AI re-scored 248 leads",                 "Lead Scoring",      "info",     GRAY_100, GRAY_700),
        ("30 May 11:50", "Alice Lee",     "Issued refund RM 4,800",                 "INV-5038",          "high",     RED_BG,   RED_HI),
        ("30 May 09:14", "Kevin Soon",    "Failed login (3 attempts)",              "auth",              "warn",     ORANGE_BG, ORANGE_HI),
        ("29 May 22:00", "System",        "Nightly backup completed (1.4 GB)",      "backup",            "info",     GRAY_100, GRAY_700),
        ("29 May 19:30", "Marketing Mgr", "Changed AI scoring weights",             "AI Settings",       "high",     RED_BG,   RED_HI),
    ]
    for i, (when, who, action, target, sev, sbg, sfg) in enumerate(rows):
        ry = 234 + i * 50
        d.text((bx + 16, ry), when, fill=GRAY_500, font=F_SMALL_B)
        d.text((bx + 166, ry), who, fill=GRAY_900, font=F_BODY_B)
        d.text((bx + 346, ry), action, fill=GRAY_700, font=F_BODY)
        d.text((bx + 706, ry + 2), target, fill=PRIMARY, font=F_MONO)
        status_pill(d, bx + 906, ry - 2, sev, sbg, sfg)
    header(d, 1, "Every change is logged",
           "Includes user, system jobs, and AI actions. Red = high-impact.")
    footer(d, "Export CSV for compliance review. Logs retained 13 months by default.")
    frames.append(img)

    # Frame 2 — drilldown on one event
    img, d, sb_w = crm_shell(
        active_label="",
        page_title="Audit Logs · Event detail",
        page_subtitle="Issued refund RM 4,800 · INV-5038 · by Alice Lee",
    )
    panel(d, sb_w + 24, 110, W - sb_w - 48, H - 170, title=None)
    # event header
    d.text((sb_w + 40, 130), "30 May 2026 · 11:50:14 MYT",
           fill=GRAY_500, font=F_SMALL_B)
    d.text((sb_w + 40, 152), "Issued refund RM 4,800 on INV-5038",
           fill=GRAY_900, font=F_TITLE)
    status_pill(d, sb_w + 700, 156, "high", RED_BG, RED_HI)
    # Actor + target panels
    p_w = (W - sb_w - 80) // 2
    panel(d, sb_w + 40, 210, p_w - 8, 200, title="Actor")
    avatar(d, sb_w + 60, 254, 60, "AL", bg=PRIMARY)
    d.text((sb_w + 132, 256), "Alice Lee",
           fill=GRAY_900, font=F_BODY_B)
    d.text((sb_w + 132, 278), "Manager · Level 2",
           fill=GRAY_500, font=F_SMALL)
    d.text((sb_w + 132, 302), "From IP 60.51.x.x (KL)",
           fill=GRAY_700, font=F_SMALL)
    d.text((sb_w + 132, 322), "Chrome on Windows 11",
           fill=GRAY_700, font=F_SMALL)
    # right: target diff
    rx = sb_w + 56 + p_w
    panel(d, rx, 210, p_w - 8, 200, title="Diff")
    d.text((rx + 24, 254), "INV-5038.status", fill=GRAY_500, font=F_MONO)
    d.text((rx + 24, 274), "Paid", fill=GREEN_HI, font=F_MONO)
    arrow(d, rx + 70, 282, rx + 110, 282, color=GRAY_500, width=2)
    d.text((rx + 120, 274), "Refunded", fill=RED_HI, font=F_MONO)
    d.text((rx + 24, 314), "INV-5038.refund_amount",
           fill=GRAY_500, font=F_MONO)
    d.text((rx + 24, 334), "0  ", fill=GREEN_HI, font=F_MONO)
    arrow(d, rx + 60, 342, rx + 100, 342, color=GRAY_500, width=2)
    d.text((rx + 110, 334), "4800.00 (MYR)", fill=RED_HI, font=F_MONO)
    # Bottom: reason + linked records
    panel(d, sb_w + 40, 430, W - sb_w - 80, H - 490, title="Reason given")
    d.text((sb_w + 56, 470),
           "Customer's reading report was sent in English instead of Mandarin.",
           fill=GRAY_900, font=F_BODY)
    d.text((sb_w + 56, 494),
           "Full refund per 7-day policy. Linked Case #1024.",
           fill=GRAY_700, font=F_SMALL)
    # Buttons
    button(d, W - 380, H - 110, 130, 38, "Linked Case",
           bg=GRAY_100, fg=GRAY_700)
    button(d, W - 240, H - 110, 180, 38, "Revert (24h window)",
           bg=PURPLE)
    highlight_ring(d, W - 240, H - 110, 180, 38, color=PURPLE)
    header(d, 2, "Each event explains itself",
           "Actor + IP + device + before/after diff + reason. Revertable within 24h.")
    footer(d, "Reverting fires another audit row — never silent.")
    frames.append(img)

    return frames


# ══════════════════════════════════════════════════════════════════════════
# GIF 27 — Two-factor authentication setup
# ══════════════════════════════════════════════════════════════════════════
def gif_two_factor():
    frames = []

    img, d, sb_w = crm_shell(
        active_label="",
        page_title="2FA setup",
        page_subtitle="Top-bar  Security ▸ 2FA  — protect your account with an extra step.",
    )
    # Stepper
    for i, (label, done) in enumerate([
            ("Choose method", True),
            ("Scan QR", True),
            ("Enter code", False),
            ("Save backups", False)]):
        x = sb_w + 24 + i * 230
        c = GREEN_HI if done else GRAY_400
        d.ellipse([x, 110, x + 32, 142], fill=c)
        d.text((x + 10, 116), "✓" if done else str(i + 1),
               fill=WHITE, font=F_BODY_B)
        d.text((x + 44, 116), label,
               fill=GRAY_900 if done else GRAY_500, font=F_BODY_B)
        if i < 3:
            d.line([x + 200, 126, x + 230, 126], fill=GRAY_300, width=2)
    # Current step content
    panel(d, sb_w + 24, 170, W - sb_w - 48, H - 230,
          title="3.  Enter the 6-digit code from your authenticator app")
    # 6 input boxes
    cx_ = sb_w + (W - sb_w) // 2 - 180
    for i, ch in enumerate("482917"):
        bx = cx_ + i * 60
        d.rounded_rectangle([bx, 250, bx + 50, 310],
                            radius=8, fill=WHITE, outline=PRIMARY, width=2)
        bbox = d.textbbox((0, 0), ch, font=_font(32, bold=True))
        tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
        d.text((bx + (50 - tw) // 2, 250 + (60 - th) // 2 - 4),
               ch, fill=GRAY_900, font=_font(32, bold=True))
    # Info
    d.rounded_rectangle([sb_w + 80, 350, W - 80, 460],
                        radius=10, fill=PRIMARY_BG)
    d.text((sb_w + 96, 364), "Codes refresh every 30 seconds.",
           fill=PRIMARY, font=F_BODY_B)
    d.text((sb_w + 96, 388),
           "Open your authenticator app (Google Authenticator, Authy, 1Password).",
           fill=GRAY_700, font=F_SMALL)
    d.text((sb_w + 96, 410),
           "Find 'Destin Oracles CRM'. Type the current 6-digit code above.",
           fill=GRAY_700, font=F_SMALL)
    d.text((sb_w + 96, 432),
           "Tip: paste also works — code copied to clipboard auto-fills.",
           fill=GRAY_500, font=F_SMALL_B)
    # Buttons
    button(d, W - 380, H - 110, 130, 38, "Back",
           bg=GRAY_100, fg=GRAY_700)
    bx2, by2, bw, bh = W - 240, H - 110, 180, 38
    button(d, bx2, by2, bw, bh, "Verify & continue")
    highlight_ring(d, bx2, by2, bw, bh)
    header(d, 1, "Type the 6-digit code",
           "Each input auto-advances to the next. Paste works too.")
    footer(d, "If you don't have an authenticator app yet, download one before continuing.")
    frames.append(img)

    # Frame 2 — backup codes
    img, d, sb_w = crm_shell(
        active_label="",
        page_title="2FA setup · Backup codes",
        page_subtitle="Save these — they get you in if you lose your phone.",
    )
    panel(d, sb_w + 24, 110, W - sb_w - 48, H - 170, title=None)
    # 10 codes in 2 columns
    codes = ["3F4A-92K1", "8H2P-7M5N", "BX8L-X3Q7", "9KR2-N8P4", "M7H5-L1Z9",
             "P3W6-J7N2", "Q4R9-B6T8", "C2K7-V3X5", "Y8N4-M9P1", "T6L2-W3R8"]
    for i, code in enumerate(codes):
        col = i % 2
        row = i // 2
        x = sb_w + 60 + col * 460
        y = 160 + row * 64
        d.rounded_rectangle([x, y, x + 420, y + 50], radius=8, fill=GRAY_50,
                            outline=GRAY_200)
        d.text((x + 16, y + 6), f"#{i + 1:02d}",
               fill=GRAY_500, font=F_TINY_B)
        d.text((x + 56, y + 12), code, fill=GRAY_900,
               font=_font(22, bold=True))
        # used? (just for visual variety, show none used)
    # Warning
    d.rounded_rectangle([sb_w + 60, H - 220, W - 84, H - 140],
                        radius=10, fill=ORANGE_BG)
    d.text((sb_w + 76, H - 206), "⚠  Save these now",
           fill=ORANGE_HI, font=F_BODY_B)
    d.text((sb_w + 76, H - 180),
           "Each code works once. We can't show them again after you leave this page.",
           fill=GRAY_700, font=F_SMALL)
    # Actions
    button(d, sb_w + 60, H - 110, 160, 38, "Download .txt",
           bg=GRAY_100, fg=GRAY_700)
    button(d, sb_w + 230, H - 110, 160, 38, "Print",
           bg=GRAY_100, fg=GRAY_700)
    bx, by, bw, bh = W - 220, H - 110, 160, 38
    button(d, bx, by, bw, bh, "I saved them →")
    highlight_ring(d, bx, by, bw, bh)
    header(d, 2, "10 one-time backup codes",
           "Stash them in your password manager. Each works once.")
    footer(d, "Lost both phone AND backup codes? Marketing Manager can reset 2FA for you.")
    frames.append(img)

    return frames


# ══════════════════════════════════════════════════════════════════════════
# GIF 28 — Backup Manager
# ══════════════════════════════════════════════════════════════════════════
def gif_backup():
    frames = []

    img, d, sb_w = crm_shell(
        active_label="",
        page_title="Backup Manager",
        page_subtitle="Top-bar  Admin ▸ Backup & Restore  — your safety net.",
    )
    # Status banner
    d.rounded_rectangle([sb_w + 24, 110, W - 24, 170],
                        radius=10, fill=GREEN_BG)
    d.text((sb_w + 40, 122),
           "● Healthy — last successful backup 6 hours ago",
           fill=GREEN_HI, font=F_BODY_B)
    d.text((sb_w + 40, 144),
           "Nightly schedule: 02:00 MYT · stored encrypted in Supabase + S3 mirror",
           fill=GRAY_700, font=F_SMALL)
    # Backup history
    panel(d, sb_w + 24, 190, W - sb_w - 48, H - 250,
          title="Recent backups")
    cols = [("When", 200), ("Type", 140), ("Size", 130),
            ("Records", 130), ("Status", 120), ("", 200)]
    cur = sb_w + 40
    for label, w in cols:
        d.text((cur, 210), label, fill=GRAY_500, font=F_SMALL_B)
        cur += w
    d.rectangle([sb_w + 40, 232, W - 40, 233], fill=GRAY_200)
    rows = [
        ("30 May 02:00", "Nightly auto",  "1.42 GB", "284,113", "OK"),
        ("29 May 18:00", "Pre-deploy",     "1.41 GB", "283,902", "OK"),
        ("29 May 02:00", "Nightly auto",  "1.41 GB", "283,840", "OK"),
        ("28 May 02:00", "Nightly auto",  "1.40 GB", "283,510", "OK"),
        ("27 May 14:18", "Manual",         "1.39 GB", "283,201", "OK"),
        ("27 May 02:00", "Nightly auto",  "1.39 GB", "283,180", "OK"),
    ]
    for i, (when, kind, size, recs, status) in enumerate(rows):
        ry = 256 + i * 56
        d.text((sb_w + 40, ry), when, fill=GRAY_500, font=F_SMALL_B)
        d.text((sb_w + 240, ry), kind, fill=GRAY_900, font=F_BODY)
        d.text((sb_w + 380, ry), size, fill=GRAY_900, font=F_MONO)
        d.text((sb_w + 510, ry), recs, fill=GRAY_900, font=F_MONO)
        status_pill(d, sb_w + 640, ry - 2, status, GREEN_BG, GREEN_HI)
        button(d, sb_w + 760, ry - 4, 100, 30, "Download",
               bg=GRAY_100, fg=GRAY_700)
        button(d, sb_w + 870, ry - 4, 90, 30, "Restore",
               bg=GRAY_100, fg=GRAY_700)
    # Manual button
    button(d, W - 220, 110, 160, 36, "Run backup now")
    highlight_ring(d, W - 220, 110, 160, 36)
    header(d, 1, "Backups — automatic + on-demand",
           "Nightly + pre-deploy backups happen for you. Manual is for big migrations.")
    footer(d, "Restore wipes current data and replaces — Super Admin password required.")
    frames.append(img)

    # Frame 2 — restore confirmation
    img, d, sb_w = crm_shell(
        active_label="",
        page_title="Backup Manager · Restore",
        page_subtitle="Restore from 29 May 18:00 — pre-deploy snapshot.",
    )
    img = darken(img, alpha=140)
    d = ImageDraw.Draw(img)
    mx, my, mw, mh = 280, 130, 640, 460
    d.rounded_rectangle([mx, my, mx + mw, my + mh], radius=12, fill=WHITE)
    d.text((mx + 24, my + 20), "⚠  Restore is destructive",
           fill=RED_HI, font=F_TITLE)
    d.text((mx + 24, my + 56),
           "Everything created or edited AFTER this snapshot will be lost.",
           fill=GRAY_700, font=F_BODY)
    # Diff summary
    d.rounded_rectangle([mx + 24, my + 100, mx + mw - 24, my + 240],
                        radius=10, fill=RED_BG)
    d.text((mx + 40, my + 116), "What you'll lose",
           fill=RED_HI, font=F_SMALL_B)
    losses = [
        "8 new prospects",
        "12 deal updates",
        "2 won deals (RM 16,800)",
        "4 case resolutions",
        "All AI insights generated since 29 May 18:00",
    ]
    for i, t in enumerate(losses):
        d.text((mx + 40, my + 144 + i * 22), "·  " + t,
               fill=RED_HI, font=F_BODY)
    # Confirm input
    d.text((mx + 24, my + 270), "Type RESTORE to confirm",
           fill=GRAY_700, font=F_SMALL_B)
    input_box(d, mx + 24, my + 292, mw - 48, 38, "", "RESTORE", mono=True)
    d.text((mx + 24, my + 340),
           "After confirming, restore takes ~3 minutes. The app will be read-only meanwhile.",
           fill=GRAY_500, font=F_SMALL)
    button(d, mx + mw - 360, my + mh - 56, 150, 38, "Cancel",
           bg=GRAY_100, fg=GRAY_700)
    bx, by, bw, bh = mx + mw - 200, my + mh - 56, 180, 38
    button(d, bx, by, bw, bh, "Restore anyway", bg=RED_HI)
    highlight_ring(d, bx, by, bw, bh, color=RED_HI)
    header(d, 2, "Restore — irreversible",
           "Lists exactly what you'll lose. Type RESTORE to enable the button.")
    footer(d, "Restored data still exists in the backup — you can re-restore forward later.")
    frames.append(img)

    return frames


# ══════════════════════════════════════════════════════════════════════════
# GIF 29 — Noticeboard (公告栏)
# ══════════════════════════════════════════════════════════════════════════
def gif_noticeboard():
    frames = []

    img, d, sb_w = crm_shell(
        active_label="",
        page_title="Noticeboard · 公告栏",
        page_subtitle="Internal announcements — everyone sees them when they sign in.",
    )
    # Pinned banner at top
    d.rounded_rectangle([sb_w + 24, 110, W - 24, 180],
                        radius=10, fill=PRIMARY_BG)
    draw_emoji(d, sb_w + 40, 118, "📌", 18)
    d.text((sb_w + 64, 122), "Pinned · expires Friday",
           fill=PRIMARY, font=F_SMALL_B)
    d.text((sb_w + 40, 144),
           "Team lunch this Saturday 12:30 — please RSVP in the WhatsApp group.",
           fill=GRAY_900, font=F_BODY_B)
    # New post button
    add_x = W - 200
    button(d, add_x, 200, 160, 36, "+ New Notice")
    highlight_ring(d, add_x, 200, 160, 36)
    arrow(d, add_x - 50, 180, add_x - 6, 218)
    # Notice cards
    cards = [
        ("📣", "May targets pushed up 10%",
         "Marketing Manager · 2 days ago · 8 read",
         "We're tracking ahead of plan. Pushing targets up 10% to keep momentum.",
         PRIMARY),
        ("🎉", "Datin Sarah signed a 3-year",
         "Alice · 3 days ago · 12 read",
         "RM 18,000 — biggest single deal this quarter. Brian, can you replicate the playbook?",
         GREEN),
        ("⚠", "Stock-take starts Monday",
         "Super Admin · 4 days ago · 12 read",
         "Half-day on Monday for store stock-take. See /docs/stock-take-v2/.",
         ORANGE),
        ("🎂", "Brian's birthday Friday",
         "Alice · 5 days ago · 11 read",
         "We're getting kueh at 3pm. Don't tell him.",
         PURPLE),
    ]
    for i, (icon, title, meta, body, c) in enumerate(cards):
        x = sb_w + 24 + (i % 2) * 480
        y = 250 + (i // 2) * 200
        d.rounded_rectangle([x, y, x + 462, y + 180],
                            radius=10, fill=WHITE, outline=GRAY_200)
        d.rectangle([x, y, x + 6, y + 180], fill=c)
        draw_emoji(d, x + 20, y + 16, icon, 26)
        d.text((x + 56, y + 18), title, fill=GRAY_900, font=F_BODY_B)
        d.text((x + 56, y + 42), meta, fill=GRAY_500, font=F_SMALL)
        # body text wrap (simple)
        words = body.split()
        line = ""
        ly = y + 76
        for w in words:
            test = (line + " " + w).strip()
            bbox = d.textbbox((0, 0), test, font=F_BODY)
            if bbox[2] - bbox[0] > 420:
                d.text((x + 20, ly), line, fill=GRAY_700, font=F_BODY)
                ly += 22
                line = w
            else:
                line = test
        if line:
            d.text((x + 20, ly), line, fill=GRAY_700, font=F_BODY)
        button(d, x + 20, y + 140, 80, 28, "Read",
               bg=GRAY_100, fg=GRAY_700)
        button(d, x + 110, y + 140, 80, 28, "♥ 3",
               bg=GRAY_100, fg=GRAY_700)
    header(d, 1, "Noticeboard · 公告栏",
           "Pinned post at the top, normal posts below. Click + New Notice to write.")
    footer(d, "All notices respect language — Mandarin posts auto-translate for English readers.")
    frames.append(img)

    # Frame 2 — compose modal
    img, d, sb_w = crm_shell(
        active_label="",
        page_title="Noticeboard · 公告栏",
        page_subtitle="Write a short notice — supports Markdown for emphasis.",
    )
    img = darken(img, alpha=130)
    d = ImageDraw.Draw(img)
    mx, my, mw, mh = 260, 90, 680, 540
    d.rounded_rectangle([mx, my, mx + mw, my + mh], radius=12, fill=WHITE)
    d.text((mx + 24, my + 20), "New Notice", fill=GRAY_900, font=F_TITLE)
    d.text((mx + 24, my + 56),
           "Keep it short. Markdown works — **bold**, *italic*, `code`.",
           fill=GRAY_500, font=F_SMALL)
    def lbl(text, x, y):
        d.text((x, y), text, fill=GRAY_700, font=F_SMALL_B)
    lbl("● Title", mx + 24, my + 100)
    input_box(d, mx + 24, my + 122, mw - 48, 38, "",
              "WhatsApp template #4 updated — please review")
    lbl("Type", mx + 24, my + 180)
    types_ = [("Announce",   PRIMARY_BG,  PRIMARY,   True),
              ("Celebrate",  GREEN_BG,    GREEN_HI,  False),
              ("⚠ Heads-up", ORANGE_BG,   ORANGE_HI, False),
              ("★ Pin",      PURPLE_BG,   PURPLE,    False)]
    for i, (label_, bg, fg, sel) in enumerate(types_):
        cx = mx + 24 + i * 150
        d.rounded_rectangle([cx, my + 202, cx + 140, my + 240],
                            radius=18, fill=bg,
                            outline=fg if sel else None,
                            width=2 if sel else 0)
        bbox = d.textbbox((0, 0), label_, font=F_BODY_B)
        tw = bbox[2] - bbox[0]
        d.text((cx + (140 - tw) // 2, my + 210), label_,
               fill=fg, font=F_BODY_B)
    lbl("Body", mx + 24, my + 260)
    d.rounded_rectangle([mx + 24, my + 282, mx + mw - 24, my + 282 + 130],
                        radius=6, fill=WHITE, outline=GRAY_300)
    d.text((mx + 34, my + 292),
           "Updated the WhatsApp template #4 — now uses {{customer.first_name}}",
           fill=GRAY_900, font=F_BODY)
    d.text((mx + 34, my + 314),
           "instead of full name. Cleaner read on small screens.",
           fill=GRAY_900, font=F_BODY)
    d.text((mx + 34, my + 348),
           "**Brian + Yi**, can you eyeball it before Monday?",
           fill=GRAY_900, font=F_BODY)
    # Audience / expire
    lbl("Audience", mx + 24, my + 430)
    input_box(d, mx + 24, my + 452, 320, 38, "", "Everyone (12 people)")
    lbl("Expire", mx + 360, my + 430)
    input_box(d, mx + 360, my + 452, 220, 38, "", "7 days")
    button(d, mx + mw - 240, my + mh - 56, 100, 38, "Cancel",
           bg=GRAY_100, fg=GRAY_700)
    bx, by, bw, bh = mx + mw - 130, my + mh - 56, 110, 38
    button(d, bx, by, bw, bh, "Post")
    highlight_ring(d, bx, by, bw, bh)
    header(d, 2, "Write & post",
           "Title + type + body. Expiry auto-archives the notice.")
    footer(d, "Posts appear immediately for everyone in the audience.")
    frames.append(img)

    return frames


# ══════════════════════════════════════════════════════════════════════════
# GIF 30 — Profile & Settings
# ══════════════════════════════════════════════════════════════════════════
def gif_profile_settings():
    frames = []

    img, d, sb_w = crm_shell(
        active_label="",
        page_title="My profile & settings",
        page_subtitle="Open via the top-right initials → My profile.",
    )
    # Left: profile card
    panel(d, sb_w + 24, 110, 360, H - 170, title="Profile")
    avatar(d, sb_w + 60, 160, 100, "AL", bg=PRIMARY)
    d.text((sb_w + 180, 168), "Alice Lee", fill=GRAY_900, font=F_TITLE)
    d.text((sb_w + 180, 200), "Manager · Level 2",
           fill=GRAY_500, font=F_BODY)
    d.text((sb_w + 60, 290), "alice@destinoraclessolution.com",
           fill=GRAY_700, font=F_BODY)
    d.text((sb_w + 60, 314), "012-345 6789",
           fill=GRAY_700, font=F_BODY)
    button(d, sb_w + 60, 360, 280, 36, "Upload new photo",
           bg=GRAY_100, fg=GRAY_700)
    button(d, sb_w + 60, 406, 280, 36, "Edit profile",
           bg=GRAY_100, fg=GRAY_700)
    # Right: settings sections
    rx = sb_w + 400
    # Section: Account
    panel(d, rx, 110, W - rx - 24, 180, title="Account")
    rows_acc = [
        ("Language",       "English", True),
        ("Timezone",       "Asia/Kuala_Lumpur (MYT)", False),
        ("Date format",    "DD MMM YYYY", False),
    ]
    for i, (k, v, hl) in enumerate(rows_acc):
        ry = 160 + i * 36
        d.text((rx + 24, ry), k, fill=GRAY_500, font=F_SMALL_B)
        d.text((rx + 220, ry), v, fill=GRAY_900, font=F_BODY_B)
        button(d, W - 140, ry - 4, 80, 28, "Change",
               bg=GRAY_100, fg=GRAY_700)
    # Section: Notifications
    panel(d, rx, 310, W - rx - 24, 180, title="Notifications")
    rows_n = [
        ("Email — new prospect",  True),
        ("WhatsApp — hot lead alert", True),
        ("Push — case escalated",  True),
        ("Daily digest at 08:00",  False),
    ]
    for i, (k, on) in enumerate(rows_n):
        ry = 348 + i * 30
        d.text((rx + 24, ry), k, fill=GRAY_900, font=F_BODY)
        # toggle
        tx = W - 160
        if on:
            d.rounded_rectangle([tx, ry, tx + 50, ry + 24],
                                radius=12, fill=GREEN_HI)
            d.ellipse([tx + 26, ry, tx + 50, ry + 24], fill=WHITE)
        else:
            d.rounded_rectangle([tx, ry, tx + 50, ry + 24],
                                radius=12, fill=GRAY_300)
            d.ellipse([tx, ry, tx + 24, ry + 24], fill=WHITE)
    # Section: Security
    panel(d, rx, 510, W - rx - 24, H - 580, title="Security")
    button(d, rx + 24, 560, 200, 36, "Change password",
           bg=GRAY_100, fg=GRAY_700)
    button(d, rx + 240, 560, 200, 36, "Set up 2FA",
           bg=PRIMARY, fg=WHITE)
    highlight_ring(d, rx + 240, 560, 200, 36)
    button(d, rx + 456, 560, 200, 36, "Sign out other sessions",
           bg=GRAY_100, fg=GRAY_700)
    header(d, 1, "Your account — all in one place",
           "Profile · language · notifications · security.")
    footer(d, "Setting up 2FA is the single most useful thing you can do — takes 2 minutes.")
    frames.append(img)

    # Frame 2 — change password modal
    img, d, sb_w = crm_shell(
        active_label="",
        page_title="My profile & settings",
        page_subtitle="Change your password — strong passwords only.",
    )
    img = darken(img, alpha=130)
    d = ImageDraw.Draw(img)
    mx, my, mw, mh = 360, 150, 480, 420
    d.rounded_rectangle([mx, my, mx + mw, my + mh], radius=12, fill=WHITE)
    d.text((mx + 24, my + 20), "Change password",
           fill=GRAY_900, font=F_TITLE)
    d.text((mx + 24, my + 56),
           "Must be ≥ 12 chars, with a number and a symbol.",
           fill=GRAY_500, font=F_SMALL)
    def lbl(text, y):
        d.text((mx + 24, y), text, fill=GRAY_700, font=F_SMALL_B)
    lbl("Current password", my + 100)
    input_box(d, mx + 24, my + 122, mw - 48, 38, "", "•" * 12)
    lbl("New password", my + 180)
    input_box(d, mx + 24, my + 202, mw - 48, 38, "", "•" * 16)
    # Strength bar
    d.rounded_rectangle([mx + 24, my + 246, mx + mw - 24, my + 254],
                        radius=4, fill=GRAY_100)
    d.rounded_rectangle([mx + 24, my + 246, mx + 24 + (mw - 48) * 4 // 5, my + 254],
                        radius=4, fill=GREEN_HI)
    d.text((mx + 24, my + 260), "Strong",
           fill=GREEN_HI, font=F_SMALL_B)
    lbl("Confirm new password", my + 290)
    input_box(d, mx + 24, my + 312, mw - 48, 38, "", "•" * 16)
    button(d, mx + mw - 240, my + mh - 56, 100, 38, "Cancel",
           bg=GRAY_100, fg=GRAY_700)
    bx, by, bw, bh = mx + mw - 130, my + mh - 56, 110, 38
    button(d, bx, by, bw, bh, "Save")
    highlight_ring(d, bx, by, bw, bh)
    header(d, 2, "Change password",
           "Strength meter turns green when it's strong enough.")
    footer(d, "Saving signs you out of every other session — secure-by-default.")
    frames.append(img)

    return frames


# ══════════════════════════════════════════════════════════════════════════
# Save GIF helper
# ══════════════════════════════════════════════════════════════════════════
def save_gif(frames, name):
    path = OUT / name
    converted = [f.convert("P", palette=Image.ADAPTIVE, colors=256) for f in frames]
    converted[0].save(
        path,
        save_all=True,
        append_images=converted[1:],
        duration=FRAME_MS,
        loop=0,
        optimize=True,
        disposal=2,
    )
    print(f"wrote {path}  ({path.stat().st_size // 1024} KB, {len(frames)} frames)")


def main():
    save_gif(gif_login(),         "01-login-and-navigation.gif")
    save_gif(gif_add_prospect(),  "02-add-prospect.gif")
    save_gif(gif_pipeline(),      "03-pipeline-management.gif")
    save_gif(gif_calendar(),      "04-calendar-and-booking.gif")
    save_gif(gif_cases(),         "05-cases-and-followups.gif")
    save_gif(gif_referrals(),     "06-referrals.gif")
    save_gif(gif_performance(),   "07-performance-reports.gif")
    save_gif(gif_knowledge(),     "08-knowledge-hq.gif")
    save_gif(gif_promotions(),    "09-promotions.gif")
    save_gif(gif_automation(),    "10-marketing-automation.gif")
    save_gif(gif_agents(),        "11-agents-and-roles.gif")
    save_gif(gif_documents(),     "12-documents.gif")
    save_gif(gif_ai_insights(),         "13-ai-insights.gif")
    save_gif(gif_lead_scoring(),        "14-lead-scoring.gif")
    save_gif(gif_sales_forecast(),      "15-sales-forecast.gif")
    save_gif(gif_churn_risk(),          "16-churn-risk.gif")
    save_gif(gif_performance_insights(), "17-performance-insights.gif")
    save_gif(gif_lead_forms(),          "18-lead-capture-forms.gif")
    save_gif(gif_nps_surveys(),         "19-nps-surveys.gif")
    save_gif(gif_contracts(),           "20-contracts.gif")
    save_gif(gif_booking_scheduler(),   "21-booking-scheduler.gif")
    save_gif(gif_custom_fields(),       "22-custom-fields.gif")
    save_gif(gif_integrations(),        "23-integrations.gif")
    save_gif(gif_marketing_lists(),     "24-marketing-lists.gif")
    save_gif(gif_purchases_history(),   "25-purchases-history.gif")
    save_gif(gif_audit_logs(),          "26-audit-logs.gif")
    save_gif(gif_two_factor(),          "27-two-factor-auth.gif")
    save_gif(gif_backup(),              "28-backup-manager.gif")
    save_gif(gif_noticeboard(),         "29-noticeboard.gif")
    save_gif(gif_profile_settings(),    "30-profile-settings.gif")


if __name__ == "__main__":
    main()
