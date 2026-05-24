# -*- coding: utf-8 -*-
"""DNJ RedNote per-post logger / backup recorder.

Usage:
    python log_post.py <day>            # process posts/dayNN/
    python log_post.py <day> --no-web   # skip the Google Sheet webhook

Each post lives in its own folder:  posts/dayNN/
    info.json      {day,date,time,format,pillar,account,status,note_url,cover_hook}
    title.txt      the 标题 as posted (UTF-8)
    body.txt       the 正文 as posted (UTF-8)
    hashtags.txt   the 话题 as posted (one line or space-separated, UTF-8)
    *.png          the exact image(s) posted (live.png = optional proof screenshot)

This script then:
    1. writes posts/dayNN/meta.json   (the full self-contained record)
    2. appends one row to posts/post-log.csv   (master log, Google-Sheet importable)
    3. (optional) POSTs the record + base64 images to the Apps Script webhook
       -> mirrors into the 'DNJ RedNote · Post Log' Google Sheet + Drive folder.

Layer 1 (this folder + CSV, committed to GitHub) is the disaster-proof backup.
Layer 2 (Google Sheet/Drive via webhook) is the convenient dashboard/vault.
"""
import sys, os, json, csv, glob, base64, datetime, urllib.request

POSTS_DIR = os.path.dirname(os.path.abspath(__file__))
LOG_CSV = os.path.join(POSTS_DIR, "post-log.csv")
COLUMNS = ["day", "date", "time", "format", "pillar", "account", "title",
           "cover_hook", "description", "hashtags", "images", "image_count",
           "status", "note_url", "folder", "logged_at"]

# Optional: paste your deployed Apps Script web-app URL + shared secret here
# (or set env vars RN_WEBHOOK / RN_SECRET). Leave blank to log locally only.
WEBHOOK_URL = os.environ.get("RN_WEBHOOK", "")
WEBHOOK_SECRET = os.environ.get("RN_SECRET", "")


def read_text(path):
    with open(path, "r", encoding="utf-8") as f:
        return f.read().strip()


def main():
    if len(sys.argv) < 2:
        print("usage: python log_post.py <day> [--no-web]")
        sys.exit(1)
    day = int(sys.argv[1])
    do_web = "--no-web" not in sys.argv
    folder = os.path.join(POSTS_DIR, "day%02d" % day)
    if not os.path.isdir(folder):
        print("ERROR: folder not found: " + folder)
        sys.exit(1)

    info = json.loads(read_text(os.path.join(folder, "info.json")))
    title = read_text(os.path.join(folder, "title.txt"))
    body = read_text(os.path.join(folder, "body.txt"))
    hashtags_raw = read_text(os.path.join(folder, "hashtags.txt"))
    hashtags = hashtags_raw.split()

    imgs = sorted(os.path.basename(p) for p in glob.glob(os.path.join(folder, "*.png"))
                  if os.path.basename(p).lower() != "live.png")

    meta = {
        "day": day,
        "date": info.get("date", ""),
        "time": info.get("time", ""),
        "format": info.get("format", ""),
        "pillar": info.get("pillar", ""),
        "account": info.get("account", ""),
        "title": title,
        "cover_hook": info.get("cover_hook", ""),
        "description": body,
        "hashtags": hashtags,
        "images": imgs,
        "image_count": len(imgs),
        "status": info.get("status", "posted"),
        "note_url": info.get("note_url", ""),
        "folder": "posts/day%02d" % day,
        "logged_at": datetime.datetime.now().isoformat(timespec="seconds"),
    }

    # 1. meta.json (self-contained record)
    with open(os.path.join(folder, "meta.json"), "w", encoding="utf-8") as f:
        json.dump(meta, f, ensure_ascii=False, indent=2)

    # 2. append / update post-log.csv (utf-8-sig so Excel/Sheets read Chinese)
    rows = []
    if os.path.exists(LOG_CSV):
        with open(LOG_CSV, "r", encoding="utf-8-sig", newline="") as f:
            rows = [r for r in csv.DictReader(f) if r.get("day") != str(day)]
    row = {
        "day": day, "date": meta["date"], "time": meta["time"],
        "format": meta["format"], "pillar": meta["pillar"], "account": meta["account"],
        "title": title, "cover_hook": meta["cover_hook"], "description": body,
        "hashtags": " ".join(hashtags), "images": ", ".join(imgs),
        "image_count": len(imgs), "status": meta["status"], "note_url": meta["note_url"],
        "folder": meta["folder"], "logged_at": meta["logged_at"],
    }
    rows.append(row)
    rows.sort(key=lambda r: int(r["day"]))
    with open(LOG_CSV, "w", encoding="utf-8-sig", newline="") as f:
        w = csv.DictWriter(f, fieldnames=COLUMNS)
        w.writeheader()
        w.writerows(rows)

    print("OK day%02d: meta.json + post-log.csv updated (%d images)" % (day, len(imgs)))

    # 3. optional webhook -> Google Sheet + Drive
    if do_web and WEBHOOK_URL:
        images_b64 = []
        for name in imgs:
            with open(os.path.join(folder, name), "rb") as fh:
                images_b64.append({"name": name, "b64": base64.b64encode(fh.read()).decode()})
        payload = dict(meta)
        payload["secret"] = WEBHOOK_SECRET
        payload["images_b64"] = images_b64
        data = json.dumps(payload).encode("utf-8")
        req = urllib.request.Request(WEBHOOK_URL, data=data,
                                     headers={"Content-Type": "application/json"})
        try:
            resp = urllib.request.urlopen(req, timeout=60).read().decode()
            print("Webhook -> Google Sheet: " + resp[:200])
        except Exception as e:
            print("Webhook FAILED (local log still saved): " + str(e))
    elif do_web:
        print("(no WEBHOOK_URL set -> local/git backup only; set RN_WEBHOOK to mirror to Sheet)")


if __name__ == "__main__":
    main()
