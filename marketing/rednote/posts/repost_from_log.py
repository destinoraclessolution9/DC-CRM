# -*- coding: utf-8 -*-
"""DNJ RedNote — re-post everything from the backup (RECOVERY tool).

Reads post-log.csv and, for each post, re-creates it on the phone's RedNote app
via ADB: pushes that day's images, opens the composer, selects them, types the
title + 正文 + 话题, and publishes.

    python repost_from_log.py --from 1 --to 2     # range (test small first!)
    python repost_from_log.py --all
    python repost_from_log.py --day 3

PRECONDITIONS
  - Phone connected, USB debugging authorized, RedNote logged in (new account).
  - ADBKeyboard installed AND set as default IME (this script sets it).
  - GALLERY SHOULD BE CLEAN on the recovery device, so the just-pushed images are
    the first ones in the picker (selection is row-major / newest-first).

⚠️ SUPERVISE THE FIRST RUN. The picker's sort order can vary; each slide's text is
   distinct, so if the order comes out wrong, re-do that day with Claude driving
   selection by content. A proof screenshot is saved to posts/dayNN/repost-proof.png.
"""
import sys, os, csv, re, time, base64, subprocess

ADB = r"C:\Users\DC\platform-tools\adb.exe"
POSTS_DIR = os.path.dirname(os.path.abspath(__file__))
LOG_CSV = os.path.join(POSTS_DIR, "post-log.csv")
ADBKB = "com.android.adbkeyboard/.AdbIME"
PKG = "com.xingin.xhs"


def adb(*args, capture=False):
    cmd = [ADB] + list(args)
    if capture:
        return subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="replace").stdout
    subprocess.run(cmd)


def sh(cmd):
    adb("shell", cmd)


def dump():
    adb("shell", "uiautomator", "dump", "/sdcard/ui.xml")
    adb("pull", "/sdcard/ui.xml", os.path.join(POSTS_DIR, "_ui.xml"))
    with open(os.path.join(POSTS_DIR, "_ui.xml"), "r", encoding="utf-8", errors="replace") as f:
        return f.read()


def bounds_of(xml, pattern):
    """center (x,y) of first node whose tag matches `pattern` (a regex) then has bounds."""
    m = re.search(pattern + r'[^>]*?bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"', xml)
    if not m:
        return None
    x = (int(m.group(1)) + int(m.group(3))) // 2
    y = (int(m.group(2)) + int(m.group(4))) // 2
    return (x, y)


def selectable_centers(xml):
    """all album-picker checkbox centers, row-major (top->bottom, left->right)."""
    pts = []
    for m in re.finditer(r'selectableLayout"[^>]*?bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"', xml):
        x = (int(m.group(1)) + int(m.group(3))) // 2
        y = (int(m.group(2)) + int(m.group(4))) // 2
        pts.append((x, y))
    pts.sort(key=lambda p: (p[1], p[0]))
    return pts


def tap(x, y): sh("input tap %d %d" % (x, y))


def type_b64(text):
    b64 = base64.b64encode(text.encode("utf-8")).decode()
    adb("shell", "am", "broadcast", "-a", "ADB_INPUT_B64", "--es", "msg", b64)


def wake_unlock():
    sh("input keyevent KEYCODE_WAKEUP"); time.sleep(0.5)
    sh("input swipe 540 2540 540 350 150"); time.sleep(1)


def push_images(folder, names):
    sh("rm -f /sdcard/Pictures/zzrepost_*.png")
    for i, n in enumerate(names, 1):
        local = os.path.join(folder, n)
        remote = "/sdcard/Pictures/zzrepost_%02d.png" % i
        adb("push", local, remote)
        adb("shell", "am", "broadcast", "-a",
            "android.intent.action.MEDIA_SCANNER_SCAN_FILE", "-d", "file://" + remote)
        time.sleep(0.3)


def repost_day(row):
    day = int(row["day"])
    folder = os.path.join(POSTS_DIR, "day%02d" % day)
    names = [n.strip() for n in row["images"].split(",") if n.strip()]
    n = len(names)
    print("=== Day %02d : %d images ===" % (day, n))

    title = open(os.path.join(folder, "title.txt"), encoding="utf-8").read().strip()
    body = open(os.path.join(folder, "body.txt"), encoding="utf-8").read().strip()
    tags_path = os.path.join(folder, "hashtags.txt")
    tags = open(tags_path, encoding="utf-8").read().strip() if os.path.exists(tags_path) else ""
    full_body = body + ("\n\n" + tags if tags else "")

    push_images(folder, names)

    adb("shell", "am", "force-stop", PKG)
    time.sleep(1)
    adb("shell", "monkey", "-p", PKG, "-c", "android.intent.category.LAUNCHER", "1")
    time.sleep(5)
    wake_unlock()

    tap(600, 2540); time.sleep(2)                       # + compose
    xml = dump()
    ca = bounds_of(xml, r'text="Choose from album"')
    if ca: tap(*ca)
    time.sleep(3)

    xml = dump()
    pts = selectable_centers(xml)
    if len(pts) < n:
        print("  ! only %d checkboxes found (need %d) - aborting day" % (len(pts), n))
        return False
    for i in range(n):
        tap(*pts[i]); time.sleep(0.6)

    xml = dump()
    nxt = bounds_of(xml, r'text="Next[^"]*"')
    if nxt: tap(*nxt)
    time.sleep(3)
    xml = dump()
    nxt = bounds_of(xml, r'text="Next[^"]*"')
    if nxt: tap(*nxt)
    time.sleep(3)

    tap(624, 684); time.sleep(1); type_b64(title); time.sleep(1)
    tap(600, 1107); time.sleep(1); type_b64(full_body); time.sleep(1.5)

    xml = dump()
    post = bounds_of(xml, r'text="Post"')
    if post: tap(*post)
    time.sleep(5)

    adb("shell", "screencap", "-p", "/sdcard/scr.png")
    adb("pull", "/sdcard/scr.png", os.path.join(folder, "repost-proof.png"))
    print("  done -> proof: posts/day%02d/repost-proof.png  (VERIFY image order!)" % day)
    time.sleep(2)
    return True


def main():
    a = sys.argv
    lo, hi = 1, 99999
    if "--all" in a:
        pass
    elif "--day" in a:
        lo = hi = int(a[a.index("--day") + 1])
    else:
        if "--from" in a: lo = int(a[a.index("--from") + 1])
        if "--to" in a: hi = int(a[a.index("--to") + 1])

    sh("ime set " + ADBKB)
    sh("settings put system screen_off_timeout 900000")

    with open(LOG_CSV, encoding="utf-8-sig") as f:
        rows = [r for r in csv.DictReader(f) if lo <= int(r["day"]) <= hi]
    print("Re-posting %d note(s). SUPERVISE — verify each proof screenshot.\n" % len(rows))
    for r in rows:
        try:
            repost_day(r)
        except Exception as e:
            print("  ! day %s failed: %s" % (r.get("day"), e))
    print("\nDone. Restore your normal keyboard:  adb shell ime set com.preff.kb.hr/com.preff.kb.LatinIME")


if __name__ == "__main__":
    main()
