"""Generate auxiliary DNJ launch assets in gold/black brand:
- Day 2 quote card (1080x1350)
- 5 highlight cover icons (1080x1080)
"""
import os
from PIL import Image, ImageDraw, ImageFont

OUT_DIR = r"C:\Users\DC\Desktop\DestinOraclesSolution CRM\marketing\instagram\launch"
HIGHLIGHT_DIR = os.path.join(OUT_DIR, "highlight-covers")
os.makedirs(HIGHLIGHT_DIR, exist_ok=True)

BLACK = (10, 10, 12)
DEEP_BLACK = (0, 0, 0)
GOLD = (212, 175, 55)
GOLD_LIGHT = (244, 208, 100)
WHITE = (255, 255, 255)
OFFWHITE = (240, 235, 220)

FONT_HEAD = r"C:\Windows\Fonts\ariblk.ttf"
FONT_BODY = r"C:\Windows\Fonts\arialbd.ttf"
FONT_SERIF = r"C:\Windows\Fonts\timesbd.ttf"


def fit_font_size(lines, max_font_size, max_width, font_path=FONT_HEAD):
    size = max_font_size
    img = Image.new("RGB", (10, 10))
    drw = ImageDraw.Draw(img)
    while size > 20:
        font = ImageFont.truetype(font_path, size)
        widest = max(drw.textbbox((0, 0), line, font=font)[2] for line in lines)
        if widest <= max_width:
            return size
        size -= 4
    return size


def gradient_bg(w, h):
    img = Image.new("RGB", (w, h), BLACK)
    drw = ImageDraw.Draw(img)
    for i in range(h):
        t = i / (h - 1)
        r = int(BLACK[0] * (1 - t) + DEEP_BLACK[0] * t)
        g = int(BLACK[1] * (1 - t) + DEEP_BLACK[1] * t)
        b = int(BLACK[2] * (1 - t) + DEEP_BLACK[2] * t)
        drw.line([(0, i), (w, i)], fill=(r, g, b))
    return img


