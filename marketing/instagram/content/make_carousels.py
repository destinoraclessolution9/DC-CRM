"""Batch-generate DNJ value carousels (gold/black, 1080x1080) for the 60-day calendar.

Carousels: resume mistakes, hiring truths 1-3, interview answers, salary negotiation, hiring truths 4-6.
Each slide is dict: {"type": title|content|cta, "head":[...], "body":[...]}.
"""
import os
from PIL import Image, ImageDraw, ImageFont

OUT = r"C:\Users\DC\Desktop\DestinOraclesSolution CRM\marketing\instagram\content\carousels"
os.makedirs(OUT, exist_ok=True)

S = 1080
BLACK = (10, 10, 12); DEEP = (0, 0, 0)
GOLD = (212, 175, 55); GOLD_L = (244, 208, 100)
OFFWHITE = (240, 235, 220); GREY = (150, 150, 150)
FONT_HEAD = r"C:\Windows\Fonts\ariblk.ttf"
FONT_BODY = r"C:\Windows\Fonts\arialbd.ttf"
FONT_REG = r"C:\Windows\Fonts\arial.ttf"
FONT_SERIF = r"C:\Windows\Fonts\timesbd.ttf"


def fit(lines, maxf, maxw, fp=FONT_HEAD):
    s = maxf
    im = Image.new("RGB", (10, 10)); d = ImageDraw.Draw(im)
    while s > 18:
        f = ImageFont.truetype(fp, s)
        if max(d.textbbox((0, 0), ln, font=f)[2] for ln in lines) <= maxw:
            return s
        s -= 3
    return s


def wrap(text, font, maxw, draw):
    words = text.split()
    lines, cur = [], ""
    for w in words:
        test = (cur + " " + w).strip()
        if draw.textbbox((0, 0), test, font=font)[2] <= maxw:
            cur = test
        else:
            if cur:
                lines.append(cur)
            cur = w
    if cur:
        lines.append(cur)
    return lines


def bg():
    img = Image.new("RGB", (S, S), BLACK); d = ImageDraw.Draw(img)
    for i in range(S):
        t = i/(S-1)
        d.line([(0, i), (S, i)], fill=(int(BLACK[0]*(1-t)+DEEP[0]*t),
                                       int(BLACK[1]*(1-t)+DEEP[1]*t),
                                       int(BLACK[2]*(1-t)+DEEP[2]*t)))
    return img


def border(d):
    d.rectangle([46, 46, S-46, S-46], outline=GOLD, width=3)


def diamond(d, cx, cy, sz, col, w=3):
    p = [(cx, cy-sz), (cx+sz*0.85, cy), (cx, cy+sz), (cx-sz*0.85, cy)]
    for i in range(4):
        d.line([p[i], p[(i+1) % 4]], fill=col, width=w)
    d.line([(cx-sz*0.85, cy), (cx+sz*0.85, cy)], fill=col, width=2)
    d.line([(cx, cy-sz), (cx, cy+sz)], fill=col, width=2)


