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
    save_gif(gif_shelves(),         "01-shelf-master-setup.gif")
    save_gif(gif_scan_count(),      "02-scan-shelf-to-count.gif")
    save_gif(gif_3way(),            "03-three-way-reconciliation.gif")
    save_gif(gif_accept_variances(), "04-accept-variances.gif")


if __name__ == "__main__":
    main()
