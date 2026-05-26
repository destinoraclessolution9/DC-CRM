"""
Engagement round: like 18 + comment 10 on job-vertical search results.
Coords (from probe):
  bottomComment input center: (245, 2497)
  like button center:         (572, 2497)
  collect:                    (833, 2497)
  comment count:              (1074, 2497)
"""
import subprocess, time, json, re, urllib.parse, sys, base64, random
from pathlib import Path

ADB = r'C:\Users\DC\platform-tools\adb.exe'
UI = Path('C:/Users/DC/AppData/Local/Temp/ui.xml')
LOG = Path('C:/Users/DC/AppData/Local/Temp/_engage_log.txt')

KEYWORDS = ['面试技巧', '求职干货', '简历模板', '应届生求职', '转行', 'HR', '谈薪']

COMMENTS = [
    '收藏了，最近正缺这个，感谢分享 🙏',
    '说到点上了，简历写成果不写职责是真的关键',
    '反问环节我以前都说没了，下次试试',
    '谈薪这一块我以前都先开价，后来真的吃过亏',
    '海投真的不如精准投，太对了',
    '收藏~ 下周面试用得上',
    '裸辞 gap 路过，看完心情好了一点',
    '说出了打工人心声，「等通知」九成是拒绝',
    '太实在了，应届生看到这条就少踩很多坑',
    '感谢真诚，干货收藏了',
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

def dump(compressed=True):
    if compressed:
        shell('uiautomator dump --compressed /sdcard/ui.xml')
    else:
        shell('uiautomator dump /sdcard/ui.xml')
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

def go_back():
    shell('input keyevent 4')
    time.sleep(1.5)

def like_blind():
    shell('input tap 572 2497')
    time.sleep(1)

def comment_blind(text):
    # tap input area to expand editor
    shell('input tap 245 2497')
    time.sleep(2.5)
    # set ADBKeyboard
    shell('ime set com.android.adbkeyboard/.AdbIME')
    time.sleep(0.5)
    b = base64.b64encode(text.encode('utf-8')).decode()
    shell(f"am broadcast -a ADB_INPUT_B64 --es msg '{b}'")
    time.sleep(2)
    # find Send button via dump (dump should succeed since kb is open)
    xml = dump()
    # look for text="Send" or text="发送"
    pat = re.compile(r'text="(Send|发送)"[^>]*bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"')
    m = pat.search(xml)
    if not m:
        # try clickable with content-desc Send
        pat2 = re.compile(r'content-desc="(Send|发送)"[^>]*bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"')
        m = pat2.search(xml)
    if not m:
        # bail: close kb, go back
        shell('input keyevent 4')
        time.sleep(0.5)
        shell('ime set com.preff.kb.hr/com.preff.kb.LatinIME')
        return False, 'NO_SEND'
    _, x1, y1, x2, y2 = m.groups()
    cx, cy = (int(x1)+int(x2))//2, (int(y1)+int(y2))//2
    shell(f'input tap {cx} {cy}')
    time.sleep(2)
    return True, 'OK'

def main():
    likes_done = 0
    comments_done = 0
    target_likes = 18
    target_comments = 10
    log = []
    visited = set()
    bank = COMMENTS[:]
    random.shuffle(bank)

    for kw in KEYWORDS:
        if likes_done >= target_likes:
            break
        open_kw(kw)
        if not in_xhs():
            sys.stdout.write(f'FG lost on kw#{KEYWORDS.index(kw)}\n'); sys.stdout.flush(); break
        for scroll_attempt in range(6):
            if likes_done >= target_likes:
                break
            xml = dump()
            cards = find_cards(xml)
            new_cards = [c for c in cards if (kw, c[1]) not in visited]
            if not new_cards:
                # scroll
                shell('input swipe 600 1900 600 800 400')
                time.sleep(2)
                continue
            for cx, cy in new_cards:
                if likes_done >= target_likes:
                    break
                visited.add((kw, cy))
                shell(f'input tap {cx} {cy}')
                time.sleep(3.5)
                if not in_detail():
                    sys.stdout.write(f'  not detail after tap @{cx},{cy}\n')
                    if not in_search():
                        open_kw(kw)
                    continue
                # comment first if quota left
                did_comment = False
                if comments_done < target_comments and bank:
                    ctext = bank.pop()
                    ok, why = comment_blind(ctext)
                    if ok:
                        comments_done += 1
                        did_comment = True
                        log.append(json.dumps({'kw': kw, 'card': [cx,cy], 'comment': ctext, 'ok': True}, ensure_ascii=False))
                    else:
                        log.append(json.dumps({'kw': kw, 'card': [cx,cy], 'comment': ctext, 'ok': False, 'why': why}, ensure_ascii=False))
                    LOG.write_text('\n'.join(log), encoding='utf-8')
                # like (blind)
                like_blind()
                likes_done += 1
                log.append(json.dumps({'kw': kw, 'card': [cx,cy], 'like': True}, ensure_ascii=False))
                LOG.write_text('\n'.join(log), encoding='utf-8')
                sys.stdout.write(f'  kw#{KEYWORDS.index(kw)} likes={likes_done}/{target_likes} cmt={comments_done}/{target_comments} did_cmt={did_comment}\n')
                sys.stdout.flush()
                # back to search
                go_back()
                if not in_search():
                    go_back()
                    if not in_search():
                        open_kw(kw)
                time.sleep(random.uniform(2.5, 4))
            shell('input swipe 600 1900 600 800 400')
            time.sleep(2)
    sys.stdout.write(f'\nDONE: likes={likes_done} comments={comments_done}\n')
    shell('ime set com.preff.kb.hr/com.preff.kb.LatinIME')

if __name__ == '__main__':
    main()
