# -*- coding: utf-8 -*-
"""DNJ 小红书 通用封面生成器 — 藏青/白, 3:4 (1080x1440), 中文.
给视频笔记 / 任意一天做封面: 大标题 + 可选小标签(kicker) + 高亮行 + 品牌页脚.
跑法: python make_rednote_covers.py  -> 输出到 ./covers/  (cover-dayN.png)
加新封面: 在 COVERS 里加一行 (文件名, kicker, [标题行], [高亮行索引]).
"""
import os
from PIL import Image, ImageDraw, ImageFont

OUT = r"C:\Users\DC\Desktop\DestinOraclesSolution CRM\marketing\rednote\content\covers"
os.makedirs(OUT, exist_ok=True)

W, H = 1080, 1440
NAVY = (30, 42, 94); NAVY_DEEP = (20, 30, 70)
WHITE = (255, 255, 255); OFFWHITE = (228, 233, 247)
ACCENT = (150, 170, 235); LINE = (70, 84, 140)

YAHEI_BD = r"C:\Windows\Fonts\msyhbd.ttc"
YAHEI = r"C:\Windows\Fonts\msyh.ttc"

# (文件名, kicker小标签, [标题行], [高亮行索引])
COVERS = [
    ("cover-day3",   "求职真相", ["投了73份简历", "0回复"], [1]),
    ("cover-day4",   "POV", ["面试聊得超好", "结果「回去等通知」"], [1]),
    ("cover-day6",   "", ["你只是", "一颗还没被打磨的", "原石"], [2]),
    ("cover-day8",   "谁懂啊", ["要经验", "才有经验", "的死循环"], [2]),
    ("cover-day9",   "POV", ["初级岗位", "要求5年经验"], [1]),
    ("cover-day11",  "", ["拒信 vs 已读不回", "哪个", "更伤"], [2]),
    ("cover-day13",  "求职真相", ["没人告诉你的", "3件事"], [1]),
    ("cover-day15",  "扎心", ["公司招的是自信", "不是能力"], [1]),
    ("cover-day17",  "", ["CGPA", "衡量不了", "你的拼劲"], [1]),
    ("cover-day20",  "HR只花6秒", ["你的简历", "为什么", "被秒刷"], [2]),
    ("cover-day22",  "", ["最有才华的人", "往往", "最安静"], [2]),
    ("cover-day24",  "", ["你不是落后", "你只是", "还没被发现"], [2]),
    ("cover-day26",  "不是你的错", ["你在错地方的", "5个信号"], [1]),
    ("cover-day52",  "POV", ["沉默几个月后", "终于收到 offer"], [1]),
    ("cover-day59",  "", ["如果你正", "觉得被忽视", "看这条"], [1]),
    ("cover-day98",  "15秒看懂", ["DNJ", "是什么"], [0]),
    ("cover-day100", "", ["不用海投", "AI帮你", "精准匹配3个"], [2]),
    ("cover-day119", "", ["如果你正被埋没", "看完", "这一条"], [1]),
    ("cover-day120", "120天", ["DNJ", "相信的事"], [0]),
    # —— 求职赛道首批 10 条爆款封面 (caption-bank-hot10-jobseeker.md) ——
    ("cover-hot1",  "应届生必看", ["投100份简历", "0回复", "错在这3点"], [1]),
    ("cover-hot2",  "POV", ["面试聊得超好", "却「等通知」"], [1]),
    ("cover-hot3",  "附模板", ["简历改1处", "HR多看你6秒"], [1]),
    ("cover-hot4",  "海归回马", ["别再海投", "AI帮你", "精准匹配3个"], [2]),
    ("cover-hot5",  "谈薪", ["别先报数字", "5步谈出", "你该得的"], [0]),
    ("cover-hot6",  "", ["CGPA普通", "≠你不行"], [1]),
    ("cover-hot7",  "招聘真相", ["HR不会明说的", "3个真相"], [1]),
    ("cover-hot8",  "裸辞第28天", ["我想对正在", "gap的你说"], [1]),
    ("cover-hot9",  "面试加分", ["自我介绍", "90秒模板"], [1]),
    ("cover-hot10", "附清单", ["面试反问", "这样问加分"], [1]),
]


def load(fp, size):
    return ImageFont.truetype(fp, size)


def fit(lines, maxf, maxw, fp=YAHEI_BD, minf=46):
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


def diamond(d, cx, cy, sz, col, w=3):
    p = [(cx, cy-sz), (cx+sz*0.85, cy), (cx, cy+sz), (cx-sz*0.85, cy)]
    for i in range(4):
        d.line([p[i], p[(i+1) % 4]], fill=col, width=w)
    d.line([(cx-sz*0.85, cy), (cx+sz*0.85, cy)], fill=col, width=2)
    d.line([(cx, cy-sz), (cx, cy+sz)], fill=col, width=2)


def ctext(d, cx, y, text, font, fill):
    bb = d.textbbox((0, 0), text, font=font)
    d.text((cx - (bb[2]-bb[0])/2 - bb[0], y), text, fill=fill, font=font)


def make(name, kicker, head, hi):
    img = bg(); d = ImageDraw.Draw(img)
    d.rounded_rectangle([40, 40, W-40, H-40], radius=30, outline=LINE, width=3)
    cx = W // 2
    # 顶部品牌小标签
    diamond(d, 92, 104, 16, ACCENT, 3)
    d.text((118, 86), "DNJ · 被低估的天赋", fill=ACCENT, font=load(YAHEI_BD, 30))
    # kicker
    sz = fit(head, 138, W-200)
    f = load(YAHEI_BD, sz)
    step = int(sz*1.42); total = step*(len(head)-1)+sz
    sy = (H-total)/2 - 30
    if kicker:
        kf = load(YAHEI_BD, 52)
        ky = sy - 120
        ctext(d, cx, ky, "—— " + kicker + " ——", kf, ACCENT)
    for i, ln in enumerate(head):
        bb = d.textbbox((0, 0), ln, font=f)
        x = cx - (bb[2]-bb[0])/2 - bb[0]; y = sy + i*step
        if i in hi:
            d.rounded_rectangle([x+bb[0]-32, y+bb[1]-16, x+bb[2]+32, y+bb[3]+16], radius=22, fill=WHITE)
            d.text((x, y), ln, fill=NAVY, font=f)
        else:
            d.text((x, y), ln, fill=WHITE, font=f)
    # 页脚
    ctext(d, cx, H-150, "diamondandjeweler.com", load(YAHEI, 28), OFFWHITE)
    img.save(os.path.join(OUT, name + ".png"), "PNG", optimize=True)


if __name__ == "__main__":
    for name, kicker, head, hi in COVERS:
        make(name, kicker, head, hi)
    print(str(len(COVERS)) + " covers -> " + OUT)
    for fn in sorted(os.listdir(OUT)):
        print("  " + fn)
