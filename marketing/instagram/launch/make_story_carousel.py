"""DNJ brand-story carousel: "Why we're called Diamond & Jeweler"
7 slides, 1:1 squares (1080x1080), gold/black brand.
"""
import os
from PIL import Image, ImageDraw, ImageFont

OUT_DIR = r"C:\Users\DC\Desktop\DestinOraclesSolution CRM\marketing\instagram\launch"
os.makedirs(OUT_DIR, exist_ok=True)

S = 1080
BLACK = (10, 10, 12)
DEEP_BLACK = (0, 0, 0)
GOLD = (212, 175, 55)
GOLD_LIGHT = (244, 208, 100)
STONE = (90, 90, 95)
STONE_DARK = (60, 60, 65)
WHITE = (255, 255, 255)
OFFWHITE = (240, 235, 220)

FONT_HEAD = r"C:\Windows\Fonts\ariblk.ttf"
FONT_BODY = r"C:\Windows\Fonts\arialbd.ttf"
FONT_SERIF = r"C:\Windows\Fonts\timesbd.ttf"


def fit_font_size(lines, max_font_size, max_width, font_path=FONT_HEAD):
    size = max_font_size
    img = Image.new("RGB", (10, 10)); drw = ImageDraw.Draw(img)
    while size > 20:
        font = ImageFont.truetype(font_path, size)
        widest = max(drw.textbbox((0, 0), ln, font=font)[2] for ln in lines)
        if widest <= max_width:
            return size
        size -= 4
    return size


def draw_lines(draw, lines, max_font, color, center_y, line_spacing=1.1, font_path=FONT_HEAD, max_width=None, colors=None):
    if max_width is None:
        max_width = S - 150
    size = fit_font_size(lines, max_font, max_width, font_path)
    font = ImageFont.truetype(font_path, size)
    step = int(size * line_spacing)
    total = step * (len(lines) - 1) + size
    start_y = center_y - total / 2
    for i, ln in enumerate(lines):
        bbox = draw.textbbox((0, 0), ln, font=font)
        x = (S - (bbox[2] - bbox[0])) / 2 - bbox[0]
        c = colors[i] if colors else color
        draw.text((x, start_y + i * step), ln, fill=c, font=font)


def gradient_bg():
    img = Image.new("RGB", (S, S), BLACK); drw = ImageDraw.Draw(img)
    for i in range(S):
        t = i / (S - 1)
        drw.line([(0, i), (S, i)], fill=(
            int(BLACK[0]*(1-t)+DEEP_BLACK[0]*t),
            int(BLACK[1]*(1-t)+DEEP_BLACK[1]*t),
            int(BLACK[2]*(1-t)+DEEP_BLACK[2]*t)))
    return img


def border(draw, pad=46, lw=3):
    draw.rectangle([pad, pad, S - pad, S - pad], outline=GOLD, width=lw)


def draw_stone(draw, cx, cy, r, fill=STONE, outline=STONE_DARK):
    """Irregular rough stone polygon."""
    pts = [
        (cx - r, cy), (cx - r*0.6, cy - r*0.8), (cx + r*0.1, cy - r),
        (cx + r*0.7, cy - r*0.6), (cx + r, cy + r*0.1),
        (cx + r*0.5, cy + r*0.8), (cx - r*0.4, cy + r), (cx - r*0.9, cy + r*0.5),
    ]
    draw.polygon(pts, fill=fill, outline=outline)
    # a couple facet lines for rough texture
    draw.line([(cx - r*0.6, cy - r*0.8), (cx + r*0.5, cy + r*0.8)], fill=STONE_DARK, width=3)
    draw.line([(cx + r*0.1, cy - r), (cx - r*0.4, cy + r)], fill=STONE_DARK, width=3)


