"""
Build the 4 how-to GIFs for the new Stock Take v2 features.

Each GIF is a series of PIL-rendered "instruction frames" — clean labelled
mockups of the actual CRM UI showing where to click. We do this instead of
recording the real app because (a) the gif_creator Chrome extension was hung
and (b) it's safer and cleaner not to mutate production data during recording.

Run:  python docs/stock-take-v2/_make_gifs.py
Out:  docs/stock-take-v2/01-shelf-master-setup.gif
      docs/stock-take-v2/02-scan-shelf-to-count.gif
      docs/stock-take-v2/03-three-way-reconciliation.gif
      docs/stock-take-v2/04-accept-variances.gif
"""

from PIL import Image, ImageDraw, ImageFont
from pathlib import Path

OUT = Path(__file__).parent
W, H = 1200, 720
FRAME_MS = 1800   # ms per frame

# ── Colours (match the CRM palette) ───────────────────────────────────────
WHITE       = (255, 255, 255)
BG          = (250, 250, 252)
GRAY_50     = (248, 250, 252)
GRAY_100    = (241, 245, 249)
GRAY_200    = (226, 232, 240)
GRAY_300    = (203, 213, 225)
GRAY_500    = (100, 116, 139)
GRAY_600    = (71, 85, 105)
GRAY_700    = (51, 65, 85)
GRAY_900    = (15, 23, 42)
PRIMARY     = (236, 72, 153)        # CRM pink primary
PURPLE      = (124, 58, 237)
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
YELLOW_BG   = (254, 243, 199)
YELLOW_HI   = (146, 64, 14)
HIGHLIGHT   = (236, 72, 153, 255)


def _font(size, bold=False, cjk=False):
    # CJK fonts come first when requested. Microsoft YaHei ships with every
    # modern Windows install and covers 悅 / 客 / 匯 / 改 / 命 / etc cleanly.
    paths = []
    if cjk:
        if bold:
            paths += ["C:/Windows/Fonts/msyhbd.ttc", "C:/Windows/Fonts/msyhbd.ttf"]
        paths += ["C:/Windows/Fonts/msyh.ttc", "C:/Windows/Fonts/msyh.ttf",
                  "C:/Windows/Fonts/simsun.ttc"]
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


F_CJK_TITLE = _font(30, bold=True, cjk=True)
F_CJK_BODY  = _font(18, cjk=True)


F_TITLE   = _font(30, bold=True)
F_STEP    = _font(20, bold=True)
F_BODY    = _font(18)
F_BODY_B  = _font(18, bold=True)
F_SMALL   = _font(14)
F_SMALL_B = _font(14, bold=True)
F_TINY    = _font(12)
F_MONO    = _font(15)


def new_frame():
    img = Image.new("RGB", (W, H), BG)
    d = ImageDraw.Draw(img)
    return img, d


