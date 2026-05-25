"""Batch-generate DNJ quote cards (gold/black, 1080x1080) for the 60-day calendar.

Each quote: a highlighted "punch" phrase rendered in gold.
"""
import os
from PIL import Image, ImageDraw, ImageFont

OUT = r"C:\Users\DC\Desktop\DestinOraclesSolution CRM\marketing\instagram\content\quotes"
os.makedirs(OUT, exist_ok=True)

S = 1080
BLACK = (10, 10, 12)
DEEP_BLACK = (0, 0, 0)
GOLD = (212, 175, 55)
GOLD_LIGHT = (244, 208, 100)
OFFWHITE = (240, 235, 220)

FONT_HEAD = r"C:\Windows\Fonts\ariblk.ttf"
FONT_BODY = r"C:\Windows\Fonts\arialbd.ttf"
FONT_SERIF = r"C:\Windows\Fonts\timesbd.ttf"

# (filename, [lines], [gold_line_indices])
QUOTES = [
    ("q-day5-confidence", ["MOST INTERVIEWS", "TEST CONFIDENCE.", "NOT CAPABILITY."], [2]),
    ("q-day12-background", ["YOUR BACKGROUND", "DOESN'T DEFINE", "YOUR FUTURE."], [2]),
    ("q-day19-threatened", ["SOME BOSSES REJECT", "THE TALENT THEY", "FEEL THREATENED BY."], [2]),
    ("q-day25-jeweler", ["A DIAMOND NEVER", "FINDS ITS JEWELER", "BY ACCIDENT."], [1]),
    ("q-day32-underpaid", ["UNDERPAID", "IS NOT", "UNDERVALUED."], [2]),
    ("q-day39-reveal", ["GREAT COMPANIES", "DON'T FIND TALENT.", "THEY REVEAL IT."], [2]),
    ("q-day46-cut", ["EVERYONE IS", "A DIAMOND.", "YOU JUST NEED", "THE RIGHT CUT."], [1, 3]),
    ("q-day53-opportunity", ["THE RIGHT", "OPPORTUNITY", "CHANGES EVERYTHING."], [2]),
]


def fit(lines, maxf, maxw, fp=FONT_HEAD):
    s = maxf
    im = Image.new("RGB", (10, 10)); d = ImageDraw.Draw(im)
    while s > 20:
        f = ImageFont.truetype(fp, s)
        if max(d.textbbox((0, 0), ln, font=f)[2] for ln in lines) <= maxw:
            return s
        s -= 4
    return s


def bg():
    img = Image.new("RGB", (S, S), BLACK); d = ImageDraw.Draw(img)
    for i in range(S):
        t = i / (S - 1)
        d.line([(0, i), (S, i)], fill=(int(BLACK[0]*(1-t)+DEEP_BLACK[0]*t),
                                       int(BLACK[1]*(1-t)+DEEP_BLACK[1]*t),
                                       int(BLACK[2]*(1-t)+DEEP_BLACK[2]*t)))
    return img


def diamond(d, cx, cy, sz, col, w=4):
    p = [(cx, cy-sz), (cx+sz*0.85, cy), (cx, cy+sz), (cx-sz*0.85, cy)]
    for i in range(4):
        d.line([p[i], p[(i+1) % 4]], fill=col, width=w)
    d.line([(cx-sz*0.85, cy), (cx+sz*0.85, cy)], fill=col, width=2)
    d.line([(cx, cy-sz), (cx, cy+sz)], fill=col, width=2)


def make(name, lines, gold_idx):
    img = bg(); d = ImageDraw.Draw(img)
    d.rectangle([46, 46, S-46, S-46], outline=GOLD, width=3)
    # opening quote mark
    qf = ImageFont.truetype(FONT_SERIF, 200)
    d.text((80, 70), "“", fill=GOLD, font=qf)
    # quote body
    size = fit(lines, 96, S-160)
    f = ImageFont.truetype(FONT_HEAD, size)
    step = int(size * 1.14)
    total = step*(len(lines)-1) + size
    sy = (S-total)/2 - 30
    for i, ln in enumerate(lines):
        bb = d.textbbox((0, 0), ln, font=f)
        x = (S-(bb[2]-bb[0]))/2 - bb[0]
        col = GOLD if i in gold_idx else OFFWHITE
        d.text((x, sy+i*step), ln, fill=col, font=f)
    # diamond + brand footer
    diamond(d, S//2, S-205, 28, GOLD, 3)
    bf = ImageFont.truetype(FONT_HEAD, 40)
    bb = d.textbbox((0, 0), "D&J", font=bf)
    d.text(((S-(bb[2]-bb[0]))/2 - bb[0], S-150), "D&J", fill=GOLD, font=bf)
    uf = ImageFont.truetype(FONT_BODY, 22)
    url = "diamondandjeweler.com"
    bb = d.textbbox((0, 0), url, font=uf)
    d.text(((S-(bb[2]-bb[0]))/2 - bb[0], S-95), url, fill=OFFWHITE, font=uf)
    img.save(os.path.join(OUT, f"{name}.png"), "PNG", optimize=True)


if __name__ == "__main__":
    for name, lines, gi in QUOTES:
        make(name, lines, gi)
    print(f"{len(QUOTES)} quote cards generated in {OUT}")
    for f in sorted(os.listdir(OUT)):
        print(f"  {f}: {os.path.getsize(os.path.join(OUT, f)):,} bytes")
