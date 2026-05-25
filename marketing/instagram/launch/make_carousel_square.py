"""Generate DNJ launch carousel as TRUE 1:1 SQUARES (1080x1080).

Instagram never crops 1:1, so all content stays safe.
Gold/black/diamond brand to match @dnj.ai profile.
"""
import os
from PIL import Image, ImageDraw, ImageFont

OUT_DIR = r"C:\Users\DC\Desktop\DestinOraclesSolution CRM\marketing\instagram\launch"
os.makedirs(OUT_DIR, exist_ok=True)

S = 1080  # square side
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


def draw_lines_centered(draw, lines, font_size, color, top_offset=0, line_spacing=1.08, font_path=FONT_HEAD, max_width=None):
    if max_width is None:
        max_width = S - 140  # 70px padding each side (safe zone)
    font_size = fit_font_size(lines, font_size, max_width, font_path)
    font = ImageFont.truetype(font_path, font_size)
    line_step = int(font_size * line_spacing)
    total = line_step * (len(lines) - 1) + font_size
    start_y = (S - total) / 2 + top_offset
    for i, line in enumerate(lines):
        bbox = draw.textbbox((0, 0), line, font=font)
        text_w = bbox[2] - bbox[0]
        x = (S - text_w) / 2 - bbox[0]
        y = start_y + i * line_step
        draw.text((x, y), line, fill=color, font=font)


def draw_diamond(draw, cx, cy, size, color, line_width=5):
    pts = [(cx, cy - size), (cx + size * 0.85, cy), (cx, cy + size), (cx - size * 0.85, cy)]
    for i in range(len(pts)):
        draw.line([pts[i], pts[(i + 1) % len(pts)]], fill=color, width=line_width)
    draw.line([(cx - size * 0.85, cy), (cx + size * 0.85, cy)], fill=color, width=max(2, line_width // 2))
    draw.line([(cx, cy - size), (cx, cy + size)], fill=color, width=max(2, line_width // 2))


def gradient_bg():
    img = Image.new("RGB", (S, S), BLACK)
    drw = ImageDraw.Draw(img)
    for i in range(S):
        t = i / (S - 1)
        r = int(BLACK[0] * (1 - t) + DEEP_BLACK[0] * t)
        g = int(BLACK[1] * (1 - t) + DEEP_BLACK[1] * t)
        b = int(BLACK[2] * (1 - t) + DEEP_BLACK[2] * t)
        drw.line([(0, i), (S, i)], fill=(r, g, b))
    return img


def border(draw, pad=46, lw=3):
    draw.rectangle([pad, pad, S - pad, S - pad], outline=GOLD, width=lw)


def slide_1():
    img = gradient_bg(); draw = ImageDraw.Draw(img); border(draw)
    draw_diamond(draw, S // 2, 230, 44, GOLD, 5)
    draw_lines_centered(draw, ["SOME PEOPLE", "ARE NOT", "UNTALENTED."], 120, OFFWHITE, top_offset=60)
    img.save(os.path.join(OUT_DIR, "carousel-sq-1.png"), "PNG", optimize=True)


def slide_2():
    img = gradient_bg(); draw = ImageDraw.Draw(img); border(draw)
    draw_diamond(draw, S // 2, 220, 50, GOLD_LIGHT, 6)
    draw_lines_centered(draw, ["THEY WERE", "JUST NEVER", "DISCOVERED."], 120, GOLD, top_offset=60)
    img.save(os.path.join(OUT_DIR, "carousel-sq-2.png"), "PNG", optimize=True)


def slide_3():
    img = gradient_bg(); draw = ImageDraw.Draw(img); border(draw)
    lines = [("100 RESUMES.", OFFWHITE), ("1 ROLE.", OFFWHITE), ("HIRING IS", OFFWHITE), ("BROKEN.", GOLD)]
    plain = [t for t, _ in lines]
    size = fit_font_size(plain, 110, S - 140)
    head = ImageFont.truetype(FONT_HEAD, size)
    line_h = int(size * 1.18)
    total = line_h * (len(lines) - 1) + size
    start_y = (S - total) / 2
    for i, (line, color) in enumerate(lines):
        bbox = draw.textbbox((0, 0), line, font=head)
        x = (S - (bbox[2] - bbox[0])) / 2 - bbox[0]
        draw.text((x, start_y + i * line_h), line, fill=color, font=head)
    img.save(os.path.join(OUT_DIR, "carousel-sq-3.png"), "PNG", optimize=True)


def slide_4():
    img = gradient_bg(); draw = ImageDraw.Draw(img); border(draw)
    draw_diamond(draw, 180, 180, 26, GOLD, 3)
    draw_diamond(draw, S - 180, 180, 26, GOLD, 3)
    draw_lines_centered(draw, ["AI FINDS", "THE 3", "THAT TRULY", "FIT YOU."], 110, GOLD_LIGHT, top_offset=20)
    sub_font = ImageFont.truetype(FONT_SERIF, 34)
    sub = "out of a sea of resumes."
    bbox = draw.textbbox((0, 0), sub, font=sub_font)
    x = (S - (bbox[2] - bbox[0])) / 2 - bbox[0]
    draw.text((x, S - 150), sub, fill=OFFWHITE, font=sub_font)
    img.save(os.path.join(OUT_DIR, "carousel-sq-4.png"), "PNG", optimize=True)


def slide_5():
    img = gradient_bg(); draw = ImageDraw.Draw(img); border(draw)
    draw_lines_centered(draw, ["EVERYONE IS", "A DIAMOND.", "THE RIGHT BOSS", "SHARPENS THEM."], 84, OFFWHITE, top_offset=-150, line_spacing=1.12)
    draw_diamond(draw, S // 2, 720, 50, GOLD, 5)
    brand_font = ImageFont.truetype(FONT_HEAD, 92)
    bbox = draw.textbbox((0, 0), "D&J", font=brand_font)
    x = (S - (bbox[2] - bbox[0])) / 2 - bbox[0]
    draw.text((x, 820), "D&J", fill=GOLD, font=brand_font)
    tag_font = ImageFont.truetype(FONT_SERIF, 28)
    tag = "TALENT · AI · LEADER"
    bbox = draw.textbbox((0, 0), tag, font=tag_font)
    x = (S - (bbox[2] - bbox[0])) / 2 - bbox[0]
    draw.text((x, 935), tag, fill=GOLD_LIGHT, font=tag_font)
    url_font = ImageFont.truetype(FONT_BODY, 32)
    url = "diamondandjeweler.com"
    bbox = draw.textbbox((0, 0), url, font=url_font)
    x = (S - (bbox[2] - bbox[0])) / 2 - bbox[0]
    draw.text((x, 985), url, fill=OFFWHITE, font=url_font)
    img.save(os.path.join(OUT_DIR, "carousel-sq-5.png"), "PNG", optimize=True)


if __name__ == "__main__":
    slide_1(); slide_2(); slide_3(); slide_4(); slide_5()
    print("5 square (1080x1080) carousel slides generated.")
    for f in sorted(os.listdir(OUT_DIR)):
        if f.startswith("carousel-sq-"):
            print(f"  {f}: {os.path.getsize(os.path.join(OUT_DIR, f)):,} bytes")
