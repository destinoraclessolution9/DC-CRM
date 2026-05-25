"""Generate DNJ Instagram launch carousel: 5 slides 1080x1350."""
import os
from PIL import Image, ImageDraw, ImageFont

OUT_DIR = r"C:\Users\DC\Desktop\DestinOraclesSolution CRM\marketing\instagram\launch"
os.makedirs(OUT_DIR, exist_ok=True)

W, H = 1080, 1350
NAVY = (17, 24, 39)         # #111827 primary
INDIGO = (30, 42, 94)       # #1E2A5E secondary
ACCENT = (79, 70, 229)      # #4F46E5
WHITE = (255, 255, 255)
RED = (220, 38, 38)

FONT_HEAD = r"C:\Windows\Fonts\ariblk.ttf"
FONT_BODY = r"C:\Windows\Fonts\arialbd.ttf"


def fit_font_size(lines, max_font_size, max_width, font_path=FONT_HEAD):
    """Shrink font until the widest line fits within max_width."""
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


def draw_lines_centered(draw, lines, font_size, color, top_offset=0, line_spacing=1.05, font_path=FONT_HEAD, max_width=None):
    if max_width is None:
        max_width = W - 80  # default 40px padding each side
    font_size = fit_font_size(lines, font_size, max_width, font_path)
    font = ImageFont.truetype(font_path, font_size)
    line_step = int(font_size * line_spacing)
    total = line_step * (len(lines) - 1) + font_size
    start_y = (H - total) / 2 + top_offset
    for i, line in enumerate(lines):
        bbox = draw.textbbox((0, 0), line, font=font)
        text_w = bbox[2] - bbox[0]
        x = (W - text_w) / 2 - bbox[0]
        y = start_y + i * line_step
        draw.text((x, y), line, fill=color, font=font)


def draw_sparkle(draw, cx, cy, r, color):
    pts = [
        (cx, cy - r),
        (cx + r * 0.3, cy - r * 0.3),
        (cx + r, cy),
        (cx + r * 0.3, cy + r * 0.3),
        (cx, cy + r),
        (cx - r * 0.3, cy + r * 0.3),
        (cx - r, cy),
        (cx - r * 0.3, cy - r * 0.3),
    ]
    draw.polygon(pts, fill=color)


def linear_gradient(w, h, color_a, color_b):
    img = Image.new("RGB", (w, h), color_a)
    drw = ImageDraw.Draw(img)
    for i in range(h):
        t = i / (h - 1)
        r = int(color_a[0] * (1 - t) + color_b[0] * t)
        g = int(color_a[1] * (1 - t) + color_b[1] * t)
        b = int(color_a[2] * (1 - t) + color_b[2] * t)
        drw.line([(0, i), (w, i)], fill=(r, g, b))
    return img


def slide_1():
    img = Image.new("RGB", (W, H), NAVY)
    draw = ImageDraw.Draw(img)
    draw_lines_centered(draw, ["SOME PEOPLE", "ARE NOT", "UNTALENTED."], 140, WHITE)
    img.save(os.path.join(OUT_DIR, "carousel-slide-1.png"), "PNG", optimize=True)


def slide_2():
    img = Image.new("RGB", (W, H), NAVY)
    draw = ImageDraw.Draw(img)
    draw_lines_centered(draw, ["THEY WERE", "JUST NEVER", "DISCOVERED."], 140, WHITE)
    draw_sparkle(draw, 540, 230, 36, WHITE)
    img.save(os.path.join(OUT_DIR, "carousel-slide-2.png"), "PNG", optimize=True)


def slide_3():
    img = Image.new("RGB", (W, H), WHITE)
    draw = ImageDraw.Draw(img)
    lines = [("100 RESUMES.", NAVY), ("1 ROLE.", NAVY), ("HIRING IS", NAVY), ("BROKEN.", RED)]
    plain_lines = [t for t, _ in lines]
    size = fit_font_size(plain_lines, 130, W - 80)
    head = ImageFont.truetype(FONT_HEAD, size)
    line_h = int(size * 1.15)
    total = line_h * (len(lines) - 1) + size
    start_y = (H - total) / 2
    for i, (line, color) in enumerate(lines):
        bbox = draw.textbbox((0, 0), line, font=head)
        text_w = bbox[2] - bbox[0]
        x = (W - text_w) / 2 - bbox[0]
        y = start_y + i * line_h
        draw.text((x, y), line, fill=color, font=head)
    img.save(os.path.join(OUT_DIR, "carousel-slide-3.png"), "PNG", optimize=True)


def slide_4():
    img = linear_gradient(W, H, INDIGO, ACCENT)
    draw = ImageDraw.Draw(img)
    draw_lines_centered(draw, ["AI FINDS", "THE 3", "THAT TRULY", "FIT YOU."], 130, WHITE)
    img.save(os.path.join(OUT_DIR, "carousel-slide-4.png"), "PNG", optimize=True)


def slide_5():
    img = Image.new("RGB", (W, H), NAVY)
    draw = ImageDraw.Draw(img)
    draw_lines_centered(
        draw,
        ["EVERYONE IS", "A DIAMOND.", "THE RIGHT BOSS", "SHARPENS THEM."],
        100,
        WHITE,
        top_offset=-150,
        line_spacing=1.1,
    )
    draw_sparkle(draw, 540, 1020, 32, WHITE)
    brand_font = ImageFont.truetype(FONT_HEAD, 110)
    bbox = draw.textbbox((0, 0), "DNJ", font=brand_font)
    x = (W - (bbox[2] - bbox[0])) / 2 - bbox[0]
    draw.text((x, 1090), "DNJ", fill=WHITE, font=brand_font)
    url_font = ImageFont.truetype(FONT_BODY, 42)
    url = "diamondandjeweler.com"
    bbox = draw.textbbox((0, 0), url, font=url_font)
    x = (W - (bbox[2] - bbox[0])) / 2 - bbox[0]
    draw.text((x, 1240), url, fill=WHITE, font=url_font)
    img.save(os.path.join(OUT_DIR, "carousel-slide-5.png"), "PNG", optimize=True)


if __name__ == "__main__":
    slide_1()
    slide_2()
    slide_3()
    slide_4()
    slide_5()
    print("All 5 carousel slides generated.")
    for f in sorted(os.listdir(OUT_DIR)):
        if f.startswith("carousel-slide"):
            path = os.path.join(OUT_DIR, f)
            print(f"  {f}: {os.path.getsize(path):,} bytes")