def draw_diamond(draw, cx, cy, size, color, line_width=4):
    points = [
        (cx, cy - size),
        (cx + size * 0.85, cy),
        (cx, cy + size),
        (cx - size * 0.85, cy),
    ]
    for i in range(len(points)):
        a = points[i]
        b = points[(i + 1) % len(points)]
        draw.line([a, b], fill=color, width=line_width)
    draw.line([(cx - size * 0.85, cy), (cx + size * 0.85, cy)], fill=color, width=max(2, line_width // 2))
    draw.line([(cx, cy - size), (cx, cy + size)], fill=color, width=max(2, line_width // 2))


def draw_solid_diamond(draw, cx, cy, size, color):
    points = [
        (cx, cy - size),
        (cx + size * 0.85, cy),
        (cx, cy + size),
        (cx - size * 0.85, cy),
    ]
    draw.polygon(points, fill=color)


# ---------- Day 2 Quote Card (1080x1350) ----------
def day2_quote_card():
    W, H = 1080, 1350
    img = gradient_bg(W, H)
    draw = ImageDraw.Draw(img)
    # Gold border frame
    draw.rectangle([40, 40, W - 40, H - 40], outline=GOLD, width=3)
    # Opening quote mark (large serif gold)
    quote_font = ImageFont.truetype(FONT_SERIF, 220)
    draw.text((90, 100), "“", fill=GOLD, font=quote_font)
    # Main quote text
    lines = ["MOST INTERVIEWS", "TEST CONFIDENCE.", "NOT CAPABILITY."]
    size = fit_font_size(lines, 100, W - 160, font_path=FONT_HEAD)
    head = ImageFont.truetype(FONT_HEAD, size)
    line_step = int(size * 1.15)
    total = line_step * (len(lines) - 1) + size
    start_y = (H - total) / 2 - 40
    for i, line in enumerate(lines):
        bbox = draw.textbbox((0, 0), line, font=head)
        text_w = bbox[2] - bbox[0]
        x = (W - text_w) / 2 - bbox[0]
        y = start_y + i * line_step
        # "NOT CAPABILITY." in gold
        color = GOLD if i == 2 else OFFWHITE
        draw.text((x, y), line, fill=color, font=head)
    # Closing quote mark
    closing = "”"
    bbox = draw.textbbox((0, 0), closing, font=quote_font)
    draw.text((W - 90 - (bbox[2] - bbox[0]), H - 320), closing, fill=GOLD, font=quote_font)
    # Diamond bottom
    draw_diamond(draw, W // 2, H - 200, 32, GOLD, line_width=3)
    # Brand mark
    brand_font = ImageFont.truetype(FONT_HEAD, 42)
    text = "D&J"
    bbox = draw.textbbox((0, 0), text, font=brand_font)
    x = (W - (bbox[2] - bbox[0])) / 2 - bbox[0]
    draw.text((x, H - 130), text, fill=GOLD, font=brand_font)
    # URL micro
    url_font = ImageFont.truetype(FONT_BODY, 22)
    url = "diamondandjeweler.com"
    bbox = draw.textbbox((0, 0), url, font=url_font)
    x = (W - (bbox[2] - bbox[0])) / 2 - bbox[0]
    draw.text((x, H - 75), url, fill=OFFWHITE, font=url_font)
    img.save(os.path.join(OUT_DIR, "day2-quote-card.png"), "PNG", optimize=True)


# ---------- Highlight Covers (1080x1080) ----------
def highlight_cover(name, label, icon_fn):
    W, H = 1080, 1080
    img = Image.new("RGB", (W, H), DEEP_BLACK)
    draw = ImageDraw.Draw(img)
    # Outer gold ring
    draw.ellipse([60, 60, W - 60, H - 60], outline=GOLD, width=6)
    # Icon
    icon_fn(draw, W // 2, H // 2 - 60)
    # Label
    font = ImageFont.truetype(FONT_HEAD, 70)
    bbox = draw.textbbox((0, 0), label, font=font)
    text_w = bbox[2] - bbox[0]
    x = (W - text_w) / 2 - bbox[0]
    draw.text((x, H - 320), label, fill=GOLD, font=font)
    img.save(os.path.join(HIGHLIGHT_DIR, f"{name}.png"), "PNG", optimize=True)


# Icon designs (centered around given x,y)
def icon_talents(draw, cx, cy):
    """Solid gold diamond — represents raw talent."""
    draw_solid_diamond(draw, cx, cy, 130, GOLD)


def icon_employers(draw, cx, cy):
    """Building/office silhouette in gold outline."""
    # Simple building shape
    w, h = 220, 220
    draw.rectangle([cx - w // 2, cy - h // 2, cx + w // 2, cy + h // 2], outline=GOLD, width=6)
    # Roof
    draw.polygon(
        [(cx - w // 2 - 20, cy - h // 2), (cx, cy - h // 2 - 60), (cx + w // 2 + 20, cy - h // 2)],
        outline=GOLD, fill=DEEP_BLACK, width=6,
    )
    # Door
    draw.rectangle([cx - 30, cy + 20, cx + 30, cy + h // 2], outline=GOLD, width=4)
    # Windows
    for dx in [-60, 60]:
        for dy in [-50, 10]:
            draw.rectangle([cx + dx - 20, cy + dy - 20, cx + dx + 20, cy + dy + 20], outline=GOLD, width=3)


def icon_how(draw, cx, cy):
    """Sparkle/star pattern."""
    draw_diamond(draw, cx, cy, 80, GOLD, line_width=5)
    draw_diamond(draw, cx - 130, cy - 50, 30, GOLD_LIGHT, line_width=3)
    draw_diamond(draw, cx + 130, cy + 50, 30, GOLD_LIGHT, line_width=3)
    draw_diamond(draw, cx + 100, cy - 110, 22, GOLD_LIGHT, line_width=3)


def icon_stories(draw, cx, cy):
    """Speech bubble outline."""
    # Bubble
    draw.rounded_rectangle(
        [cx - 130, cy - 100, cx + 130, cy + 60],
        radius=40, outline=GOLD, width=6,
    )
    # Tail
    draw.polygon(
        [(cx - 70, cy + 55), (cx - 100, cy + 110), (cx - 40, cy + 55)],
        outline=GOLD, fill=DEEP_BLACK, width=6,
    )
    # Dots inside
    for dx in [-50, 0, 50]:
        draw.ellipse([cx + dx - 12, cy - 30 - 12, cx + dx + 12, cy - 30 + 12], fill=GOLD)


def icon_faq(draw, cx, cy):
    """Big question mark."""
    font = ImageFont.truetype(FONT_HEAD, 280)
    bbox = draw.textbbox((0, 0), "?", font=font)
    text_w = bbox[2] - bbox[0]
    text_h = bbox[3] - bbox[1]
    x = cx - text_w / 2 - bbox[0]
    y = cy - text_h / 2 - bbox[1]
    draw.text((x, y), "?", fill=GOLD, font=font)


if __name__ == "__main__":
    day2_quote_card()
    print("Day 2 quote card generated.")
    highlight_cover("talents", "TALENTS", icon_talents)
    highlight_cover("employers", "EMPLOYERS", icon_employers)
    highlight_cover("how", "HOW", icon_how)
    highlight_cover("stories", "STORIES", icon_stories)
    highlight_cover("faq", "FAQ", icon_faq)
    print("5 highlight covers generated.")
    print()
    for path in sorted(os.listdir(OUT_DIR)):
        if path.startswith("day2") or path == "highlight-covers":
            full = os.path.join(OUT_DIR, path)
            if os.path.isdir(full):
                for hf in sorted(os.listdir(full)):
                    fp = os.path.join(full, hf)
                    print(f"  highlight-covers/{hf}: {os.path.getsize(fp):,} bytes")
            else:
                print(f"  {path}: {os.path.getsize(full):,} bytes")
