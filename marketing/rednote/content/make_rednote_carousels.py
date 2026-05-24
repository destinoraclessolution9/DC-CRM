# -*- coding: utf-8 -*-
"""DNJ 小红书 图文合集生成器 — 藏青/白, 3:4 (1080x1440), 中文.
每条合集 = 多张图: 封面(title) + 内容(content) + 结尾(cta).
跑法: python make_rednote_carousels.py  -> 输出到 ./carousels/  (dnj-dayN-1.png ...)
改文案: 编辑下面 CAROUSELS 字典再重跑.
"""
import os
from PIL import Image, ImageDraw, ImageFont

OUT = r"C:\Users\DC\Desktop\DestinOraclesSolution CRM\marketing\rednote\content\carousels"
os.makedirs(OUT, exist_ok=True)

W, H = 1080, 1440
NAVY = (30, 42, 94); NAVY_DEEP = (20, 30, 70)
WHITE = (255, 255, 255); OFFWHITE = (228, 233, 247)
ACCENT = (150, 170, 235); LINE = (70, 84, 140)

YAHEI_BD = r"C:\Windows\Fonts\msyhbd.ttc"
YAHEI = r"C:\Windows\Fonts\msyh.ttc"


def load(fp, size):
    return ImageFont.truetype(fp, size)


def fit(lines, maxf, maxw, fp=YAHEI_BD, minf=40):
    im = Image.new("RGB", (10, 10)); d = ImageDraw.Draw(im)
    s = maxf
    while s > minf:
        f = load(fp, s)
        if max(d.textlength(ln, font=f) for ln in lines) <= maxw:
            return s
        s -= 3
    return s


def wrap_cjk(text, font, maxw, d):
    lines, cur = [], ""
    for ch in text:
        if d.textlength(cur + ch, font=font) <= maxw:
            cur += ch
        else:
            if cur:
                lines.append(cur)
            cur = ch
    if cur:
        lines.append(cur)
    return lines


def bg():
    img = Image.new("RGB", (W, H), NAVY); d = ImageDraw.Draw(img)
    for i in range(H):
        t = i / (H - 1)
        d.line([(0, i), (W, i)], fill=(
            int(NAVY[0]*(1-t)+NAVY_DEEP[0]*t),
            int(NAVY[1]*(1-t)+NAVY_DEEP[1]*t),
            int(NAVY[2]*(1-t)+NAVY_DEEP[2]*t)))
    return img


def border(d):
    d.rounded_rectangle([40, 40, W-40, H-40], radius=30, outline=LINE, width=3)


def diamond(d, cx, cy, sz, col, w=3):
    p = [(cx, cy-sz), (cx+sz*0.85, cy), (cx, cy+sz), (cx-sz*0.85, cy)]
    for i in range(4):
        d.line([p[i], p[(i+1) % 4]], fill=col, width=w)
    d.line([(cx-sz*0.85, cy), (cx+sz*0.85, cy)], fill=col, width=2)
    d.line([(cx, cy-sz), (cx, cy+sz)], fill=col, width=2)


def ctext(d, cx, y, text, font, fill):
    bb = d.textbbox((0, 0), text, font=font)
    d.text((cx - (bb[2]-bb[0])/2 - bb[0], y), text, fill=fill, font=font)


