"""Generate DNJ text-on-screen reels (1080x1920, 30fps, H.264 MP4).

These are silent vertical videos. Upload to IG -> add trending audio in the
app -> post. Built to match the carousel/quote brand (black bg + gold accents).

Reels in this file:
  - reel-d-things-they-dont-tell-you.mp4  (Day 13, 14s)

To add more reels: copy `reel_d()` style, define your SEGMENTS, call render().
"""
import os
import numpy as np
import imageio.v2 as imageio
from PIL import Image, ImageDraw, ImageFont

# ---------- brand ----------
W, H = 1080, 1920
BLACK = (10, 10, 12)
DEEP_BLACK = (0, 0, 0)
GOLD = (212, 175, 55)
GOLD_LIGHT = (244, 208, 100)
OFFWHITE = (240, 235, 220)
DIM = (160, 155, 145)

FONT_HEAD = r"C:\Windows\Fonts\ariblk.ttf"
FONT_BODY = r"C:\Windows\Fonts\arialbd.ttf"
FONT_SERIF = r"C:\Windows\Fonts\timesbd.ttf"

FPS = 30
OUT_DIR = r"C:\Users\DC\Desktop\DestinOraclesSolution CRM\marketing\instagram\content\reels"
os.makedirs(OUT_DIR, exist_ok=True)


# ---------- helpers ----------
def gradient_bg():
    img = Image.new("RGB", (W, H), BLACK)
    d = ImageDraw.Draw(img)
    for i in range(H):
        t = i / (H - 1)
        c = (
            int(BLACK[0] * (1 - t) + DEEP_BLACK[0] * t),
            int(BLACK[1] * (1 - t) + DEEP_BLACK[1] * t),
            int(BLACK[2] * (1 - t) + DEEP_BLACK[2] * t),
        )
        d.line([(0, i), (W, i)], fill=c)
    return img


def draw_border(img):
    d = ImageDraw.Draw(img)
    d.rectangle([46, 46, W - 46, H - 46], outline=GOLD, width=3)


def draw_diamond(d, cx, cy, sz, col, w=4):
    p = [(cx, cy - sz), (cx + sz * 0.85, cy), (cx, cy + sz), (cx - sz * 0.85, cy)]
    for i in range(4):
        d.line([p[i], p[(i + 1) % 4]], fill=col, width=w)
    d.line([(cx - sz * 0.85, cy), (cx + sz * 0.85, cy)], fill=col, width=2)
    d.line([(cx, cy - sz), (cx, cy + sz)], fill=col, width=2)


def text_size(d, text, font):
    bb = d.textbbox((0, 0), text, font=font)
    return bb[2] - bb[0], bb[3] - bb[1]


def text_centered(d, text, y, font, fill):
    """Center using bbox offset so the *visual* glyph is centered, not the box origin."""
    bb = d.textbbox((0, 0), text, font=font)
    w = bb[2] - bb[0]
    d.text(((W - w) / 2 - bb[0], y), text, fill=fill, font=font)


# safe text area (inside gold border + comfortable margin)
SAFE_X = 100
SAFE_W = W - 2 * SAFE_X  # = 880


def fit_font(text, font_path, max_size, max_width=SAFE_W, min_size=40):
    """Largest font size where `text` fits within max_width."""
    im = Image.new("RGB", (10, 10))
    d = ImageDraw.Draw(im)
    s = max_size
    while s > min_size:
        f = ImageFont.truetype(font_path, s)
        bb = d.textbbox((0, 0), text, font=f)
        if (bb[2] - bb[0]) <= max_width:
            return f
        s -= 4
    return ImageFont.truetype(font_path, min_size)


def fit_font_multi(lines, font_path, max_size, max_width=SAFE_W, min_size=40):
    """Largest font size where ALL lines fit."""
    im = Image.new("RGB", (10, 10))
    d = ImageDraw.Draw(im)
    s = max_size
    while s > min_size:
        f = ImageFont.truetype(font_path, s)
        widths = [d.textbbox((0, 0), ln, font=f)[2] - d.textbbox((0, 0), ln, font=f)[0] for ln in lines]
        if max(widths) <= max_width:
            return f
        s -= 4
    return ImageFont.truetype(font_path, min_size)


