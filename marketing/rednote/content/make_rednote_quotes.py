# -*- coding: utf-8 -*-
"""DNJ 小红书 语录卡生成器 — 藏青/白, 3:4 (1080x1440), 中文.
金句行用白色高亮药丸(navy 字), 其余白字. 配色: 藏青 #1E2A5E + 白. 绝不用金色.
跑法: python make_rednote_quotes.py  -> 输出到 ./quotes/
改文案: 编辑下面 QUOTES 列表再重跑.
"""
import os
from PIL import Image, ImageDraw, ImageFont

OUT = r"C:\Users\DC\Desktop\DestinOraclesSolution CRM\marketing\rednote\content\quotes"
os.makedirs(OUT, exist_ok=True)

W, H = 1080, 1440
NAVY = (30, 42, 94)        # #1E2A5E
NAVY_DEEP = (20, 30, 70)
WHITE = (255, 255, 255)
OFFWHITE = (232, 236, 248)
ACCENT = (150, 170, 235)   # 淡蓝, 用于引号/钻石
LINE = (70, 84, 140)

YAHEI_BD = r"C:\Windows\Fonts\msyhbd.ttc"
YAHEI = r"C:\Windows\Fonts\msyh.ttc"
SERIF = r"C:\Windows\Fonts\simsun.ttc"

# (文件名, [金句行], [高亮行索引])
QUOTES = [
    ("q-day5",   ["最安静的候选人", "往往是最强的", "那一个"], [1]),
    ("q-day12",  ["你的出身", "不决定", "你的未来"], [2]),
    ("q-day19",  ["有时候被拒绝", "不是你不够好", "是你太好了"], [2]),
    ("q-day25",  ["钻石", "不会偶然遇见", "它的珠宝匠"], [1]),
    ("q-day32",  ["被低薪绑架", "不代表", "你不值钱"], [2]),
    ("q-day39",  ["好公司不是找到人才", "而是", "点亮人才"], [2]),
    ("q-day46",  ["每个人", "都是一颗钻石", "只是需要对的切割"], [1]),
    ("q-day53",  ["一个对的机会", "能改变", "整个人生轨迹"], [2]),
    ("q-day64",  ["千里马常有", "而伯乐", "不常有"], [2]),
    ("q-day71",  ["会埋没人才的老板", "终究", "留不住人"], [2]),
    ("q-day78",  ["被低估", "不等于", "不优秀"], [2]),
    ("q-day84",  ["选对池塘", "鱼才", "游得远"], [2]),
    ("q-day94",  ["对的机会", "会让你", "整个人发光"], [2]),
    ("q-day101", ["与其投100份", "不如等", "对的3个"], [2]),
    ("q-day108", ["最好的招聘", "不是", "大海捞针"], [2]),
    ("q-day114", ["你不是不行", "你只是", "没被看见"], [2]),
]


def load(fp, size):
    return ImageFont.truetype(fp, size)


def fit(lines, maxf, maxw, fp=YAHEI_BD, minf=44):
    im = Image.new("RGB", (10, 10)); d = ImageDraw.Draw(im)
    s = maxf
    while s > minf:
        f = load(fp, s)
        if max(d.textlength(ln, font=f) for ln in lines) <= maxw:
            return s
        s -= 4
    return s


def bg():
    img = Image.new("RGB", (W, H), NAVY); d = ImageDraw.Draw(img)
    for i in range(H):
        t = i / (H - 1)
        d.line([(0, i), (W, i)], fill=(
            int(NAVY[0]*(1-t)+NAVY_DEEP[0]*t),
            int(NAVY[1]*(1-t)+NAVY_DEEP[1]*t),
            int(NAVY[2]*(1-t)+NAVY_DEEP[2]*t)))
    return img


def diamond(d, cx, cy, sz, col, w=4):
    p = [(cx, cy-sz), (cx+sz*0.85, cy), (cx, cy+sz), (cx-sz*0.85, cy)]
    for i in range(4):
        d.line([p[i], p[(i+1) % 4]], fill=col, width=w)
    d.line([(cx-sz*0.85, cy), (cx+sz*0.85, cy)], fill=col, width=2)
    d.line([(cx, cy-sz), (cx, cy+sz)], fill=col, width=2)


def make(name, lines, hi):
    img = bg(); d = ImageDraw.Draw(img)
    d.rounded_rectangle([40, 40, W-40, H-40], radius=30, outline=LINE, width=3)
    # 开引号
    d.text((70, 64), "“", fill=ACCENT, font=load(SERIF, 240))
    # 金句主体
    size = fit(lines, 132, W-260)
    f = load(YAHEI_BD, size)
    step = int(size * 1.46)
    total = step * (len(lines) - 1) + size
    sy = (H - total) / 2 - 10
    for i, ln in enumerate(lines):
        bb = d.textbbox((0, 0), ln, font=f)
        tw = bb[2] - bb[0]
        x = (W - tw) / 2 - bb[0]
        y = sy + i * step
        if i in hi:
            gx0, gy0, gx1, gy1 = x+bb[0], y+bb[1], x+bb[2], y+bb[3]
            d.rounded_rectangle([gx0-32, gy0-16, gx1+32, gy1+16], radius=22, fill=WHITE)
            d.text((x, y), ln, fill=NAVY, font=f)
        else:
            d.text((x, y), ln, fill=WHITE, font=f)
    # 页脚
    diamond(d, W//2, H-210, 26, ACCENT, 3)
    bf = load(YAHEI_BD, 46)
    w = d.textlength("DNJ", font=bf)
    d.text(((W-w)/2, H-160), "DNJ", fill=WHITE, font=bf)
    uf = load(YAHEI, 26)
    u = "diamondandjeweler.com"
    w = d.textlength(u, font=uf)
    d.text(((W-w)/2, H-98), u, fill=OFFWHITE, font=uf)
    img.save(os.path.join(OUT, name + ".png"), "PNG", optimize=True)


if __name__ == "__main__":
    for name, lines, hi in QUOTES:
        make(name, lines, hi)
    print(str(len(QUOTES)) + " quote cards -> " + OUT)
    for fn in sorted(os.listdir(OUT)):
        print("  " + fn)