def render(slide, path):
    img = bg(); d = ImageDraw.Draw(img); border(d)
    cx = W // 2
    if slide["type"] == "title":
        head = slide["head"]
        sz = fit(head, 140, W-220)
        f = load(YAHEI_BD, sz)
        step = int(sz*1.4); total = step*(len(head)-1)+sz
        sy = (H-total)/2 - 60
        for i, ln in enumerate(head):
            ctext(d, cx, sy+i*step, ln, f, WHITE)
        d.line([(cx-70, sy+total+44), (cx+70, sy+total+44)], fill=ACCENT, width=5)
        ctext(d, cx, H-190, "右滑了解 →", load(YAHEI_BD, 38), ACCENT)
    elif slide["type"] == "content":
        y = 250
        if slide.get("kicker"):
            ctext(d, cx, y, slide["kicker"], load(YAHEI_BD, 50), ACCENT)
            y += 96
        head = slide.get("head", [])
        if head:
            hsz = fit(head, 96, W-200)
            hf = load(YAHEI_BD, hsz)
            for ln in head:
                ctext(d, cx, y, ln, hf, WHITE)
                y += int(hsz*1.2)
        y += 40
        bf = load(YAHEI, 46)
        wrapped = []
        for para in slide.get("body", []):
            wrapped += wrap_cjk(para, bf, W-220, d)
        for ln in wrapped:
            ctext(d, cx, y, ln, bf, OFFWHITE)
            y += 66
    elif slide["type"] == "cta":
        head = slide["head"]; hi = slide.get("hi", [])
        sz = fit(head, 110, W-240)
        f = load(YAHEI_BD, sz)
        step = int(sz*1.42); total = step*(len(head)-1)+sz
        sy = (H-total)/2 - 130
        for i, ln in enumerate(head):
            bb = d.textbbox((0, 0), ln, font=f)
            x = cx - (bb[2]-bb[0])/2 - bb[0]; y = sy+i*step
            if i in hi:
                d.rounded_rectangle([x+bb[0]-30, y+bb[1]-14, x+bb[2]+30, y+bb[3]+14], radius=20, fill=WHITE)
                d.text((x, y), ln, fill=NAVY, font=f)
            else:
                d.text((x, y), ln, fill=WHITE, font=f)
        diamond(d, cx, H-300, 34, ACCENT, 4)
        ctext(d, cx, H-235, "DNJ", load(YAHEI_BD, 72), WHITE)
        ctext(d, cx, H-120, "diamondandjeweler.com", load(YAHEI, 30), OFFWHITE)
    img.save(path, "PNG", optimize=True)