def draw_diamond(draw, cx, cy, size, color, line_width=5, facets=True):
    pts = [(cx, cy - size), (cx + size*0.85, cy), (cx, cy + size), (cx - size*0.85, cy)]
    for i in range(len(pts)):
        draw.line([pts[i], pts[(i+1) % len(pts)]], fill=color, width=line_width)
    if facets:
        draw.line([(cx - size*0.85, cy), (cx + size*0.85, cy)], fill=color, width=max(2, line_width//2))
        draw.line([(cx, cy - size), (cx, cy + size)], fill=color, width=max(2, line_width//2))


def draw_diamond_cut(draw, cx, cy, size, color, line_width=5):
    """Diamond outline with crown facet lines (being cut)."""
    draw_diamond(draw, cx, cy, size, color, line_width)
    # crown facets
    top = (cx, cy - size)
    draw.line([top, (cx - size*0.42, cy)], fill=color, width=2)
    draw.line([top, (cx + size*0.42, cy)], fill=color, width=2)
    draw.line([(cx - size*0.85, cy), (cx - size*0.42, cy)], fill=color, width=2)
    draw.line([(cx + size*0.42, cy), (cx + size*0.85, cy)], fill=color, width=2)


def draw_bright_diamond(draw, cx, cy, size):
    """Filled glowing faceted diamond."""
    pts = [(cx, cy - size), (cx + size*0.85, cy), (cx, cy + size), (cx - size*0.85, cy)]
    draw.polygon(pts, fill=GOLD)
    # facet shading
    draw.polygon([(cx, cy - size), (cx + size*0.85, cy), (cx, cy)], fill=GOLD_LIGHT)
    draw.line([(cx - size*0.85, cy), (cx + size*0.85, cy)], fill=DEEP_BLACK, width=2)
    draw.line([(cx, cy - size), (cx, cy + size)], fill=DEEP_BLACK, width=2)
    # sparkle rays
    for dx, dy in [(-1.4, -1.0), (1.4, -1.0), (1.5, 0.6), (-1.5, 0.6)]:
        draw.line([(cx, cy), (cx + size*dx, cy + size*dy)], fill=GOLD_LIGHT, width=2)


def slide(fn_name, draw_graphic, lines, max_font, color, colors=None, text_cy=720):
    img = gradient_bg(); draw = ImageDraw.Draw(img); border(draw)
    if draw_graphic:
        draw_graphic(draw)
    draw_lines(draw, lines, max_font, color, text_cy, colors=colors)
    img.save(os.path.join(OUT_DIR, fn_name), "PNG", optimize=True)


if __name__ == "__main__":
    # 1 - hook
    slide("carousel-story-1.png",
          lambda d: draw_stone(d, S//2, 320, 130),
          ["NO, WE DON'T", "SELL DIAMONDS."], 130, OFFWHITE, text_cy=720)

    # 2
    slide("carousel-story-2.png",
          lambda d: draw_stone(d, S//2, 300, 120),
          ["Every diamond", "starts as a", "rough stone."], 110, OFFWHITE, text_cy=720)

    # 3
    slide("carousel-story-3.png",
          lambda d: draw_stone(d, S//2, 280, 100, fill=STONE_DARK),
          ["Unnoticed.", "Unpolished.", "Easy to walk past."], 100, STONE if False else OFFWHITE, text_cy=720)

    # 4
    slide("carousel-story-4.png",
          lambda d: draw_diamond_cut(d, S//2, 300, 120, GOLD, 4),
          ["Then it meets", "the jeweler —", "who cuts it,", "shapes it…"], 96, OFFWHITE, text_cy=730)

    # 5
    slide("carousel-story-5.png",
          lambda d: draw_bright_diamond(d, S//2, 300, 130),
          ["…until it", "finally", "SHINES."], 130, OFFWHITE,
          colors=[OFFWHITE, OFFWHITE, GOLD], text_cy=730)

    # 6
    slide("carousel-story-6.png",
          lambda d: draw_diamond(d, S//2, 250, 60, GOLD, 5),
          ["YOU'RE THE DIAMOND.", "THE RIGHT LEADER", "IS THE JEWELER."], 88, OFFWHITE,
          colors=[GOLD, OFFWHITE, OFFWHITE], text_cy=650)

    # 7 - resolution + brand
    img = gradient_bg(); draw = ImageDraw.Draw(img); border(draw)
    draw_diamond(draw, S//2, 240, 55, GOLD, 5)
    draw_lines(draw, ["DIAMOND & JEWELER", "IS WHERE", "THE TWO MEET."], 92, OFFWHITE, 540,
               colors=[GOLD, OFFWHITE, OFFWHITE])
    bf = ImageFont.truetype(FONT_HEAD, 92)
    bbox = draw.textbbox((0, 0), "D&J", font=bf)
    draw.text(((S-(bbox[2]-bbox[0]))/2 - bbox[0], 820), "D&J", fill=GOLD, font=bf)
    tf = ImageFont.truetype(FONT_SERIF, 28)
    tag = "TALENT · AI · LEADER"
    bbox = draw.textbbox((0, 0), tag, font=tf)
    draw.text(((S-(bbox[2]-bbox[0]))/2 - bbox[0], 935), tag, fill=GOLD_LIGHT, font=tf)
    uf = ImageFont.truetype(FONT_BODY, 32)
    url = "diamondandjeweler.com"
    bbox = draw.textbbox((0, 0), url, font=uf)
    draw.text(((S-(bbox[2]-bbox[0]))/2 - bbox[0], 985), url, fill=OFFWHITE, font=uf)
    img.save(os.path.join(OUT_DIR, "carousel-story-7.png"), "PNG", optimize=True)

    print("7 brand-story slides generated.")
    for f in sorted(os.listdir(OUT_DIR)):
        if f.startswith("carousel-story-"):
            print(f"  {f}: {os.path.getsize(os.path.join(OUT_DIR, f)):,} bytes")
