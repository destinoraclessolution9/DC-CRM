"""
Comment-only round: 10 genuine value-add comments on job-vertical posts.
Fix: switch to ADBKeyboard BEFORE tapping input. Send is TextView (not strictly clickable).
"""
import subprocess, time, json, re, urllib.parse, sys, base64, random
from pathlib import Path

ADB = r'C:\Users\DC\platform-tools\adb.exe'
UI = Path('C:/Users/DC/AppData/Local/Temp/ui.xml')
LOG = Path('C:/Users/DC/AppData/Local/Temp/_cmt_log.txt')

KEYWORDS = ['面试技巧', '求职干货', '简历模板', '应届生求职', '转行']

COMMENTS = [
    '收藏了，最近正缺这个，感谢分享 🙏',
    '简历写成果不写职责，认同',
    '反问环节我以前都说没了，下次试试',
    '谈薪我以前都先开价，吃过亏',
    '海投真不如精准投，太对了',
    '收藏~ 下周面试用得上',
    '裸辞 gap 路过，看完心情好了一点',
    '太实在了，应届生看到能少踩很多坑',
    '感谢博主真诚，干货收藏了',
    '说出了打工人心声',
]

def sh(cmd):
    return subprocess.run(cmd, capture_output=True, text=True).stdout

def shell(cmd):
    return sh([ADB, 'shell', cmd])

def adb(*a):
    return sh([ADB, *a])

def fg():
    return shell('dumpsys window | grep mCurrentFocus')

def in_xhs():
    return 'com.xingin.xhs' in fg()

def in_detail():
    return 'DetailFeedActivity' in fg() or 'NoteDetail' in fg()

def in_search():
    return 'GlobalSearch' in fg()

def dump():
    shell('uiautomator dump --compressed /sdcard/ui.xml')
    adb('pull', '/sdcard/ui.xml', str(UI))
    return UI.read_text(encoding='utf-8', errors='replace')

def find_cards(xml):
    pat = re.compile(r'resource-id="com\.xingin\.xhs:id/searchNoteCard"[^>]*bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"')
    out = []
    for m in pat.finditer(xml):
        x1, y1, x2, y2 = map(int, m.groups())
        if y1 > 500 and y2 < 2570:
            out.append(((x1+x2)//2, (y1+y2)//2))
    return out

def open_kw(kw):
    enc = urllib.parse.quote(kw)
    shell(f"am start -a android.intent.action.VIEW -d 'xhsdiscover://search/result?keyword={enc}'")
    time.sleep(3)

def comment_one(text):
    # ensure ADBKeyboard active before opening editor
    shell('ime set com.android.adbkeyboard/.AdbIME')
    time.sleep(1)
    # tap comment input on detail page
    shell('input tap 245 2497')
    time.sleep(3)  # wait for editor slide-up
    # type via broadcast
    b = base64.b64encode(text.encode('utf-8')).decode()
    shell(f"am broadcast -a ADB_INPUT_B64 --es msg '{b}'")
    time.sleep(2)
    # dump and find Send (TextView)
    xml = dump()
    pat = re.compile(r'text="(Send|发送)"[^>]*bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"')
    m = pat.search(xml)
    if not m:
        return False, 'NO_SEND', xml[:0]
    _, x1, y1, x2, y2 = m.groups()
    cx, cy = (int(x1)+int(x2))//2, (int(y1)+int(y2))//2
    shell(f'input tap {cx} {cy}')
    time.sleep(2.5)
    return True, 'OK', ''

def main():
    posted = 0
    target = 10
    log = []
    visited = set()
    bank = COMMENTS[:]
    random.shuffle(bank)

    for kw in KEYWORDS:
        if posted >= target:
            break
        open_kw(kw)
        if not in_xhs():
            sys.stdout.write(f'FG lost on kw#{KEYWORDS.index(kw)}\n'); break
        for scroll_attempt in range(6):
            if posted >= target:
                break
            xml = dump()
            cards = find_cards(xml)
            new_cards = [c for c in cards if (kw, c[1]) not in visited]
            if not new_cards:
                shell('input swipe 600 1900 600 800 400')
                time.sleep(2)
                continue
            for cx, cy in new_cards:
                if posted >= target:
                    break
                visited.add((kw, cy))
                shell(f'input tap {cx} {cy}')
                time.sleep(4)
                if not in_detail():
                    if not in_search():
                        open_kw(kw)
                    continue
                if not bank:
                    bank = COMMENTS[:]
                    random.shuffle(bank)
                ctext = bank.pop()
                ok, why, _ = comment_one(ctext)
                if ok:
                    posted += 1
                    log.append(json.dumps({'kw': kw, 'card': [cx, cy], 'comment': ctext, 'ok': True}, ensure_ascii=False))
                else:
                    # restore bank entry on fail so we try again
                    bank.append(ctext)
                    log.append(json.dumps({'kw': kw, 'card': [cx, cy], 'comment': ctext, 'ok': False, 'why': why}, ensure_ascii=False))
                LOG.write_text('\n'.join(log), encoding='utf-8')
                sys.stdout.write(f'  kw#{KEYWORDS.index(kw)} {posted}/{target} ok={ok} {why}\n'); sys.stdout.flush()
                # go back to search
                shell('input keyevent 4')  # close editor if open
                time.sleep(1)
                shell('input keyevent 4')  # exit detail
                time.sleep(1.5)
                if not in_search():
                    open_kw(kw)
                time.sleep(random.uniform(2, 3.5))
            shell('input swipe 600 1900 600 800 400')
            time.sleep(2)
    sys.stdout.write(f'\nDONE: {posted}/{target}\n')
    shell('ime set com.preff.kb.hr/com.preff.kb.LatinIME')

if __name__ == '__main__':
    main()
