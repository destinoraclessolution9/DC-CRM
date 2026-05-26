"""
Follow 24 targets via per-nickname search.
For each target: search by nickname -> Users tab -> find Follow -> tap.
Foreground guard before every tap. Stop on any block signal.
"""
import subprocess, time, json, re, urllib.parse, sys
from pathlib import Path

ADB = r'C:\Users\DC\platform-tools\adb.exe'
TARGETS = Path('C:/Users/DC/AppData/Local/Temp/_targets_filler2.jsonl')
LOG = Path('C:/Users/DC/AppData/Local/Temp/_follow_log2.txt')
UI = Path('C:/Users/DC/AppData/Local/Temp/ui_users.xml')

def sh(cmd):
    return subprocess.run(cmd, capture_output=True, text=True).stdout

def shell(cmd):
    return sh([ADB, 'shell', cmd])

def adb(*args):
    return sh([ADB, *args])

def fan_num(s):
    s = s.replace('Fans', '').strip().replace(',', '').strip()
    try:
        if s.endswith(('k','K')):
            return int(float(s[:-1])*1000)
        if s.endswith(('w','万')):
            return int(float(s[:-1])*10000)
        return int(float(s))
    except Exception:
        return -1

def dump_users():
    shell('uiautomator dump /sdcard/ui.xml')
    adb('pull', '/sdcard/ui.xml', str(UI))

def parse():
    x = UI.read_text(encoding='utf-8')
    nodes = re.findall(r'text="([^"]+)"[^>]*bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"', x)
    rows = []
    nicks, fans, follows = [], [], []
    for t, x1, y1, x2, y2 in nodes:
        x1, y1, x2, y2 = int(x1), int(y1), int(x2), int(y2)
        cy = (y1+y2)//2
        cx = (x1+x2)//2
        if t.startswith('Fans '):
            fans.append((cy, fan_num(t)))
        elif t in ('Follow', 'Following'):
            follows.append((cy, cx, t))
        elif y1 > 400 and y2-y1 < 100 and 'RED ID' not in t and t not in ('All','Users','Products','Images','Search','Followers','Likes & Saves'):
            if x1 < 1000 and cx < 900:
                nicks.append((cy, cx, t))
    for ny, nx, nick in nicks:
        mf = None
        for fy, fc in fans:
            if 0 < fy - ny < 130 and fc >= 0:
                mf = fc; break
        mfb = None
        for fy, fx, ft in follows:
            if abs(fy - ny) < 130 and fx > 700:
                mfb = (fx, fy, ft); break
        if mf is None or mfb is None:
            continue
        rows.append({'nick': nick, 'fans': mf, 'fx': mfb[0], 'fy': mfb[1], 'state': mfb[2]})
    return rows

def foreground():
    out = shell('dumpsys window | grep mCurrentFocus')
    return 'xhs' in out or 'GlobalSearch' in out

def follow_one(target):
    nick = target['nick']
    enc = urllib.parse.quote(nick)
    shell(f"am start -a android.intent.action.VIEW -d 'xhsdiscover://search/result?keyword={enc}'")
    time.sleep(3)
    if not foreground():
        return {'nick': nick, 'status': 'FG_LOST', 'note': 'not in xhs'}
    # tap Users tab
    shell('input tap 290 363')
    time.sleep(2)
    dump_users()
    rows = parse()
    # find exact nick match first; else partial
    match = None
    for r in rows:
        if r['nick'] == nick:
            match = r; break
    if match is None:
        for r in rows:
            if nick in r['nick'] or r['nick'] in nick:
                match = r; break
    if match is None:
        return {'nick': nick, 'status': 'NOT_FOUND', 'note': f'{len(rows)} users in results'}
    if match['state'] == 'Following':
        return {'nick': nick, 'status': 'ALREADY', 'fans': match['fans']}
    # tap Follow
    shell(f'input tap {match["fx"]} {match["fy"]}')
    time.sleep(2)
    # verify by re-dumping and checking state flipped
    dump_users()
    rows2 = parse()
    new_state = None
    for r in rows2:
        if r['nick'] == match['nick']:
            new_state = r['state']; break
    if new_state == 'Following':
        return {'nick': nick, 'status': 'OK', 'fans': match['fans']}
    else:
        return {'nick': nick, 'status': 'FAIL_TAP', 'note': f'state still {new_state}'}

def main():
    targets = []
    with TARGETS.open(encoding='utf-8') as f:
        for L in f:
            if L.strip():
                targets.append(json.loads(L))
    log = []
    ok = 0; fails = 0; consecutive_fails = 0
    for i, t in enumerate(targets, 1):
        if consecutive_fails >= 3:
            log.append(json.dumps({'idx': i, 'status': 'STOP_BLOCK', 'note': '3 fails in a row'}, ensure_ascii=False))
            sys.stdout.write(f'[{i}] STOP - consecutive fails\n'); sys.stdout.flush()
            break
        res = follow_one(t)
        res['idx'] = i
        log.append(json.dumps(res, ensure_ascii=False))
        # write log after every step (incremental)
        LOG.write_text('\n'.join(log), encoding='utf-8')
        if res['status'] == 'OK':
            ok += 1; consecutive_fails = 0
        elif res['status'] == 'ALREADY':
            consecutive_fails = 0  # not a fail
        else:
            fails += 1; consecutive_fails += 1
        sys.stdout.write(f'[{i:2d}] {res["status"]:<10} fans={res.get("fans","?")}\n'); sys.stdout.flush()
        # human pacing
        time.sleep(4)
    sys.stdout.write(f'\nDONE: {ok} OK, {fails} fails\n')

if __name__ == '__main__':
    main()