def render_slide(slide, path):
    img = bg(); d = ImageDraw.Draw(img); border(d)
    if slide["type"] == "title":
        lines = slide["head"]
        sz = fit(lines, 110, S-150)
        f = ImageFont.truetype(FONT_HEAD, sz)
        step = int(sz*1.12); total = step*(len(lines)-1)+sz
        sy = (S-total)/2 - 20
        for i, ln in enumerate(lines):
            bb = d.textbbox((0, 0), ln, font=f)
            d.text(((S-(bb[2]-bb[0]))/2-bb[0], sy+i*step), ln, fill=OFFWHITE, font=f)
        diamond(d, S//2, S-180, 30, GOLD, 3)
        sf = ImageFont.truetype(FONT_BODY, 28)
        sw = "swipe →"
        bb = d.textbbox((0, 0), sw, font=sf)
        d.text(((S-(bb[2]-bb[0]))/2-bb[0], S-120), sw, fill=GOLD_L, font=sf)
    elif slide["type"] == "content":
        # heading (gold, big)
        head = slide["head"]
        hsz = fit(head, 88, S-150)
        hf = ImageFont.truetype(FONT_HEAD, hsz)
        hstep = int(hsz*1.1); htotal = hstep*(len(head)-1)+hsz
        hy = 230
        for i, ln in enumerate(head):
            bb = d.textbbox((0, 0), ln, font=hf)
            d.text(((S-(bb[2]-bb[0]))/2-bb[0], hy+i*hstep), ln, fill=GOLD, font=hf)
        # body (offwhite, wrapped)
        body = slide.get("body", [])
        if body:
            bf = ImageFont.truetype(FONT_REG, 40)
            wrapped = []
            for para in body:
                wrapped += wrap(para, bf, S-200, d)
            bstep = 56
            by = hy + htotal + 80
            for i, ln in enumerate(wrapped):
                bb = d.textbbox((0, 0), ln, font=bf)
                d.text(((S-(bb[2]-bb[0]))/2-bb[0], by+i*bstep), ln, fill=OFFWHITE, font=bf)
    elif slide["type"] == "cta":
        lines = slide["head"]
        sz = fit(lines, 84, S-160)
        f = ImageFont.truetype(FONT_HEAD, sz)
        step = int(sz*1.12); total = step*(len(lines)-1)+sz
        sy = (S-total)/2 - 120
        for i, ln in enumerate(lines):
            bb = d.textbbox((0, 0), ln, font=f)
            col = GOLD if i in slide.get("gold", []) else OFFWHITE
            d.text(((S-(bb[2]-bb[0]))/2-bb[0], sy+i*step), ln, fill=col, font=f)
        diamond(d, S//2, S-280, 36, GOLD, 4)
        bf = ImageFont.truetype(FONT_HEAD, 80)
        bb = d.textbbox((0, 0), "D&J", font=bf)
        d.text(((S-(bb[2]-bb[0]))/2-bb[0], S-200), "D&J", fill=GOLD, font=bf)
        uf = ImageFont.truetype(FONT_BODY, 30)
        url = "diamondandjeweler.com"
        bb = d.textbbox((0, 0), url, font=uf)
        d.text(((S-(bb[2]-bb[0]))/2-bb[0], S-95), url, fill=OFFWHITE, font=uf)
    img.save(path, "PNG", optimize=True)


CAROUSELS = {
    "day10-resume-mistakes": [
        {"type": "title", "head": ["3 RESUME", "MISTAKES", "KEEPING YOU", "INVISIBLE"]},
        {"type": "content", "head": ["1. DUTIES,", "NOT WINS"], "body": ["'Managed social media' says nothing.", "'Grew followers 3x in 4 months' sells you."]},
        {"type": "content", "head": ["2. ONE", "GENERIC CV"], "body": ["You send the same CV everywhere.", "Tailor your top 3 lines to each role."]},
        {"type": "content", "head": ["3. ADJECTIVES,", "NO PROOF"], "body": ["'Hardworking' means nothing.", "Show numbers. Show results."]},
        {"type": "cta", "head": ["FIX THESE.", "LET AI", "MATCH YOU."], "gold": [2]},
    ],
    "day16-hiring-truths-1": [
        {"type": "title", "head": ["HIRING TRUTHS", "NOBODY", "ADMITS"]},
        {"type": "content", "head": ["#1"], "body": ["Companies hire confidence,", "not capability."]},
        {"type": "content", "head": ["#2"], "body": ["The best worker is often", "the quietest in the room."]},
        {"type": "content", "head": ["#3"], "body": ["'We'll let you know'", "usually means no."]},
        {"type": "cta", "head": ["DNJ MATCHES", "ON FIT.", "NOT VOLUME."], "gold": [1]},
    ],
    "day29-interview-answers": [
        {"type": "title", "head": ["5 INTERVIEW", "ANSWERS THAT", "ACTUALLY WORK"]},
        {"type": "content", "head": ["TELL ME", "ABOUT YOURSELF"], "body": ["Present → past → why this role.", "Keep it under 90 seconds."]},
        {"type": "content", "head": ["YOUR", "WEAKNESS?"], "body": ["Name a real one +", "how you actively manage it."]},
        {"type": "content", "head": ["WHY HIRE", "YOU?"], "body": ["Match your wins", "to their exact need."]},
        {"type": "content", "head": ["ANY", "QUESTIONS?"], "body": ["Always yes.", "Ask about growth + the team."]},
        {"type": "cta", "head": ["LAND IT.", "THEN LET DNJ", "FIND YOUR NEXT."], "gold": [1]},
    ],
    "day34-salary-negotiation": [
        {"type": "title", "head": ["HOW TO", "NEGOTIATE", "SALARY", "(5 STEPS)"]},
        {"type": "content", "head": ["STEP 1"], "body": ["Research the market range", "before any conversation."]},
        {"type": "content", "head": ["STEP 2"], "body": ["Let them name a number —", "or anchor high first."]},
        {"type": "content", "head": ["STEP 3"], "body": ["Counter with value,", "not personal need."]},
        {"type": "content", "head": ["STEP 4"], "body": ["Negotiate the whole package,", "not just base pay."]},
        {"type": "content", "head": ["STEP 5"], "body": ["Get the final offer", "in writing."]},
        {"type": "cta", "head": ["KNOW YOUR", "WORTH."], "gold": [1]},
    ],
    "day51-hiring-truths-2": [
        {"type": "title", "head": ["MORE", "HIRING", "TRUTHS"]},
        {"type": "content", "head": ["#4"], "body": ["CGPA can't measure", "hunger or grit."]},
        {"type": "content", "head": ["#5"], "body": ["Most 'culture fit'", "rejections are just bias."]},
        {"type": "content", "head": ["#6"], "body": ["Your network beats your CV.", "Unfair — but true."]},
        {"type": "cta", "head": ["WE'RE", "CHANGING", "THAT."], "gold": [2]},
    ],
    "day37-hr-pitch": [
        {"type": "title", "head": ["FOR", "HIRING", "MANAGERS"]},
        {"type": "content", "head": ["STOP READING", "200 CVs"], "body": ["For one role.", "There's a faster way."]},
        {"type": "content", "head": ["AI SENDS", "YOUR TOP 3"], "body": ["Matched on skills, culture fit,", "trajectory and pay range."]},
        {"type": "content", "head": ["NO FLOOD.", "NO CARD."], "body": ["Post one role.", "See 3 matches in 48 hours."]},
        {"type": "cta", "head": ["FIRST 3", "CANDIDATES —", "FREE."], "gold": [2]},
    ],
    "day44-career-reality": [
        {"type": "title", "head": ["CAREER", "REALITY"]},
        {"type": "content", "head": ["GHOSTING", "HURTS MORE", "THAN REJECTION"], "body": ["At least a 'no' gives closure."]},
        {"type": "content", "head": ["IT'S NOT", "ABOUT YOU"], "body": ["Most ghosting is broken process,", "not your worth."]},
        {"type": "content", "head": ["PROTECT", "YOUR SHINE"], "body": ["Set a limit. Track applications.", "Don't let silence define you."]},
        {"type": "cta", "head": ["YOU'RE NOT", "BEHIND.", "UNDISCOVERED."], "gold": [2]},
    ],
    "day58-best-of": [
        {"type": "title", "head": ["8 WEEKS,", "5 LESSONS"]},
        {"type": "content", "head": ["1."], "body": ["You're not untalented —", "just undiscovered."]},
        {"type": "content", "head": ["2."], "body": ["The right room", "matters more than the resume."]},
        {"type": "content", "head": ["3."], "body": ["Show wins, not duties."]},
        {"type": "content", "head": ["4."], "body": ["Fit beats confidence."]},
        {"type": "content", "head": ["5."], "body": ["Everyone is a diamond.", "You just need the right cut."]},
        {"type": "cta", "head": ["KEEP", "SHINING."], "gold": [1]},
    ],
    "day23-hidden-talent-1": [
        {"type": "title", "head": ["HIDDEN", "TALENT", "#1"]},
        {"type": "content", "head": ["[NAME]"], "body": ["Overlooked for [X] months.", "Felt invisible. Nearly gave up."]},
        {"type": "content", "head": ["THEN —", "ONE MATCH"], "body": ["The right role.", "The right leader who saw it."]},
        {"type": "content", "head": ["NOW", "THRIVING"], "body": ["[Result — promoted / found purpose /", "finally seen]."]},
        {"type": "cta", "head": ["EVERYONE IS", "A DIAMOND.", "YOUR TURN?"], "gold": [1]},
    ],
}


if __name__ == "__main__":
    total = 0
    for name, slides in CAROUSELS.items():
        for i, sl in enumerate(slides, 1):
            render_slide(sl, os.path.join(OUT, f"{name}-{i}.png"))
            total += 1
        print(f"{name}: {len(slides)} slides")
    print(f"\nTotal {total} carousel slides in {OUT}")