CAROUSELS = {
    "dnj-day1": [
        {"type": "title", "head": ["有些人", "不是没天赋", "只是没被看见"]},
        {"type": "content", "kicker": "投了几十份简历", "head": ["石沉大海"], "body": ["不是你不够好。", "是你被埋在一堆简历里，", "没人翻到你那一页。"]},
        {"type": "content", "kicker": "我们相信", "head": ["每个人都是钻石"], "body": ["只是还没遇见", "对的珠宝匠。"]},
        {"type": "content", "kicker": "这里会聊", "head": ["真相 · 干货 · 故事"], "body": ["求职的扎心真相、", "面试谈薪干货、", "还有被低估的人后来怎么发光。"]},
        {"type": "cta", "head": ["关注我", "陪你一起", "被看见"], "hi": [2]},
    ],
    "dnj-day2": [
        {"type": "title", "head": ["为什么", "我做了 DNJ"]},
        {"type": "content", "kicker": "求职的人", "head": ["海投到怀疑人生"], "body": ["投100份，回复不到3个，", "开始怀疑自己。"]},
        {"type": "content", "kicker": "招人的公司", "head": ["翻到眼花"], "body": ["收到200份简历，", "还是没找到对的人。"]},
        {"type": "content", "kicker": "中间缺的", "head": ["不是人不够"], "body": ["是没人帮对的人和", "对的机会，精准对上。"]},
        {"type": "cta", "head": ["你是钻石", "我们帮你找到", "对的珠宝匠"], "hi": [0]},
    ],
    "dnj-day10": [
        {"type": "title", "head": ["3个简历错误", "让你", "彻底隐形"]},
        {"type": "content", "kicker": "错误 1", "head": ["写职责，不写成果"], "body": ["「负责社媒运营」没人记住。", "「3个月粉丝从0到1万」才亮眼。"]},
        {"type": "content", "kicker": "错误 2", "head": ["一份简历投所有"], "body": ["针对每个岗位，", "改前3行最关键的描述。"]},
        {"type": "content", "kicker": "错误 3", "head": ["全是形容词"], "body": ["「抗压能力强」是废话。", "用数字和事例证明。"]},
        {"type": "cta", "head": ["改完这3点", "让 AI", "帮你匹配"], "hi": [1]},
    ],
    "dnj-day16": [
        {"type": "title", "head": ["没人敢说的", "招聘真相"]},
        {"type": "content", "kicker": "真相 ①", "head": ["自信 > 能力"], "body": ["很多公司招的是会表现的人，", "不是最能做事的人。"]},
        {"type": "content", "kicker": "真相 ②", "head": ["最能打的最安静"], "body": ["团队里最能打的，", "往往是最安静的那个。"]},
        {"type": "content", "kicker": "真相 ③", "head": ["「回去等通知」"], "body": ["九成，", "是委婉的拒绝。"]},
        {"type": "cta", "head": ["我们只看", "契合", "不看声量"], "hi": [1]},
    ],
    "dnj-day29": [
        {"type": "title", "head": ["5个", "面试回答", "先收藏"]},
        {"type": "content", "kicker": "请自我介绍", "head": ["90秒公式"], "body": ["现在 → 过去亮点 → 为什么这岗位。"]},
        {"type": "content", "kicker": "你的缺点", "head": ["真诚但不自杀"], "body": ["真实小缺点 +", "你正在怎么改。"]},
        {"type": "content", "kicker": "为什么离职", "head": ["面向未来"], "body": ["聊向往的方向，", "不吐槽前东家。"]},
        {"type": "content", "kicker": "你有问题吗", "head": ["一定要问"], "body": ["问团队、问成长、问期待。"]},
        {"type": "cta", "head": ["收藏起来", "面试前", "再看一遍"], "hi": [1]},
    ],
    "dnj-day45": [
        {"type": "title", "head": ["5步谈薪法", "第4步", "最多人漏"]},
        {"type": "content", "kicker": "第1步", "head": ["做功课"], "body": ["查同岗位市场价：", "行业 + 城市 + 年限。"]},
        {"type": "content", "kicker": "第2步", "head": ["让对方先开口"], "body": ["先问预算区间，", "别自己先报数字。"]},
        {"type": "content", "kicker": "第3步", "head": ["用价值还价"], "body": ["基于你能带来的，", "不是「我想要更多」。"]},
        {"type": "content", "kicker": "第4步", "head": ["谈整个 package"], "body": ["底薪之外：花红、津贴、", "年假、远程、成长。"]},
        {"type": "content", "kicker": "第5步", "head": ["白纸黑字"], "body": ["谈好的一切，", "写进 offer 再签。"]},
        {"type": "cta", "head": ["会谈的人", "都懂自己的", "价值"], "hi": [2]},
    ],
    "dnj-day60": [
        {"type": "title", "head": ["8周", "5个求职真相"]},
        {"type": "content", "kicker": "1", "head": ["你不是没天赋"], "body": ["只是没被看见。"]},
        {"type": "content", "kicker": "2", "head": ["写成果不写职责"], "body": ["用数字说话。"]},
        {"type": "content", "kicker": "3", "head": ["谈薪别先报数字"], "body": ["谈整个 package。"]},
        {"type": "content", "kicker": "4", "head": ["契合度 > 自信表演"], "body": ["对的环境才能发光。"]},
        {"type": "content", "kicker": "5", "head": ["每个人都是钻石"], "body": ["只是需要对的珠宝匠。"]},
        {"type": "cta", "head": ["关注我", "第二阶段", "更猛"], "hi": [1]},
    ],
}


if __name__ == "__main__":
    total = 0
    for name, slides in CAROUSELS.items():
        for i, sl in enumerate(slides, 1):
            render(sl, os.path.join(OUT, name + "-" + str(i) + ".png"))
            total += 1
        print(name + ": " + str(len(slides)) + " slides")
    print("Total " + str(total) + " slides -> " + OUT)