# ── Reusable primitives ───────────────────────────────────────────────────
def header(d, step_n, title, caption):
    """Top bar: step badge, title, caption."""
    # Top white strip
    d.rectangle([0, 0, W, 90], fill=WHITE, outline=GRAY_200)
    # Step badge
    badge_x, badge_y = 24, 22
    d.rounded_rectangle([badge_x, badge_y, badge_x + 46, badge_y + 46],
                        radius=23, fill=PRIMARY)
    bbox = d.textbbox((0, 0), str(step_n), font=F_STEP)
    tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
    d.text((badge_x + (46 - tw) // 2, badge_y + (46 - th) // 2 - 2),
           str(step_n), fill=WHITE, font=F_STEP)
    # Title + caption
    d.text((90, 18), title, fill=GRAY_900, font=F_TITLE)
    d.text((90, 56), caption, fill=GRAY_600, font=F_BODY)


def footer(d, caption):
    d.rectangle([0, H - 50, W, H], fill=WHITE, outline=GRAY_200)
    d.text((24, H - 38), caption, fill=GRAY_700, font=F_BODY)


def tab_row(d, x, y, tabs, active_idx):
    """Render the stock-take horizontal tab strip."""
    cur_x = x
    for i, t in enumerate(tabs):
        bbox = d.textbbox((0, 0), t, font=F_BODY_B if i == active_idx else F_BODY)
        tw = bbox[2] - bbox[0]
        pad = 14
        is_active = i == active_idx
        d.text((cur_x + pad, y + 8), t,
               fill=PRIMARY if is_active else GRAY_600,
               font=F_BODY_B if is_active else F_BODY)
        if is_active:
            d.rectangle([cur_x, y + 40, cur_x + tw + pad * 2, y + 43], fill=PRIMARY)
        cur_x += tw + pad * 2 + 4
    # baseline
    d.rectangle([x, y + 42, W - 40, y + 44], fill=GRAY_200)


def panel(d, x, y, w, h, title=None):
    d.rounded_rectangle([x, y, x + w, y + h], radius=8, fill=WHITE, outline=GRAY_200)
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
    """Pulsing highlight around an element."""
    for off in (6, 4, 2):
        d.rounded_rectangle([x - off, y - off, x + w + off, y + h + off],
                            radius=10, outline=color, width=2)


def arrow(d, x1, y1, x2, y2, color=ORANGE):
    d.line([x1, y1, x2, y2], fill=color, width=4)
    import math
    angle = math.atan2(y2 - y1, x2 - x1)
    ah = 14
    aw = 9
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


# ── Common: stock take chrome ─────────────────────────────────────────────
ST_TABS = ["Sessions", "Shelves (v2)", "System Stock", "Exclusions",
           "Per-shelf Count", "Bulk Physical", "Reconciliation", "Recount", "Final Summary"]


def base_chrome(active_tab_idx):
    img, d = new_frame()
    # Header
    header(d, "", "", "")
    # Page title bar
    d.text((24, 100), "Stock Take", fill=GRAY_900, font=F_TITLE)
    d.text((24, 138), "Shelf-by-shelf physical count reconciliation",
           fill=GRAY_600, font=F_BODY)
    # Tab row
    tab_row(d, 24, 180, ST_TABS, active_tab_idx)
    return img, d


# ── GIF 1: Shelf Master setup ─────────────────────────────────────────────
def gif_shelves():
    frames = []

    # Frame 1 — overview, point to Shelves (v2) tab
    img, d = base_chrome(active_tab_idx=0)
    header(d, 1, "Open the Shelves (v2) tab",
           "One-time setup: add stores, shelves, and what should sit on each shelf.")
    # mark target tab position approximate
    highlight_ring(d, 110, 188, 145, 36)
    arrow(d, 200, 280, 175, 230)
    panel(d, 24, 260, W - 48, 380, title="Stock Take Sessions")
    d.text((40, 320), "(Sessions list — your existing v1 stays untouched.)",
           fill=GRAY_500, font=F_BODY)
    footer(d, "Click the second tab: Shelves (v2).")
    frames.append(img)

    # Frame 2 — Shelves (v2) opened, two forms visible
    img, d = base_chrome(active_tab_idx=1)
    header(d, 2, "Add a store",
           "Pick a short code (e.g. PUCHONG) and the readable name.")
    # Add Store card
    panel(d, 24, 240, 560, 130, title="Add Store")
    input_box(d, 40, 290, 200, 36, "store code (e.g. PUCHONG)", "PUCHONG", mono=True)
    input_box(d, 250, 290, 250, 36, "name", "Puchong Pharmacy")
    button(d, 510, 290, 60, 36, "+")
    # Add Shelf card (faded)
    panel(d, 600, 240, W - 624, 130, title="Add Shelf")
    input_box(d, 616, 290, 140, 36, "store…")
    input_box(d, 762, 290, 130, 36, "shelf code (A1-01)", mono=True)
    input_box(d, 898, 290, 220, 36, "QR payload", mono=True)
    button(d, 1125, 290, 50, 36, "+")
    # Highlight Add Store input
    highlight_ring(d, 40, 290, 200, 36)
    arrow(d, 320, 410, 250, 340)
    footer(d, "Click + to save. The store appears in the table below.")
    frames.append(img)

    # Frame 3 — Add Shelf, highlight the right side
    img, d = base_chrome(active_tab_idx=1)
    header(d, 3, "Add a shelf for that store",
           "Use the store's prefix in the QR payload so each label is unique.")
    panel(d, 24, 240, 560, 130, title="Add Store")
    input_box(d, 40, 290, 200, 36, "store code", "PUCHONG", mono=True)
    input_box(d, 250, 290, 250, 36, "name", "Puchong Pharmacy")
    button(d, 510, 290, 60, 36, "+", bg=GRAY_300, fg=WHITE)
    panel(d, 600, 240, W - 624, 130, title="Add Shelf")
    input_box(d, 616, 290, 140, 36, "store", "PUCHONG")
    input_box(d, 762, 290, 130, 36, "shelf code", "A1-01", mono=True)
    input_box(d, 898, 290, 220, 36, "QR payload", "PUCHONG-A1-01", mono=True)
    button(d, 1125, 290, 50, 36, "+")
    highlight_ring(d, 600, 240, W - 624, 130)
    arrow(d, 1140, 410, 1145, 340)
    footer(d, "QR auto-fills as STORE-SHELF if you leave it blank.")
    frames.append(img)

    # Frame 4 — Shelves table, click Expected
    img, d = base_chrome(active_tab_idx=1)
    header(d, 4, "Map the products that belong on this shelf",
           "Click the Expected button on a shelf row to list its SKUs and target qty.")
    panel(d, 24, 240, W - 48, 380, title="Shelves (1)")
    # column headers
    d.text((40, 290), "Store", fill=GRAY_500, font=F_SMALL_B)
    d.text((150, 290), "Shelf", fill=GRAY_500, font=F_SMALL_B)
    d.text((260, 290), "QR payload", fill=GRAY_500, font=F_SMALL_B)
    d.text((520, 290), "Description", fill=GRAY_500, font=F_SMALL_B)
    d.rectangle([40, 310, W - 64, 311], fill=GRAY_200)
    # row
    d.text((40, 326), "PUCHONG", fill=GRAY_900, font=F_MONO)
    d.text((150, 326), "A1-01", fill=GRAY_900, font=F_MONO)
    d.text((260, 326), "PUCHONG-A1-01", fill=GRAY_700, font=F_MONO)
    d.text((520, 326), "Top shelf, aisle 1", fill=GRAY_500, font=F_BODY)
    # Expected button
    bx, by, bw, bh = 940, 320, 110, 30
    button(d, bx, by, bw, bh, "Expected", bg=GRAY_100, fg=GRAY_700, icon="≡")
    # trash
    button(d, 1060, 320, 36, 30, "🗑", bg=GRAY_100, fg=RED)
    highlight_ring(d, bx, by, bw, bh)
    arrow(d, 880, 440, 970, 360)
    footer(d, "Modal opens with SKU + Expected qty inputs.")
    frames.append(img)

    # Frame 5 — modal for Expected SKUs
    img, d = base_chrome(active_tab_idx=1)
    header(d, 5, "Type SKU + expected qty",
           "Repeat until the shelf's product list is complete. Updates are saved instantly.")
    # darken background
    overlay = Image.new("RGBA", (W, H), (15, 23, 42, 110))
    img.paste(Image.alpha_composite(img.convert("RGBA"), overlay).convert("RGB"))
    d = ImageDraw.Draw(img)
    # modal
    mx, my, mw, mh = 220, 200, 760, 380
    d.rounded_rectangle([mx, my, mx + mw, my + mh], radius=10, fill=WHITE)
    d.text((mx + 24, my + 18), "Expected SKUs · A1-01", fill=GRAY_900, font=F_TITLE)
    d.text((mx + 24, my + 60), "QR: PUCHONG-A1-01", fill=GRAY_500, font=F_SMALL)
    # inputs
    input_box(d, mx + 24, my + 100, 380, 36, "SKU", "ABC-001", mono=True)
    input_box(d, mx + 414, my + 100, 180, 36, "expected qty", "10")
    button(d, mx + 604, my + 100, 130, 36, "Add / Update")
    highlight_ring(d, mx + 604, my + 100, 130, 36, color=PRIMARY)
    # existing rows
    panel(d, mx + 24, my + 160, mw - 48, 180)
    d.text((mx + 40, my + 178), "SKU", fill=GRAY_500, font=F_SMALL_B)
    d.text((mx + 500, my + 178), "Expected qty", fill=GRAY_500, font=F_SMALL_B)
    d.rectangle([mx + 40, my + 200, mx + mw - 64, my + 201], fill=GRAY_200)
    d.text((mx + 40, my + 216), "ABC-001", fill=GRAY_900, font=F_MONO)
    d.text((mx + 500, my + 216), "10", fill=GRAY_900, font=F_BODY)
    d.text((mx + 40, my + 244), "XYZ-042", fill=GRAY_900, font=F_MONO)
    d.text((mx + 500, my + 244), "25", fill=GRAY_900, font=F_BODY)
    footer(d, "Print PUCHONG-A1-01 as a QR label, stick it on the shelf. Done.")
    frames.append(img)

    return frames


# ── GIF 2: Scan shelf to count ────────────────────────────────────────────
def gif_scan_count():
    frames = []

    # Frame 1 — Per-shelf Count tab
    img, d = base_chrome(active_tab_idx=4)
    header(d, 1, "Open Per-shelf Count",
           "The form has two new buttons: Scan SKU (camera icon) and Scan Shelf.")
    panel(d, 24, 240, 480, 380, title="Record Physical Count")
    # Scan Shelf button at top right of card
    bx, by, bw, bh = 360, 250, 130, 32
    button(d, bx, by, bw, bh, "Scan Shelf", bg=PURPLE, icon="▦")
    highlight_ring(d, bx, by, bw, bh, color=PURPLE)
    # inputs
    input_box(d, 40, 300, 440, 36, "Counter Name", "Alice")
    input_box(d, 40, 350, 440, 36, "Location")
    input_box(d, 40, 400, 440, 36, "Shelf / Zone (optional)")
    # SKU + camera button
    input_box(d, 40, 450, 380, 36, "SKU (scan or type)", mono=True)
    bx2, by2 = 430, 450
    button(d, bx2, by2, 50, 36, "📷", bg=GRAY_100, fg=GRAY_700)
    highlight_ring(d, bx2, by2, 50, 36, color=PRIMARY)
    input_box(d, 40, 500, 440, 36, "Counted Qty")
    button(d, 40, 550, 440, 44, "+ Add Count")
    # Recent counts panel (right)
    panel(d, 520, 240, W - 544, 380, title="Recent Counts (0 total)")
    arrow(d, 350, 670, 410, 290)
    footer(d, "Big purple button = guided shelf flow. Camera icon = scan a single SKU.")
    frames.append(img)

    # Frame 2 — Tap Scan Shelf → camera opens
    img, d = base_chrome(active_tab_idx=4)
    header(d, 2, "Tap Scan Shelf",
           "Camera opens. Point it at the shelf's QR label.")
    overlay = Image.new("RGBA", (W, H), (15, 23, 42, 130))
    img.paste(Image.alpha_composite(img.convert("RGBA"), overlay).convert("RGB"))
    d = ImageDraw.Draw(img)
    mx, my, mw, mh = 350, 220, 500, 360
    d.rounded_rectangle([mx, my, mx + mw, my + mh], radius=10, fill=WHITE)
    d.text((mx + 24, my + 18), "Scan shelf QR", fill=GRAY_900, font=F_TITLE)
    d.text((mx + 24, my + 56), "Point at the shelf label.", fill=GRAY_500, font=F_BODY)
    # camera viewport mockup
    cx, cy, cw, ch = mx + 80, my + 100, 340, 200
    d.rectangle([cx, cy, cx + cw, cy + ch], fill=GRAY_900)
    # qr box corners
    for (px, py) in [(cx + 40, cy + 30), (cx + cw - 40, cy + 30),
                     (cx + 40, cy + ch - 30), (cx + cw - 40, cy + ch - 30)]:
        d.rectangle([px - 20, py - 4, px + 20, py + 4], fill=PRIMARY)
        d.rectangle([px - 4, py - 20, px + 4, py + 20], fill=PRIMARY)
    d.text((cx + cw / 2 - 40, cy + ch / 2 - 10), "[ scan ]", fill=WHITE, font=F_BODY_B)
    button(d, mx + 200, my + 320, 100, 32, "Cancel", bg=GRAY_100, fg=GRAY_700)
    footer(d, "If your tablet has no camera, the SKU text input + barcode-gun still work.")
    frames.append(img)

    # Frame 3 — Scanned → expected products list opens
    img, d = base_chrome(active_tab_idx=4)
    header(d, 3, "Expected products appear",
           "Sheet shows everything that should be on this shelf, with one-tap qty entry.")
    overlay = Image.new("RGBA", (W, H), (15, 23, 42, 130))
    img.paste(Image.alpha_composite(img.convert("RGBA"), overlay).convert("RGB"))
    d = ImageDraw.Draw(img)
    mx, my, mw, mh = 200, 170, 800, 460
    d.rounded_rectangle([mx, my, mx + mw, my + mh], radius=10, fill=WHITE)
    d.text((mx + 24, my + 18), "Count shelf: PUCHONG / A1-01", fill=GRAY_900, font=F_TITLE)
    d.text((mx + 24, my + 56), "Shelf QR: PUCHONG-A1-01", fill=GRAY_500, font=F_SMALL)
    # table
    panel(d, mx + 24, my + 90, mw - 48, 300)
    d.text((mx + 40, my + 108), "SKU", fill=GRAY_500, font=F_SMALL_B)
    d.text((mx + 520, my + 108), "Expected", fill=GRAY_500, font=F_SMALL_B)
    d.text((mx + 680, my + 108), "Counted", fill=GRAY_500, font=F_SMALL_B)
    d.rectangle([mx + 40, my + 130, mx + mw - 64, my + 131], fill=GRAY_200)
    rows = [("ABC-001", "Paracetamol 500mg", "10", "10"),
            ("XYZ-042", "Vitamin C 1000mg", "25", "24"),
            ("MED-308", "Ibuprofen 200mg", "8", "")]
    for i, (sku, name, exp, got) in enumerate(rows):
        ry = my + 150 + i * 56
        d.text((mx + 40, ry), sku, fill=GRAY_900, font=F_MONO)
        d.text((mx + 40, ry + 20), name, fill=GRAY_500, font=F_SMALL)
        d.text((mx + 520, ry), exp, fill=GRAY_700, font=F_BODY)
        input_box(d, mx + 680, ry - 6, 100, 32, "", got)
    # Add unexpected row
    input_box(d, mx + 24, my + 400, 380, 36, "Unexpected SKU…", mono=True)
    input_box(d, mx + 414, my + 400, 100, 36, "qty")
    button(d, mx + 524, my + 400, 80, 36, "+ Add", bg=GRAY_100, fg=GRAY_700)
    # save
    bx, by = mx + 600, my + 410
    button(d, bx, by, 170, 36, "Save shelf counts")
    highlight_ring(d, bx, by, 170, 36, color=PRIMARY)
    footer(d, "Save writes locally + syncs to Supabase so the second tablet sees it live.")
    frames.append(img)

    return frames


# ── GIF 3: Three-way reconciliation ───────────────────────────────────────
def gif_3way():
    frames = []

    # Frame 1 — switch to Final Summary
    img, d = base_chrome(active_tab_idx=8)
    header(d, 1, "Open Final Summary",
           "Brand-new column: QR vs Bulk — flags when the two physical sources disagree.")
    # KPI strip
    for i, (label, val, c) in enumerate(
            [("Total SKUs", "143", GRAY_900),
             ("Matched", "118", GREEN_HI),
             ("Variance", "12", RED_HI),
             ("Unregistered", "3", YELLOW_HI),
             ("Not Counted", "10", GRAY_600)]):
        x = 24 + i * 220
        bg = WHITE
        if label == "Matched": bg = GREEN_BG
        if label == "Variance": bg = RED_BG
        if label == "Unregistered": bg = YELLOW_BG
        if label == "Not Counted": bg = GRAY_100
        d.rounded_rectangle([x, 230, x + 200, 310], radius=8, fill=bg)
        d.text((x + 14, 240), label, fill=GRAY_600, font=F_SMALL_B)
        d.text((x + 14, 264), val, fill=c, font=_font(32, bold=True))
    # Table header
    panel(d, 24, 330, W - 48, 320, title="Per-SKU reconciliation")
    hx = 40
    cols = [("SKU", 110), ("System", 80), ("QR", 60), ("Bulk", 60),
            ("Phys Used", 90), ("Variance", 80), ("QR vs Bulk", 110),
            ("Source", 80), ("Status", 90)]
    cur = hx
    for label, w in cols:
        d.text((cur, 380), label, fill=GRAY_500, font=F_SMALL_B)
        cur += w
    d.rectangle([hx, 402, W - 64, 403], fill=GRAY_200)
    # Rows
    rows = [("ABC-001", 120, 122, 120, 122, "+2", "+2", "qr+bulk", "Match",  False),
            ("XYZ-042", 80, 78, 80, 78,  "-2",  "-2", "qr+bulk", "Recount", False),
            ("MED-308", 50, 55, 48, 55,  "+5",  "+7", "qr+bulk", "Recount", True),
            ("VIT-009", 200, 200, 200, 200, "0", "0", "qr+bulk", "Match", False)]
    for i, (sku, sys, qr, bulk, used, var, qvb, src, status, disagree) in enumerate(rows):
        ry = 420 + i * 50
        if disagree:
            d.rectangle([hx - 4, ry - 4, W - 60, ry + 36], fill=ORANGE_BG)
        cur = hx
        for v, w in zip([sku, str(sys), str(qr), str(bulk), str(used), var, qvb, src],
                        [c[1] for c in cols[:-1]]):
            col = GRAY_900
            if v == var and var != "0":
                col = GREEN_HI if var.startswith("+") else RED_HI
            if v == qvb and disagree:
                col = ORANGE_HI
            f = F_MONO if cur == hx else F_BODY
            d.text((cur, ry + 4), v, fill=col,
                   font=F_BODY_B if (v == qvb and disagree) else f)
            cur += w
        # Status pill
        if status == "Match":
            status_pill(d, cur, ry, "Match", GREEN_BG, GREEN_HI)
        else:
            status_pill(d, cur, ry, "Recount", RED_BG, RED_HI)
        if disagree:
            d.text((cur + 290, ry + 4), "⚠", fill=ORANGE_HI, font=F_BODY_B)
    # Highlight the QR vs Bulk column header
    qvb_col_x = hx + sum(w for _, w in cols[:6])
    highlight_ring(d, qvb_col_x - 4, 376, 110, 22, color=ORANGE)
    arrow(d, qvb_col_x + 55, 350, qvb_col_x + 55, 380, color=ORANGE)
    footer(d, "The orange row + ⚠ marks SKUs where QR and Bulk Excel disagree beyond tolerance.")
    frames.append(img)

    # Frame 2 — explain orange row
    img, d = base_chrome(active_tab_idx=8)
    header(d, 2, "Why MED-308 is flagged",
           "QR scanned 55 but Bulk Excel says 48 — even though the variance vs System looks OK.")
    panel(d, 24, 240, W - 48, 280, title="MED-308 — Ibuprofen 200mg")
    rows2 = [("System Total",  "50", GRAY_900),
             ("QR scans (live)", "55", BLUE),
             ("Bulk Excel upload", "48", BLUE),
             ("QR vs System variance", "+5", GREEN_HI),
             ("Bulk vs System variance", "-2", RED_HI),
             ("QR vs Bulk disagreement", "+7  ⚠", ORANGE_HI)]
    for i, (k, v, c) in enumerate(rows2):
        ry = 300 + i * 32
        d.text((48, ry), k, fill=GRAY_700, font=F_BODY)
        d.text((520, ry), v, fill=c, font=F_BODY_B)
    panel(d, 24, 540, W - 48, 110, title=None)
    d.text((40, 558),
           "Before this release: QR silently overrode Bulk so the disagreement was invisible.",
           fill=GRAY_700, font=F_BODY)
    d.text((40, 590),
           "Now: a reason input shows up in the row so you can capture WHY (theft? mis-scan?).",
           fill=GRAY_700, font=F_BODY)
    footer(d, "Export to CSV/XLSX — the new column ships with it.")
    frames.append(img)

    return frames


# ── GIF 4: Accept variances ───────────────────────────────────────────────
def gif_accept_variances():
    frames = []

    # Frame 1 — Reconciliation tab, point to Accept Variances button
    img, d = base_chrome(active_tab_idx=6)
    header(d, 1, "Reconciliation tab",
           "Same buttons as before, plus a new purple Accept Variances.")
    panel(d, 24, 240, W - 48, 100)
    # Tolerance row
    d.text((40, 256), "Tolerance (± units):", fill=GRAY_700, font=F_BODY_B)
    input_box(d, 220, 248, 80, 32, "", "0")
    button(d, 308, 248, 70, 32, "Apply")
    d.text((388, 256), "Strict — any variance requires recount.", fill=GRAY_500, font=F_SMALL)
    # Right-side buttons
    bx0 = 700
    button(d, bx0, 248, 80, 32, "CSV", bg=GRAY_100, fg=GRAY_700)
    button(d, bx0 + 88, 248, 80, 32, "XLSX", bg=GRAY_100, fg=GRAY_700)
    button(d, bx0 + 176, 248, 150, 32, "Adjustment File")
    bx, by, bw, bh = bx0 + 332, 248, 180, 32
    button(d, bx, by, bw, bh, "Accept Variances", bg=PURPLE)
    highlight_ring(d, bx, by, bw, bh, color=PURPLE)
    arrow(d, 1080, 380, 1080, 290, color=PURPLE)
    panel(d, 24, 360, W - 48, 290, title="Per-shelf variance")
    d.text((40, 410), "(Per-shelf rows — Location, SKU, Physical, System, Variance, Status…)",
           fill=GRAY_500, font=F_BODY)
    footer(d, "New button rewrites System Stock so counted qty becomes the next baseline.")
    frames.append(img)

    # Frame 2 — confirm dialog
    img, d = base_chrome(active_tab_idx=6)
    header(d, 2, "Confirm dialog",
           "Tells you exactly how many (Location, SKU) rows will be rewritten.")
    overlay = Image.new("RGBA", (W, H), (15, 23, 42, 130))
    img.paste(Image.alpha_composite(img.convert("RGBA"), overlay).convert("RGB"))
    d = ImageDraw.Draw(img)
    mx, my, mw, mh = 320, 240, 560, 240
    d.rounded_rectangle([mx, my, mx + mw, my + mh], radius=10, fill=WHITE)
    d.text((mx + 24, my + 18), "Confirm baseline rewrite",
           fill=GRAY_900, font=F_TITLE)
    body = ("Rewrite System Stock for 12 (Location, SKU) row(s)\n"
            "using counted physical quantities?\n\n"
            "Only mutates this session's record locally.\n"
            "Adjustment File still lets you sync back to your ERP.")
    for i, line in enumerate(body.split("\n")):
        d.text((mx + 24, my + 70 + i * 22), line, fill=GRAY_700, font=F_BODY)
    button(d, mx + mw - 220, my + mh - 56, 90, 36, "Cancel", bg=GRAY_100, fg=GRAY_700)
    bx, by = mx + mw - 120, my + mh - 56
    button(d, bx, by, 100, 36, "OK", bg=PURPLE)
    highlight_ring(d, bx, by, 100, 36, color=PURPLE)
    footer(d, "After OK: System Stock is updated for this session. Reconciliation refreshes.")
    frames.append(img)

    # Frame 3 — success state
    img, d = base_chrome(active_tab_idx=6)
    header(d, 3, "Done — variances accepted",
           "12 rows updated. The next reconciliation runs against the new baseline.")
    # toast
    tx, ty, tw, th = W - 360, 120, 320, 50
    d.rounded_rectangle([tx, ty, tx + tw, ty + th], radius=8, fill=GREEN_HI)
    d.text((tx + 14, ty + 14), "✓ Updated System Stock for 12 row(s).",
           fill=WHITE, font=F_BODY_B)
    panel(d, 24, 240, W - 48, 410, title="Per-shelf variance")
    # show fewer red rows
    d.text((40, 290), "Status", fill=GRAY_500, font=F_SMALL_B)
    for i in range(6):
        ry = 320 + i * 50
        status_pill(d, 40, ry, "Match", GREEN_BG, GREEN_HI)
        d.text((130, ry + 3), f"PUCHONG / SKU-{1001+i}", fill=GRAY_900, font=F_MONO)
        d.text((520, ry + 3), "Variance: 0", fill=GRAY_500, font=F_BODY)
    footer(d, "Run the Adjustment File export to sync the same change back to your ERP.")
    frames.append(img)

    return frames


# ── GIF 5: Staff daily workflow (Level 15) ────────────────────────────────
# Login → restricted sidebar → Stock Take with 3 sub-tabs → scan + count → save
def gif_staff_daily():
    frames = []

    # Frame 1 — login screen
    img, d = new_frame()
    header(d, 1, "Open destinoraclessolution.com",
           "Each store gets its own login. Today: the 001-Wisma account.")
    # centered login card
    cx, cy, cw, ch = (W - 460) // 2, 220, 460, 380
    d.rounded_rectangle([cx, cy, cx + cw, cy + ch], radius=12, fill=WHITE, outline=GRAY_200)
    d.text((cx + 24, cy + 24), "悅客匯 CRM", fill=PRIMARY, font=F_CJK_TITLE)
    d.text((cx + 24, cy + 64), "Sign in to continue", fill=GRAY_500, font=F_BODY)
    d.text((cx + 24, cy + 110), "Email", fill=GRAY_700, font=F_SMALL_B)
    input_box(d, cx + 24, cy + 134, cw - 48, 40, "", "001-wisma@destinoraclessolution.com")
    d.text((cx + 24, cy + 192), "Password", fill=GRAY_700, font=F_SMALL_B)
    input_box(d, cx + 24, cy + 216, cw - 48, 40, "", "••••••••••••")
    button(d, cx + 24, cy + 280, cw - 48, 48, "Sign in")
    highlight_ring(d, cx + 24, cy + 280, cw - 48, 48)
    footer(d, "Same URL as the admin uses. Auth picks the right role based on the email.")
    frames.append(img)

    # Frame 2 — signed in, restricted sidebar
    img, d = new_frame()
    header(d, 2, "Only Stock Take in the sidebar",
           "Level 15 staff can't see Calendar, Prospects, Reports — only the one tab they need.")
    # Sidebar
    d.rectangle([0, 90, 260, H], fill=WHITE, outline=GRAY_200)
    d.rounded_rectangle([16, 104, 244, 144], radius=8, fill=PRIMARY)
    d.text((30, 116), "悅", fill=WHITE, font=F_CJK_TITLE)
    d.text((70, 118), "悅客匯", fill=WHITE, font=_font(18, bold=True, cjk=True))
    # Highlighted nav row
    nx, ny, nw, nh = 14, 170, 232, 44
    d.rounded_rectangle([nx, ny, nx + nw, ny + nh], radius=8, fill=(254, 226, 245))
    d.text((nx + 18, ny + 12), "📦  Stock Take", fill=PRIMARY, font=F_BODY_B)
    highlight_ring(d, nx, ny, nw, nh, color=PRIMARY)
    # User chip top right
    d.rounded_rectangle([W - 240, 100, W - 24, 144], radius=22, fill=WHITE, outline=GRAY_200)
    d.rounded_rectangle([W - 232, 108, W - 200, 140], radius=16, fill=PRIMARY)
    d.text((W - 226, 116), "01", fill=WHITE, font=F_SMALL_B)
    d.text((W - 188, 110), "001 Wisma", fill=GRAY_900, font=F_BODY_B)
    d.text((W - 188, 128), "Stock Take Staff", fill=GRAY_500, font=F_SMALL)
    # Main area — empty welcome
    d.text((300, 200), "Welcome, 001 Wisma", fill=GRAY_900, font=F_TITLE)
    d.text((300, 240), "Tap Stock Take on the left to start counting.", fill=GRAY_600, font=F_BODY)
    arrow(d, 300, 220, 245, 192)
    footer(d, "Notice: no Calendar, no Prospects, no Reports — your account is locked to one job.")
    frames.append(img)

    # Frame 3 — inside Stock Take, only 3 sub-tabs
    img, d = new_frame()
    header(d, 3, "Three tabs only — Count, Recount, Final Summary",
           "You land on Per-shelf Count automatically. No setup tabs to worry about.")
    d.text((24, 100), "Stock Take", fill=GRAY_900, font=F_TITLE)
    d.text((24, 138), "Shelf-by-shelf physical count reconciliation", fill=GRAY_600, font=F_BODY)
    # restricted tab row
    tabs = ["Per-shelf Count", "Recount", "Final Summary"]
    tab_row(d, 24, 180, tabs, 0)
    # Form preview
    panel(d, 24, 250, 480, 380, title="Record Physical Count")
    bx, by, bw, bh = 360, 260, 130, 32
    button(d, bx, by, bw, bh, "Scan Shelf", bg=PURPLE, icon="▦")
    highlight_ring(d, bx, by, bw, bh, color=PURPLE)
    input_box(d, 40, 310, 440, 36, "Counter Name", "Alice")
    input_box(d, 40, 360, 380, 36, "SKU (scan or type)", mono=True)
    button(d, 430, 360, 50, 36, "📷", bg=GRAY_100, fg=GRAY_700)
    input_box(d, 40, 410, 440, 36, "Counted Qty")
    button(d, 40, 460, 440, 44, "+ Add Count")
    # Recent counts panel (right)
    panel(d, 520, 250, W - 544, 380, title="Recent Counts (0 total)")
    d.text((540, 320), "Counts you record show up here, with",
           fill=GRAY_500, font=F_BODY)
    d.text((540, 344), "live updates from the other store tablet.",
           fill=GRAY_500, font=F_BODY)
    footer(d, "Big purple button = scan a shelf QR and see what should be on it.")
    frames.append(img)

    # Frame 4 — Scan camera on
    img, d = new_frame()
    header(d, 4, "Tap Scan Shelf, point at the QR label",
           "Camera turns on inside a modal. The PUCHONG-A1-01 label is on every shelf.")
    overlay = Image.new("RGBA", (W, H), (15, 23, 42, 130))
    img.paste(Image.alpha_composite(img.convert("RGBA"), overlay).convert("RGB"))
    d = ImageDraw.Draw(img)
    mx, my, mw, mh = 380, 200, 440, 380
    d.rounded_rectangle([mx, my, mx + mw, my + mh], radius=10, fill=WHITE)
    d.text((mx + 24, my + 18), "Scan shelf QR", fill=GRAY_900, font=F_TITLE)
    d.text((mx + 24, my + 56), "Point at the shelf label.", fill=GRAY_500, font=F_BODY)
    cx, cy, cw, ch = mx + 60, my + 100, 320, 220
    d.rectangle([cx, cy, cx + cw, cy + ch], fill=GRAY_900)
    # QR corner markers
    cs = 6
    for (px, py) in [(cx + 30, cy + 30), (cx + cw - 30, cy + 30),
                     (cx + 30, cy + ch - 30), (cx + cw - 30, cy + ch - 30)]:
        d.rectangle([px - 22, py - cs, px + 22, py + cs], fill=PRIMARY)
        d.rectangle([px - cs, py - 22, px + cs, py + 22], fill=PRIMARY)
    d.text((cx + 100, cy + ch // 2 - 6), "PUCHONG-A1-01", fill=WHITE, font=F_MONO)
    button(d, mx + (mw - 100) // 2, my + 340, 100, 32, "Cancel",
           bg=GRAY_100, fg=GRAY_700)
    footer(d, "If the tablet has no camera you can also type the QR text into the SKU field.")
    frames.append(img)

    # Frame 5 — Expected products list opens
    img, d = new_frame()
    header(d, 5, "Expected products appear",
           "Type the actual count next to each SKU. Unexpected items can be added below.")
    overlay = Image.new("RGBA", (W, H), (15, 23, 42, 130))
    img.paste(Image.alpha_composite(img.convert("RGBA"), overlay).convert("RGB"))
    d = ImageDraw.Draw(img)
    mx, my, mw, mh = 180, 130, 840, 540
    d.rounded_rectangle([mx, my, mx + mw, my + mh], radius=10, fill=WHITE)
    d.text((mx + 24, my + 18), "Count shelf: PUCHONG / A1-01", fill=GRAY_900, font=F_TITLE)
    d.text((mx + 24, my + 56), "Shelf QR: PUCHONG-A1-01", fill=GRAY_500, font=F_SMALL)
    # table header
    panel(d, mx + 24, my + 88, mw - 48, 340)
    d.text((mx + 40, my + 108), "SKU", fill=GRAY_500, font=F_SMALL_B)
    d.text((mx + 520, my + 108), "Expected", fill=GRAY_500, font=F_SMALL_B)
    d.text((mx + 680, my + 108), "Counted", fill=GRAY_500, font=F_SMALL_B)
    d.rectangle([mx + 40, my + 130, mx + mw - 64, my + 131], fill=GRAY_200)
    rows = [("ABC-001", "Paracetamol 500mg", "10", "10"),
            ("XYZ-042", "Vitamin C 1000mg",  "25", "24"),
            ("MED-308", "Ibuprofen 200mg",    "8",  "8"),
            ("VIT-009", "Vit B complex",     "12", "")]
    for i, (sku, name, exp, got) in enumerate(rows):
        ry = my + 150 + i * 56
        d.text((mx + 40, ry), sku, fill=GRAY_900, font=F_MONO)
        d.text((mx + 40, ry + 20), name, fill=GRAY_500, font=F_SMALL)
        d.text((mx + 520, ry), exp, fill=GRAY_700, font=F_BODY)
        input_box(d, mx + 680, ry - 6, 100, 32, "", got)
    # highlight active input
    highlight_ring(d, mx + 680, my + 150 + 3 * 56 - 6, 100, 32, color=PRIMARY)
    # Unexpected row at bottom of modal
    input_box(d, mx + 24, my + 440, 380, 36, "Unexpected SKU…", mono=True)
    input_box(d, mx + 414, my + 440, 100, 36, "qty")
    button(d, mx + 524, my + 440, 80, 36, "+ Add", bg=GRAY_100, fg=GRAY_700)
    button(d, mx + mw - 200, my + 446, 170, 40, "Save shelf counts")
    footer(d, "Found a SKU not on the list? Use the Unexpected row — it gets flagged for the admin.")
    frames.append(img)

    # Frame 6 — Save → toast
    img, d = new_frame()
    header(d, 6, "Save — toast confirms",
           "Counts hit your tablet AND the admin's reconciliation in real time.")
    # tabs again
    d.text((24, 100), "Stock Take", fill=GRAY_900, font=F_TITLE)
    tab_row(d, 24, 180, ["Per-shelf Count", "Recount", "Final Summary"], 0)
    # Toast top-right
    tx, ty, tw, th = W - 360, 110, 320, 50
    d.rounded_rectangle([tx, ty, tx + tw, ty + th], radius=8, fill=GREEN_HI)
    d.text((tx + 14, ty + 14), "✓ +4 count(s) on PUCHONG / A1-01",
           fill=WHITE, font=F_BODY_B)
    # Form (cleared)
    panel(d, 24, 250, 480, 380, title="Record Physical Count")
    bx, by, bw, bh = 360, 260, 130, 32
    button(d, bx, by, bw, bh, "Scan Shelf", bg=PURPLE, icon="▦")
    input_box(d, 40, 310, 440, 36, "Counter Name", "Alice")
    input_box(d, 40, 360, 380, 36, "SKU (scan or type)", mono=True)
    button(d, 430, 360, 50, 36, "📷", bg=GRAY_100, fg=GRAY_700)
    input_box(d, 40, 410, 440, 36, "Counted Qty")
    button(d, 40, 460, 440, 44, "+ Add Count")
    # Recent counts panel showing 4 rows just added
    panel(d, 520, 250, W - 544, 380, title="Recent Counts (4 total)")
    d.text((540, 290), "When         Who    Location          SKU         Qty",
           fill=GRAY_500, font=F_SMALL_B)
    for i, (t, sku, q) in enumerate([("12:48", "ABC-001", 10), ("12:49", "XYZ-042", 24),
                                      ("12:50", "MED-308", 8), ("12:50", "VIT-009", 12)]):
        ry = 320 + i * 32
        d.text((540, ry), f"{t}  Alice  PUCHONG/A1-01  {sku}      {q}",
               fill=GRAY_900, font=F_MONO)
    footer(d, "Move to the next shelf, scan its QR, repeat. That's the whole job.")
    frames.append(img)

    return frames


# ── GIF 6: Admin session lifecycle ────────────────────────────────────────
def gif_admin_lifecycle():
    frames = []

    # Frame 1 — Sessions tab, open a new session
    img, d = base_chrome(active_tab_idx=0)
    header(d, 1, "Open the day's session",
           "From the admin account, Sessions tab → New Session.")
    panel(d, 24, 240, W - 48, 410, title="Stock Take Sessions")
    # session table
    d.text((40, 290), "Session ID", fill=GRAY_500, font=F_SMALL_B)
    d.text((300, 290), "Created", fill=GRAY_500, font=F_SMALL_B)
    d.text((500, 290), "Locations", fill=GRAY_500, font=F_SMALL_B)
    d.text((800, 290), "Status", fill=GRAY_500, font=F_SMALL_B)
    d.rectangle([40, 310, W - 64, 311], fill=GRAY_200)
    # Empty hint
    d.text((40, 340), "(No open session yet — click New Session.)",
           fill=GRAY_500, font=F_BODY)
    # New Session button top right
    bx, by, bw, bh = W - 240, 252, 200, 38
    button(d, bx, by, bw, bh, "+ New Session")
    highlight_ring(d, bx, by, bw, bh)
    arrow(d, 1080, 200, 1080, 248)
    footer(d, "The session id (e.g. ST_20260530) is what staff devices join.")
    frames.append(img)

    # Frame 2 — Modal: enter session details
    img, d = base_chrome(active_tab_idx=0)
    header(d, 2, "Name the session, list locations",
           "Locations go one per line. Staff will join via shelf QR — these are for filters.")
    overlay = Image.new("RGBA", (W, H), (15, 23, 42, 130))
    img.paste(Image.alpha_composite(img.convert("RGBA"), overlay).convert("RGB"))
    d = ImageDraw.Draw(img)
    mx, my, mw, mh = 320, 200, 560, 340
    d.rounded_rectangle([mx, my, mx + mw, my + mh], radius=10, fill=WHITE)
    d.text((mx + 24, my + 18), "New Stock Take Session", fill=GRAY_900, font=F_TITLE)
    d.text((mx + 24, my + 64), "Session ID", fill=GRAY_700, font=F_SMALL_B)
    input_box(d, mx + 24, my + 86, mw - 48, 40, "", "ST_20260530", mono=True)
    d.text((mx + 24, my + 144), "Locations (one per line)", fill=GRAY_700, font=F_SMALL_B)
    # textarea
    d.rounded_rectangle([mx + 24, my + 166, mx + mw - 24, my + 270], radius=6,
                        fill=WHITE, outline=GRAY_300)
    for i, loc in enumerate(["001 Wisma", "002 BayAvenue", "003 BJPavillion"]):
        d.text((mx + 36, my + 178 + i * 26), loc, fill=GRAY_900, font=F_BODY)
    button(d, mx + mw - 220, my + mh - 56, 90, 36, "Cancel", bg=GRAY_100, fg=GRAY_700)
    bx, by = mx + mw - 120, my + mh - 56
    button(d, bx, by, 100, 36, "Create")
    highlight_ring(d, bx, by, 100, 36)
    footer(d, "Create writes locally AND inserts an st_sessions row in Supabase for staff to join.")
    frames.append(img)

    # Frame 3 — Per-shelf Count tab, live counts arriving
    img, d = base_chrome(active_tab_idx=4)
    header(d, 3, "Counts arrive live from store tablets",
           "Sub-tab: Per-shelf Count. Each row tagged with where it came from.")
    panel(d, 24, 250, 460, 380, title="Record Physical Count")
    button(d, 350, 260, 120, 32, "Scan Shelf", bg=PURPLE)
    input_box(d, 40, 310, 420, 36, "Counter Name", "Admin")
    input_box(d, 40, 360, 420, 36, "SKU (scan or type)", mono=True)
    input_box(d, 40, 410, 420, 36, "Counted Qty")
    button(d, 40, 460, 420, 40, "+ Add Count")
    panel(d, 500, 250, W - 524, 380, title="Recent Counts (12 total)")
    d.text((520, 290), "When   Who              Location          SKU       Qty",
           fill=GRAY_500, font=F_SMALL_B)
    recent = [("12:48", "Alice (001)", "001 Wisma",      "ABC-001", 10, True),
              ("12:49", "Alice (001)", "001 Wisma",      "XYZ-042", 24, True),
              ("12:51", "Bob (002)",   "002 BayAvenue",  "ABC-001", 8,  True),
              ("12:52", "Bob (002)",   "002 BayAvenue",  "MED-308", 7,  True),
              ("12:53", "You",         "002 BayAvenue",  "VIT-009", 12, False),
              ("12:54", "Carol (003)", "003 BJPavillion","ABC-001", 12, True)]
    for i, (t, who, loc, sku, q, remote) in enumerate(recent):
        ry = 320 + i * 32
        d.text((520, ry), f"{t}  {who:<14} {loc:<17} {sku}    {q}",
               fill=GRAY_900, font=F_MONO)
        if remote:
            d.rounded_rectangle([1160, ry - 2, 1200, ry + 18], radius=4, fill=BLUE_BG)
            d.text((1165, ry + 1), "live", fill=BLUE, font=F_TINY)
    footer(d, "Blue 'live' badge = came from another tablet via Supabase realtime.")
    frames.append(img)

    # Frame 4 — Reconciliation tab
    img, d = base_chrome(active_tab_idx=6)
    header(d, 4, "Reconciliation tab — see the variance",
           "Aggregates every Location+SKU pair, flags rows beyond tolerance.")
    # KPI strip
    for i, (label, val, c) in enumerate(
            [("Total SKUs", "143", GRAY_900),
             ("Matched", "118", GREEN_HI),
             ("Recount Required", "12", RED_HI),
             ("Inventory Accuracy", "82.5%", YELLOW_HI)]):
        x = 24 + i * 290
        bg = WHITE
        if label == "Matched": bg = GREEN_BG
        if label == "Recount Required": bg = RED_BG
        if label == "Inventory Accuracy": bg = YELLOW_BG
        d.rounded_rectangle([x, 230, x + 270, 310], radius=8, fill=bg)
        d.text((x + 14, 240), label, fill=GRAY_600, font=F_SMALL_B)
        d.text((x + 14, 264), val, fill=c, font=_font(32, bold=True))
    # Tolerance + buttons row
    panel(d, 24, 330, W - 48, 80)
    d.text((40, 348), "Tolerance (± units):", fill=GRAY_700, font=F_BODY_B)
    input_box(d, 220, 342, 80, 32, "", "0")
    button(d, 308, 342, 70, 32, "Apply")
    button(d, 700, 342, 80, 32, "CSV", bg=GRAY_100, fg=GRAY_700)
    button(d, 788, 342, 80, 32, "XLSX", bg=GRAY_100, fg=GRAY_700)
    button(d, 876, 342, 150, 32, "Adjustment File")
    bx, by, bw, bh = 1032, 342, 150, 32
    button(d, bx, by, bw, bh, "Accept Variances", bg=PURPLE)
    highlight_ring(d, bx, by, bw, bh, color=PURPLE)
    # rows panel teaser
    panel(d, 24, 430, W - 48, 220, title="Per-shelf variance (12 rows need attention)")
    rows = [("001 Wisma",   "MED-308", "8",  "10", "-2"),
            ("002 BayAv",   "ABC-001", "12", "10", "+2"),
            ("003 BJPav",   "MED-308", "7",  "10", "-3")]
    for i, (loc, sku, phys, sys, var) in enumerate(rows):
        ry = 470 + i * 34
        d.text((40, ry), loc, fill=GRAY_900, font=F_BODY)
        d.text((240, ry), sku, fill=GRAY_900, font=F_MONO)
        d.text((420, ry), phys, fill=GRAY_700, font=F_BODY)
        d.text((520, ry), sys, fill=GRAY_700, font=F_BODY)
        col = GREEN_HI if var.startswith("+") else RED_HI
        d.text((620, ry), var, fill=col, font=F_BODY_B)
        status_pill(d, 800, ry - 2, "Recount", RED_BG, RED_HI)
    footer(d, "Click Accept Variances to use counted qty as the new baseline for next session.")
    frames.append(img)

    # Frame 5 — Close session
    img, d = base_chrome(active_tab_idx=0)
    header(d, 5, "Close the session when done",
           "Sessions tab → Close. The session goes read-only and historical reports lock in.")
    panel(d, 24, 240, W - 48, 410, title="Stock Take Sessions")
    d.text((40, 290), "Session ID", fill=GRAY_500, font=F_SMALL_B)
    d.text((300, 290), "Created", fill=GRAY_500, font=F_SMALL_B)
    d.text((500, 290), "QR Counts", fill=GRAY_500, font=F_SMALL_B)
    d.text((620, 290), "Status", fill=GRAY_500, font=F_SMALL_B)
    d.text((820, 290), "Actions", fill=GRAY_500, font=F_SMALL_B)
    d.rectangle([40, 310, W - 64, 311], fill=GRAY_200)
    # row
    ry = 332
    d.text((40, ry), "ST_20260530", fill=GRAY_900, font=F_MONO)
    d.text((300, ry), "2026-05-30 12:30", fill=GRAY_700, font=F_BODY)
    d.text((500, ry), "143", fill=GRAY_900, font=F_BODY_B)
    status_pill(d, 620, ry - 2, "● open", GREEN_BG, GREEN_HI)
    button(d, 820, ry - 4, 90, 28, "Activate", bg=GRAY_100, fg=GRAY_700)
    bx, by, bw, bh = 920, ry - 4, 70, 28
    button(d, bx, by, bw, bh, "Close")
    highlight_ring(d, bx, by, bw, bh)
    footer(d, "Closed sessions stay forever — reopen any time to view the report.")
    frames.append(img)

    return frames


def save_gif(frames, name):
    """Save a list of PIL Images as an animated GIF."""
    path = OUT / name
    # Convert all to P mode with adaptive palette for smaller file
    converted = []
    for f in frames:
        cf = f.convert("P", palette=Image.ADAPTIVE, colors=256)
        converted.append(cf)
    converted[0].save(
        path,
        save_all=True,
        append_images=converted[1:],
        duration=FRAME_MS,
        loop=0,
        optimize=True,
        disposal=2,
    )
    print(f"wrote {path}  ({path.stat().st_size//1024} KB, {len(frames)} frames)")


def main():
    save_gif(gif_shelves(),          "01-shelf-master-setup.gif")
    save_gif(gif_scan_count(),       "02-scan-shelf-to-count.gif")
    save_gif(gif_3way(),             "03-three-way-reconciliation.gif")
    save_gif(gif_accept_variances(), "04-accept-variances.gif")
    save_gif(gif_staff_daily(),      "05-staff-daily-workflow.gif")
    save_gif(gif_admin_lifecycle(),  "06-admin-session-lifecycle.gif")


if __name__ == "__main__":
    main()
