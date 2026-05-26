"""
Harvest job-vertical user candidates with fans in 5K-10K band.
Iterates keywords, scrolls Users tab, dedupes by nick.
Outputs C:/Users/DC/AppData/Local/Temp/_pool.txt (jsonl).
"""
import subprocess, sys, time, json, re, urllib.parse
from pathlib import Path

ADB = r'C:\Users\DC\platform-tools\adb.exe'
UI_PATH = '/sdcard/ui.xml'
LOCAL_UI = 'C:/Users/DC/AppData/Local/Temp/ui_users.xml'
POOL = Path('C:/Users/DC/AppData/Local/Temp/_pool.txt')

KEYWORDS = [
    '求职',
    '面试',
    '简历',
    '职场',
    '打工人',
    '应届生',
    '转行',
    '求职干货',
    '大马求职',
    '马来西亚招聘',
    'HR',
    '找工作',
]

def sh(cmd, **kw):
    return subprocess.run(cmd, shell=False, capture_output=True, text=True, **kw)

def adb(*args):
    return sh([ADB, *args])

def shell(cmd):
    return sh([ADB, 'shell', cmd])

def dump_ui():
    shell('uiautomator dump /sdcard/ui.xml')
    adb('pull', UI_PATH, LOCAL_UI)

def fan_num(s):
    s = s.replace('Fans', '').strip().replace(',', '').strip()
    try:
        if s.endswith(('k','K')):
            return int(float(s[:-1]) * 1000)
        if s.endswith(('w','万')):
            return int(float(s[:-1]) * 10000)
        return int(float(s))
    except Exception:
        return -1

def parse_users():
    x = Path(LOCAL_UI).read_text(encoding='utf-8')
    nodes = re.findall(r'text="([^"]+)"[^>]*bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"', x)
    nicks = []
    fans = []
    follows = []
    for t, x1, y1, x2, y2 in nodes:
        x1, y1, x2, y2 = int(x1), int(y1), int(x2), int(y2)
        cy = (y1+y2)//2
        cx = (x1+x2)//2
        if t.startswith('Fans '):
            fans.append((cy, fan_num(t)))
        elif t in ('Follow','Following'):
            follows.append((cy, cx, t))
        elif y1 > 400 and y2-y1 < 100 and 'RED ID' not in t and t not in ('All','Users','Products','Images','Search','Followers','Likes & Saves'):
            if x1 < 1000 and cx < 900:
                nicks.append((cy, cx, t))
    rows = []
    for ny, nx, nick in nicks:
        match_f = None
        for fy, fc in fans:
            if 0 < fy - ny < 130 and fc >= 0:
                match_f = fc
                break
        match_fb = None
        for fy, fx, ft in follows:
            if abs(fy - ny) < 130 and fx > 700:
                match_fb = (fx, fy, ft)
                break
        if match_f is None or match_fb is None:
            continue
        rows.append({'nick': nick, 'fans': match_f, 'follow_x': match_fb[0], 'follow_y': match_fb[1], 'state': match_fb[2], 'nick_x': nx, 'nick_y': ny})
    return rows

def open_search(kw):
    enc = urllib.parse.quote(kw)
    shell(f"am start -a android.intent.action.VIEW -d 'xhsdiscover://search/result?keyword={enc}'")
    time.sleep(4)
    # tap Users tab (always 2nd from left in latest UI = (259-323, 363))
    shell('input tap 290 363')
    time.sleep(2)

def main():
    seen = set()  # by nick string
    pool = []
    for kw in KEYWORDS:
        open_search(kw)
        # 3 scrolls to collect more
        for scroll in range(3):
            dump_ui()
            rows = parse_users()
            for r in rows:
                if r['nick'] in seen:
                    continue
                seen.add(r['nick'])
                r['kw'] = kw
                pool.append(r)
            # scroll up
            shell('input swipe 600 1800 600 800 400')
            time.sleep(2)
        sys.stdout.write(f'  kw#{KEYWORDS.index(kw)} -> pool size={len(pool)}\n'); sys.stdout.flush()
    # filter 5K-10K and not already Following
    in_band = [r for r in pool if 5000 <= r['fans'] <= 10000 and r['state'] == 'Follow']
    sys.stdout.write(f'TOTAL pool: {len(pool)}; in 5K-10K not-yet-followed: {len(in_band)}\n')
    POOL.write_text('\n'.join(json.dumps(r, ensure_ascii=False) for r in pool), encoding='utf-8')
    Path('C:/Users/DC/AppData/Local/Temp/_pool_band.txt').write_text(
        '\n'.join(json.dumps(r, ensure_ascii=False) for r in in_band), encoding='utf-8')

if __name__ == '__main__':
    main()