def fade_overlay(img, alpha):
    """Apply uniform alpha to img — fade from black."""
    if alpha >= 1.0:
        return img
    if alpha <= 0.0:
        return Image.new("RGB", img.size, DEEP_BLACK)
    base = Image.new("RGB", img.size, DEEP_BLACK)
    return Image.blend(base, img, alpha)


def overlay_branding(d, sec):
    """Bottom-left @dnj.ai · bottom-right progress dot bar."""
    f = ImageFont.truetype(FONT_BODY, 36)
    d.text((70, H - 100), "@dnj.ai", fill=DIM, font=f)
    # progress dots (one per second)
    total = 14
    for i in range(total):
        x = W - 80 - (total - 1 - i) * 28
        col = GOLD if i <= sec else (60, 60, 60)
        d.ellipse([x - 6, H - 90, x + 6, H - 78], fill=col)


def end_frame(alpha):
    img = gradient_bg()
    draw_border(img)
    d = ImageDraw.Draw(img)
    # diamond
    draw_diamond(d, W // 2, H // 2 - 280, 80, GOLD, w=5)
    # main lines (auto-fit to safe width)
    f_main = fit_font_multi(["YOU'RE NOT BEHIND.", "YOU'RE UNDISCOVERED."], FONT_HEAD, max_size=88)
    text_centered(d, "YOU'RE NOT BEHIND.", H // 2 - 100, f_main, OFFWHITE)
    text_centered(d, "YOU'RE UNDISCOVERED.", H // 2 + 10, f_main, GOLD)
    # D&J wordmark + URL
    f_dj = ImageFont.truetype(FONT_HEAD, 110)
    f_url = ImageFont.truetype(FONT_BODY, 46)
    text_centered(d, "D&J", H // 2 + 240, f_dj, GOLD)
    text_centered(d, "diamondandjeweler.com", H // 2 + 380, f_url, OFFWHITE)
    return fade_overlay(img, alpha)


def hook_frame(alpha):
    img = gradient_bg()
    draw_border(img)
    d = ImageDraw.Draw(img)
    # opening quote
    f_q = ImageFont.truetype(FONT_SERIF, 320)
    d.text((90, 90), "“", fill=GOLD, font=f_q)
    # hook text — auto-fit per line, smaller-than-original to stay inside border
    lines = ["NOBODY TELLS YOU", "THIS ABOUT", "JOB HUNTING:"]
    f_main = fit_font_multi(lines, FONT_HEAD, max_size=84)
    text_centered(d, lines[0], H // 2 - 220, f_main, OFFWHITE)
    text_centered(d, lines[1], H // 2 - 100, f_main, OFFWHITE)
    text_centered(d, lines[2], H // 2 + 20, f_main, GOLD)
    # subtle drop hint — three dots, no emoji
    f_hint = ImageFont.truetype(FONT_HEAD, 80)
    text_centered(d, ".  .  .", H // 2 + 220, f_hint, GOLD_LIGHT)
    return fade_overlay(img, alpha)


def list_frame(visible_items, last_alpha):
    """visible_items: how many list items to show.
    last_alpha: fade-in alpha for the newest item (0..1)."""
    img = gradient_bg()
    draw_border(img)
    d = ImageDraw.Draw(img)

    # heading (persistent)
    f_head = ImageFont.truetype(FONT_HEAD, 64)
    text_centered(d, "NOBODY TELLS YOU:", 220, f_head, DIM)

    # list items
    items = [
        ("1.", "IT'S LONELY."),
        ("2.", '"JUST NETWORK"', "ISN'T ADVICE."),
        ("3.", "BEING GHOSTED", "ISN'T ABOUT YOU."),
    ]
    f_num = ImageFont.truetype(FONT_HEAD, 110)
    # auto-size item text to fit the inner panel (starts at x=300, ends at SAFE_X+SAFE_W)
    item_max_width = (SAFE_X + SAFE_W) - 320
    all_item_lines = [ln for it in items for ln in it[1:]]
    f_item = fit_font_multi(all_item_lines, FONT_HEAD, max_size=88, max_width=item_max_width)

    y_starts = [430, 800, 1170]  # vertical anchor per slot

    for idx in range(visible_items):
        item = items[idx]
        num = item[0]
        lines = item[1:]
        y = y_starts[idx]

        # if newest and fading in, render to a temp panel and blend
        if idx == visible_items - 1 and last_alpha < 1.0:
            panel = Image.new("RGB", (W, 320), DEEP_BLACK)
            pd = ImageDraw.Draw(panel)
            pd.text((140, 30), num, fill=GOLD, font=f_num)
            ty = 40
            for ln in lines:
                w_ln, _ = text_size(pd, ln, f_item)
                pd.text((300, ty), ln, fill=OFFWHITE, font=f_item)
                ty += 110
            # crop strip from background to blend with
            strip_bg = img.crop((0, y, W, y + 320))
            blended = Image.blend(strip_bg, panel, last_alpha)
            img.paste(blended, (0, y))
            d = ImageDraw.Draw(img)
        else:
            d.text((140, y + 30), num, fill=GOLD, font=f_num)
            ty = y + 40
            for ln in lines:
                d.text((300, ty), ln, fill=OFFWHITE, font=f_item)
                ty += 110

    return img


# ---------- timeline ----------
def reel_d_frame(i):
    """Return PIL Image for frame i (0..419) of Reel D, 14s @ 30fps."""
    t = i / FPS
    sec = int(t)

    if t < 2.0:
        # 0-2s: hook fade in over first 0.4s
        alpha = min(1.0, t / 0.4)
        img = hook_frame(alpha)
    elif t < 2.3:
        # 2.0-2.3s: transition — hook fades out
        a = 1.0 - (t - 2.0) / 0.3
        img = hook_frame(max(0.0, a))
    elif t < 5.0:
        # 2.3-5s: item 1 appears (fade-in 0.4s)
        a = min(1.0, (t - 2.3) / 0.4)
        img = list_frame(1, a)
    elif t < 8.0:
        # 5-8s: + item 2
        a = min(1.0, (t - 5.0) / 0.4)
        img = list_frame(2, a)
    elif t < 10.8:
        # 8-10.8s: + item 3
        a = min(1.0, (t - 8.0) / 0.4)
        img = list_frame(3, a)
    elif t < 11.1:
        # transition
        a = 1.0 - (t - 10.8) / 0.3
        img = list_frame(3, max(0.0, a))
    else:
        # 11.1-14s: end frame
        a = min(1.0, (t - 11.1) / 0.4)
        img = end_frame(a)

    # branding overlay (always)
    d = ImageDraw.Draw(img)
    overlay_branding(d, sec)
    return img


def render(name, frame_fn, duration_s=14):
    total = int(duration_s * FPS)
    out_path = os.path.join(OUT_DIR, f"{name}.mp4")
    print(f"Rendering {name} -> {out_path}  ({total} frames @ {FPS}fps)")
    writer = imageio.get_writer(
        out_path,
        fps=FPS,
        codec="libx264",
        quality=8,
        macro_block_size=1,
        pixelformat="yuv420p",
        ffmpeg_log_level="error",
    )
    for i in range(total):
        img = frame_fn(i)
        writer.append_data(np.asarray(img))
        if (i + 1) % 30 == 0:
            print(f"  {i+1}/{total} frames")
    writer.close()
    size_mb = os.path.getsize(out_path) / (1024 * 1024)
    print(f"Done: {out_path}  ({size_mb:.2f} MB)")
    return out_path


if __name__ == "__main__":
    render("reel-d-things-they-dont-tell-you", reel_d_frame, duration_s=14)
