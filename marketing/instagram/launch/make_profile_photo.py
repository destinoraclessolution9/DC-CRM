"""Generate DNJ Instagram profile photo: 1080x1080, bold DNJ navy on white + sparkle."""
import os
from PIL import Image, ImageDraw, ImageFont

OUT = r"C:\Users\DC\Desktop\DestinOraclesSolution CRM\marketing\instagram\launch\profile-photo.png"
os.makedirs(os.path.dirname(OUT), exist_ok=True)

SIZE = 1080
NAVY = (30, 42, 94)  # #1E2A5E
WHITE = (255, 255, 255)

img = Image.new("RGB", (SIZE, SIZE), color=WHITE)
draw = ImageDraw.Draw(img)

font_candidates = [
    r"C:\Windows\Fonts\ariblk.ttf",   # Arial Black
    r"C:\Windows\Fonts\impact.ttf",
    r"C:\Windows\Fonts\seguibl.ttf",  # Segoe UI Black
    r"C:\Windows\Fonts\arialbd.ttf",
]

def load_font(size):
    for fp in font_candidates:
        if os.path.exists(fp):
            return ImageFont.truetype(fp, size), fp
    return ImageFont.load_default(), "default"

font, used = load_font(500)
print(f"Using font: {used}")

text = "DNJ"
bbox = draw.textbbox((0, 0), text, font=font)
text_w = bbox[2] - bbox[0]
text_h = bbox[3] - bbox[1]
x = (SIZE - text_w) / 2 - bbox[0]
y = (SIZE - text_h) / 2 - bbox[1]
draw.text((x, y), text, fill=NAVY, font=font)

# Sparkle accent (4-point star) in top-right
cx, cy, r = 900, 180, 36
draw.polygon(
    [(cx, cy - r), (cx + r * 0.35, cy - r * 0.35), (cx + r, cy),
     (cx + r * 0.35, cy + r * 0.35), (cx, cy + r),
     (cx - r * 0.35, cy + r * 0.35), (cx - r, cy),
     (cx - r * 0.35, cy - r * 0.35)],
    fill=NAVY,
)

img.save(OUT, "PNG", optimize=True)
print(f"Saved: {OUT}")
print(f"Size: {os.path.getsize(OUT)} bytes")
