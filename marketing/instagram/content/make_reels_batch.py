"""Batch-generate DNJ text-on-screen reels for Days 61-180.

Each reel = 4 static scenes (HOOK / PAIN / SOLVE / END) × 2 sec each = 8s silent vertical MP4.
1080x1920, H.264, no audio (add trending audio in IG app before posting).

All reels follow viral-framework-2026:
  scene1 HOOK   : opening line (gold accent label + main text)
  scene2 PAIN   : the specific problem in 2 lines
  scene3 SOLVE  : the named method or reframe (gold final line)
  scene4 END    : brand strip + @dnj.ai + diamondandjeweler.com

Audio: silent. Upload via IG mobile, pick trending audio, post.
"""
import os
import numpy as np
import imageio.v2 as imageio
from PIL import Image, ImageDraw, ImageFont

# ---------- brand ----------
W, H = 1080, 1920
BLACK = (10, 10, 12); DEEP = (0, 0, 0)
GOLD = (212, 175, 55); GOLD_L = (244, 208, 100)
OFFWHITE = (240, 235, 220); DIM = (160, 155, 145)
RED = (210, 50, 60)

FONT_HEAD = r"C:\Windows\Fonts\ariblk.ttf"
FONT_BODY = r"C:\Windows\Fonts\arialbd.ttf"

FPS = 30
SCENE_SECONDS = 2  # each scene held this long
TOTAL_SCENES = 4
FRAMES_PER_SCENE = FPS * SCENE_SECONDS  # 60
OUT_DIR = r"C:\Users\DC\Desktop\DestinOraclesSolution CRM\marketing\instagram\content\reels"
os.makedirs(OUT_DIR, exist_ok=True)

SAFE_X = 100
SAFE_W = W - 2 * SAFE_X


# ---------- helpers ----------

def gradient_bg():
    img = Image.new("RGB", (W, H), BLACK); d = ImageDraw.Draw(img)
    for i in range(H):
        t = i / (H - 1)
        d.line([(0, i), (W, i)],
               fill=(int(BLACK[0] * (1 - t) + DEEP[0] * t),
                     int(BLACK[1] * (1 - t) + DEEP[1] * t),
                     int(BLACK[2] * (1 - t) + DEEP[2] * t)))
    return img


def draw_border(img):
    d = ImageDraw.Draw(img)
    d.rectangle([46, 46, W - 46, H - 46], outline=GOLD, width=3)


def draw_diamond(d, cx, cy, sz, col, w=4):
    p = [(cx, cy - sz), (cx + sz * 0.85, cy), (cx, cy + sz), (cx - sz * 0.85, cy)]
    for i in range(4):
        d.line([p[i], p[(i + 1) % 4]], fill=col, width=w)
    d.line([(cx - sz * 0.85, cy), (cx + sz * 0.85, cy)], fill=col, width=2)
    d.line([(cx, cy - sz), (cx, cy + sz)], fill=col, width=2)


def text_centered(d, text, y, font, fill):
    bb = d.textbbox((0, 0), text, font=font)
    w = bb[2] - bb[0]
    d.text(((W - w) / 2 - bb[0], y), text, fill=fill, font=font)


def fit_multi(lines, font_path, max_size, max_width=SAFE_W, min_size=44):
    im = Image.new("RGB", (10, 10)); d = ImageDraw.Draw(im)
    s = max_size
    while s > min_size:
        f = ImageFont.truetype(font_path, s)
        widths = [d.textbbox((0, 0), ln, font=f)[2] - d.textbbox((0, 0), ln, font=f)[0] for ln in lines]
        if max(widths) <= max_width:
            return f
        s -= 4
    return ImageFont.truetype(font_path, min_size)


def overlay_branding(d, scene_idx):
    """Bottom: @dnj.ai + progress dots."""
    f = ImageFont.truetype(FONT_BODY, 34)
    d.text((70, H - 95), "@dnj.ai", fill=DIM, font=f)
    # progress dots (one per scene)
    for i in range(TOTAL_SCENES):
        x = W - 80 - (TOTAL_SCENES - 1 - i) * 32
        col = GOLD if i <= scene_idx else (60, 60, 60)
        d.ellipse([x - 8, H - 88, x + 8, H - 72], fill=col)


# ---------- scene renderers ----------

def scene_hook(label, lines, gold_line_index, idx, label_color=GOLD):
    """Hook card: small gold label up top, then 2-3 big lines, last in gold."""
    img = gradient_bg(); draw_border(img); d = ImageDraw.Draw(img)

    # Top label badge
    lbf = ImageFont.truetype(FONT_HEAD, 44)
    text_centered(d, label, 260, lbf, label_color)

    # Main lines — big, auto-fit
    f = fit_multi(lines, FONT_HEAD, max_size=130, min_size=58)
    line_h = int(f.size * 1.1)
    total_h = line_h * len(lines)
    y0 = (H - total_h) // 2 - 40
    for i, ln in enumerate(lines):
        col = GOLD if i == gold_line_index else OFFWHITE
        text_centered(d, ln, y0 + i * line_h, f, col)

    overlay_branding(d, idx)
    return img


def scene_body(lines, idx):
    """Body card: 3 stacked lines (data / pain). Offwhite."""
    return scene_hook("", lines, -1, idx)  # no label, no gold


def scene_punch(label, lines, idx):
    """Solve card: small gold label, then gold punch lines (the reframe)."""
    img = gradient_bg(); draw_border(img); d = ImageDraw.Draw(img)
    lbf = ImageFont.truetype(FONT_HEAD, 44)
    text_centered(d, label, 260, lbf, GOLD_L)
    f = fit_multi(lines, FONT_HEAD, max_size=120, min_size=54)
    line_h = int(f.size * 1.08)
    total_h = line_h * len(lines)
    y0 = (H - total_h) // 2 - 40
    for i, ln in enumerate(lines):
        col = GOLD if i == len(lines) - 1 else GOLD_L
        text_centered(d, ln, y0 + i * line_h, f, col)
    overlay_branding(d, idx)
    return img


def scene_end(brand_line, idx):
    """End card: diamond + brand + URL."""
    img = gradient_bg(); draw_border(img); d = ImageDraw.Draw(img)
    draw_diamond(d, W // 2, H // 2 - 280, 80, GOLD, w=5)
    f_brand = ImageFont.truetype(FONT_HEAD, 72)
    text_centered(d, brand_line, H // 2 - 80, f_brand, OFFWHITE)
    f_dj = ImageFont.truetype(FONT_HEAD, 130)
    text_centered(d, "D&J", H // 2 + 60, f_dj, GOLD)
    f_url = ImageFont.truetype(FONT_BODY, 46)
    text_centered(d, "diamondandjeweler.com", H // 2 + 220, f_url, OFFWHITE)
    f_my = ImageFont.truetype(FONT_BODY, 36)
    text_centered(d, "Malaysia  ·  AI-matched top 3", H // 2 + 290, f_my, DIM)
    overlay_branding(d, idx)
    return img


# ---------- reel renderer ----------

def render_reel(slug, hook_label, hook_lines, hook_gold_idx,
                body_lines, solve_label, solve_lines,
                brand_line="HIDDEN TALENT MOVEMENT"):
    """Render a 4-scene reel to OUT_DIR/<slug>.mp4."""
    path = os.path.join(OUT_DIR, f"{slug}.mp4")

    s1 = np.asarray(scene_hook(hook_label, hook_lines, hook_gold_idx, 0))
    s2 = np.asarray(scene_body(body_lines, 1))
    s3 = np.asarray(scene_punch(solve_label, solve_lines, 2))
    s4 = np.asarray(scene_end(brand_line, 3))

    writer = imageio.get_writer(path, fps=FPS, codec="libx264",
                                pixelformat="yuv420p", quality=8,
                                macro_block_size=1)
    for frame in (s1, s2, s3, s4):
        for _ in range(FRAMES_PER_SCENE):
            writer.append_data(frame)
    writer.close()
    print(f"OK -> {os.path.basename(path)}")


# ---------- 70 reels Days 61-180 ----------

REELS = [
    # === PHASE 3 (Days 61-91) ===
    ("day61-salary-trap", "QUICK HACK  ·  MY", ["NEVER NAME", "YOUR NUMBER", "FIRST."], 2,
     ["60% OF MY GRADS", "UNDERPRICE BY", "RM500-1500/MO."],
     "FLIP IT.", ["ASK FOR", "THEIR BUDGET.", "ANCHOR ABOVE."],
     "RIGHT ROOM, RIGHT CUT"),

    ("day63-curveball", "POV  ·  MY", ["THE QUESTION", "NOBODY", "PREPARES FOR."], 2,
     ["'YOUR BIGGEST", "WEAKNESS?'", "(THE TRAP)"],
     "DO THIS.", ["NAME ONE.", "SHOW THE SYSTEM", "YOU BUILT."]),

    ("day64-ghost-yourself", "FRESH GRAD  ·  MY", ["4 IN 10 STOP", "AFTER 50", "REJECTIONS."], 2,
     ["THE MARKET IS", "BROKEN —", "NOT YOU."],
     "DO THIS.", ["BUILD A SYSTEM.", "NOT 100 MORE", "APPLICATIONS."]),

    ("day66-cover-email", "QUICK HACK  ·  MY", ["3 COVER LINES", "THAT GET", "REPLIES."], 2,
     ["'SAW THE ROLE.'", "'1 PROOF METRIC.'", "'15 MIN — WHEN?'"],
     "SAVE IT.", ["SHORT.", "SPECIFIC.", "SOON."]),

    ("day68-offer-letter", "BEFORE YOU SIGN  ·  MY", ["5 THINGS HMs", "WON'T BRING", "UP FIRST."], 2,
     ["NOTICE  ·  PROBATION", "BONUS  ·  OT", "TERMINATION NOTICE"],
     "ASK BEFORE.", ["LATER IS", "TOO LATE."]),

    ("day70-culture-decode", "DECODE  ·  MY", ["WHAT 'COMPANY", "CULTURE' REALLY", "MEANS."], 2,
     ["'FAST-PACED' = NO SOPs", "'FAMILY' = OT", "'FLEXIBLE' = ALWAYS ON"],
     "READ AGAIN.", ["EVERY JOB AD", "IS A CODE."]),

    ("day71-hm-spots-you", "POV  ·  MY", ["THE HM LOOKS UP", "FROM YOUR CV.", "YOU'RE IT."], 2,
     ["IT'S NEVER GPA.", "IT'S NEVER POLISH.", "IT'S ONE STORY."],
     "BRING ONE.", ["PREP 1 STORY", "BEFORE", "EVERY INTERVIEW."]),

    ("day73-wfh-question", "QUICK HACK  ·  MY", ["HOW TO ASK", "ABOUT WFH —", "WITHOUT THE NO."], 2,
     ["TORPEDO Q: 'CAN I", "WORK FROM HOME?'", "(KILLS OFFER 40%)"],
     "ASK INSTEAD.", ["'HOW DOES THE", "TEAM BALANCE", "OFFICE + REMOTE?'"]),

    ("day75-ladder", "SALARY  ·  KL  ·  2026", ["UNDERPAID IN KL?", "HERE'S THE", "REAL LADDER."], 2,
     ["JUNIOR  RM3.5-5K", "MID    RM6-9K", "SENIOR RM10-18K"],
     "AUDIT.", ["30% UNDER + 2 YRS = ", "WRONG ROOM.", "NOT UNLUCKY."]),

    ("day77-culture-fit-no", "CAREER REALITY  ·  MY", ["THE 'CULTURE", "FIT' REJECTION", "DECODED."], 2,
     ["9/10 TIMES IT MEANS", "YOU REMINDED THEM", "OF SOMEONE."],
     "REFRAME.", ["FILTER IS BROKEN.", "FIND CLEARER", "ROOMS."]),

    ("day78-resign-well", "POV  ·  MY", ["THE RESIGNATION", "CONVERSATION", "GOES WELL."], 2,
     ["'I APPRECIATE", "EVERYTHING. NEW", "ROLE. [DATE].'"],
     "STAY GENEROUS.", ["REFERENCES", "COMPOUND.", "BURN NOTHING."]),

    ("day80-counter-offer", "WALK FROM  ·  MY", ["3 COUNTER-OFFER", "RED FLAGS.", "WALK NOW."], 2,
     ["SUDDEN RM2K +", "TITLE WITHOUT SCOPE", "NEW MANAGER PROMISE"],
     "WALK.", ["THEY KEPT YOU", "CHEAP.", "NOW THEY'LL TRY AGAIN."]),

    ("day82-feedback", "QUICK HACK  ·  MY", ["HOW TO ASK", "FOR FEEDBACK", "AFTER A NO."], 2,
     ["'2 LINES — WHAT", "TIPPED IT?", "NO REPLY OK.'"],
     "30% REPLY RATE.", ["MOST 'NOs'", "BECOME", "'NEXT TIMES.'"]),

    ("day84-offer-arrives", "POV  ·  MY", ["'WE'LL GET BACK'", "BECOMES", "'WE'D LIKE TO OFFER.'"], 2,
     ["9 DAYS OF", "SILENCE.", "THEN THE EMAIL."],
     "THE GOOD WAIT.", ["RIGHT ROOMS", "DECIDE PROPERLY.", "NOT FAST."]),

    ("day85-first-job-wish", "BEFORE FIRST JOB  ·  MY", ["3 THINGS", "I WISH I'D", "KNOWN."], 2,
     ["TITLES LIE.", "SCOPE DOESN'T.", "BOSS > BRAND."],
     "TAG SOMEONE.", ["SEND TO A", "FRESH GRAD", "ABOUT TO SIGN."]),

    ("day87-tell-yourself", "QUICK HACK  ·  MY", ["'TELL ME ABOUT", "YOURSELF' —", "60 SECONDS."], 2,
     ["20s PRESENT (METRIC)", "20s PAST (LESSON)", "20s WHY THIS ROLE"],
     "OPEN STRONG.", ["NAIL THE OPEN.", "OWN THE ROOM."]),

    ("day89-plateau", "CAREER REALITY  ·  MY", ["THE 6-MONTH", "PLATEAU.", "(YOU FELT IT.)"], 2,
     ["NO NEW SCOPE.", "NO MENTOR.", "NO BOREDOM — ONLY FATIGUE."],
     "REREAD IN 30 DAYS.", ["PLATEAU = SIGNAL.", "NOT FAILURE."]),

    ("day91-wrong-offer-no", "POV  ·  MY", ["YOU SAY NO", "TO THE WRONG", "OFFER."], 2,
     ["MONEY FINE.", "BRAND DECENT.", "SOMETHING'S OFF."],
     "TRUST THE OFF.", ["RIGHT OFFER", "FEELS BORING.", "NOT MAGICAL."]),

    # === PHASE 4 (Days 92-120) ===
    ("day93-leave-signals", "WATCH FOR  ·  MY", ["WHAT BOSSES SAY", "THAT QUIETLY", "MEAN 'LEAVE'."], 2,
     ["'WHETHER THIS ROLE'", "'YOUR FIT'", "'OTHERS FEEL...'"],
     "ACT FAST.", ["2 SIGNS = APPLY.", "3 SIGNS = APPLY", "TODAY."]),

    ("day94-kerja-myth", "COLLAB  ·  @maukerja", ["BIGGEST MYTH ABOUT", "KERJA KOSONG", "LISTINGS."], 2,
     ["JOB ≠ AS ADVERTISED.", "SALARY ≠ AS POSTED.", "TITLE ≠ AS WRITTEN."],
     "READ 3 LINES.", ["SCOPE = WORKLOAD.", "RANGE = CEILING.", "SKIP-LEVEL = CHAOS."]),

    ("day96-leave-clean", "QUICK HACK  ·  MY", ["LEAVE A JOB", "WITHOUT BURNING", "BRIDGES."], 2,
     ["TELL MANAGER FIRST.", "LONGEST NOTICE.", "DOCUMENT EVERYTHING."],
     "STAY GENEROUS.", ["REFERENCES", "COMPOUND", "FOR YEARS."]),

    ("day98-salary-q-aced", "POV  ·  MY", ["YOU ACE", "THE SALARY", "QUESTION."], 2,
     ["'WHAT'S THE BUDGET", "FOR THIS ROLE?'", "(SILENCE FOLLOWS)"],
     "THEY NAME FIRST.", ["YOU MATCH TOP +", "ONE METRIC.", "+RM1.5K LANDS."]),

    ("day100-100-days", "MILESTONE  ·  MY", ["100 DAYS", "OF DNJ.", "WHAT CHANGED."], 2,
     ["15 POSTS.", "1 VIRAL REEL.", "2,000 FOLLOWERS."],
     "ONE LESSON.", ["PAIN SHARES.", "POLISH DOESN'T."]),

    ("day101-friday-meeting", "CAREER REALITY  ·  MY", ["THE 4:30 PM", "FRIDAY", "MEETING."], 2,
     ["MANAGER SAYS", "'A QUICK CHAT.'", "YOU KNOW."],
     "PREP NOW.", ["UPDATE CV.", "CALL 1 REF.", "ASK FOR 30 DAYS."]),

    ("day102-hm-wants", "COLLAB  ·  @hiredly_my", ["WHAT HMs", "REALLY", "WANT."], 2,
     ["NOT GPA.", "NOT POLISH.", "ONE SPECIFIC STORY."],
     "PREP 3.", ["ONE STORY PER", "PROBLEM THE ROLE", "SOLVES."]),

    ("day104-raise-script", "QUICK HACK  ·  MY", ["HOW TO ASK", "FOR A RAISE —", "4-LINE SCRIPT."], 2,
     ["1 PATH    2 METRICS", "3 MARKET  4 NUMBER", "(MEMORIZE)"],
     "REHEARSE.", ["DELIVERED", "CALMLY", "OPENS DOORS."]),

    ("day106-hm-finds-you", "POV  ·  PRODUCT", ["THE HM FINDS YOU", "ON DNJ", "IN 48 HOURS."], 2,
     ["NO JOB AD.", "NO 200-CV PILE.", "NO KEYWORD FILTER."],
     "SHE MESSAGES FIRST.", ["AI MATCHED YOU.", "SHE SAW YOU.", "REAL HUMAN."]),

    ("day108-3-questions", "QUICK HACK  ·  MY", ["3 QUESTIONS", "TO ASK EVERY", "INTERVIEWER."], 2,
     ["GREAT IN 90 DAYS?", "WHAT BROKE LAST?", "HOW SUCCEED IN 6M?"],
     "ASK ALL 3.", ["SIGNAL > POLISH.", "PEOPLE NOTICE."]),

    ("day109-promo-trap", "CAREER REALITY  ·  MY", ["'WE PROMOTED YOU.'", "SAME PAY.", "SAME NOTHING."], 2,
     ["NEW TITLE.", "NEW SCOPE.", "OLD PAYCHECK."],
     "30-DAY RULE.", ["NO MONEY IN 30?", "START THE", "CONVERSATION."]),

    ("day111-career-switch", "COLLAB  ·  @beautyinsider.my", ["CAREER SWITCH", "REAL TALK —", "3 MYTHS."], 2,
     ["MASTER'S NEEDED — NO", "PAY CUT FOREVER — NO", "IMPOSTER FEELING — UNIVERSAL"],
     "6-MONTH PLAN.", ["1 PORTFOLIO/WK", "1 POST/WK", "1 COFFEE/WK"]),

    ("day113-counter-no", "POV  ·  MY", ["YOU TURN DOWN", "THE", "COUNTER-OFFER."], 2,
     ["+RM2K AND THE", "TITLE YOU'D", "ALREADY ASKED FOR."],
     "WALK ANYWAY.", ["WHY THEY WANT YOU NOW", "IS WHY THE NEW", "PLACE WILL."]),

    ("day115-bullet-rewrite", "QUICK HACK  ·  MY", ["RESUME BULLET", "REWRITE.", "BEFORE / AFTER."], 2,
     ["'MANAGED SOCIAL.'", "VS", "'GREW 500 → 12K / 9M.'"],
     "EVERY BULLET.", ["NUMBER + PERIOD +", "HOW.", "OR DELETE."]),

    ("day116-burnout-truths", "COLLAB  ·  @jestinna", ["9-5 BURNOUT", "TRUTHS.", "(REAL TALK)"], 2,
     ["BURNOUT ISN'T", "TOO HARD —", "IT'S NO POINT."],
     "ASK YOURSELF.", ["RIGHT ROOM?", "WORK COMPOUNDS?", "AM I SEEN?"]),

    ("day118-non-salary", "QUICK HACK  ·  MY", ["NEGOTIATE THESE", "TOO. NOT JUST", "SALARY."], 2,
     ["SIGN-ON  ·  LEAVE +5", "EQUIPMENT  ·  PROBATION", "TITLE (SKILLS FOLLOW)"],
     "ASK FOR ALL.", ["EVERY 1 IS", "RM EQUIVALENT.", "STACKS FAST."]),

    ("day120-phase4-best", "MANIFESTO  ·  MY 2026", ["PHASE 4", "BEST-OF.", "5 TRUTHS."], 2,
     ["FILTER IS BROKEN.", "CONFIDENCE > CAP.", "NETWORK > CV."],
     "SHARE THIS.", ["IF WE DON'T", "CHANGE THE SYSTEM,", "NOBODY WILL."]),

    # === PHASE 5 (Days 121-151) ===
    ("day121-ui-demo", "PRODUCT  ·  DNJ", ["HOW DNJ", "MATCHES IN", "48 HOURS."], 2,
     ["1. PROFILE (3 MIN)", "2. AI MATCHES", "3. YOU GET TOP 3"],
     "TRY IT.", ["NO CARD NEEDED.", "diamondandjeweler.com"]),

    ("day123-win-sarah", "DNJ WIN #1  ·  MY", ["SARAH.", "6 MONTHS SILENT.", "ENDED IN 48H."], 2,
     ["92 APPLICATIONS.", "MOSTLY SILENCE.", "JOINED DNJ MONDAY."],
     "OFFER NEXT MONDAY.", ["HIDDEN TALENTS", "DON'T NEED 100 DOORS.", "ONE RIGHT ONE."]),

    ("day124-matched-not", "POV  ·  PRODUCT", ["MATCHED.", "NOT", "REJECTED."], 2,
     ["FIRST EMAIL IN", "6 MONTHS THAT'S NOT", "'UNFORTUNATELY...'"],
     "INSTEAD.", ["'WE SAW YOUR DNJ", "PROFILE AND WOULD", "LIKE TO CHAT.'"]),

    ("day126-profile-write", "QUICK HACK  ·  MY", ["WRITE A PROFILE", "THAT ACTUALLY", "GETS MATCHED."], 2,
     ["OUTCOME, NOT TITLE.", "ONE METRIC PER ROLE.", "6 SPECIFIC SKILLS."],
     "END WITH.", ["'LOOKING FOR", "[ROOM TYPE].'", "AI READS IT FIRST."]),

    ("day128-win-aaron", "DNJ WIN #2  ·  MY", ["AARON.", "3 MATCHES.", "3 DAYS."], 2,
     ["FRESH GRAD.", "1 YR INTERNSHIPS.", "50+ APPS. 0 REPLIES."],
     "DNJ FOR 14 DAYS.", ["3 MATCHES.", "1 INTERVIEW.", "1 OFFER."]),

    ("day130-silent-quit", "CAREER REALITY  ·  MY", ["THE SILENT", "QUIT.", "(YOU NOTICED?)"], 2,
     ["STOPPED SPEAKING UP.", "STARTED COUNTDOWN.", "TO 5 PM."],
     "REREAD IN 14 DAYS.", ["NEVER STAY SILENT.", "LEAVE OR REBUILD."]),

    ("day131-hr-24h", "POV  ·  MY", ["HR FINALLY CALLS", "WITHIN 24", "HOURS."], 2,
     ["NOT 2 WEEKS.", "NOT 'WE'LL BE", "IN TOUCH.'"],
     "RIGHT MATCH SIGNAL.", ["SPEED OF DECISION =", "LEVEL OF WANT."]),

    ("day133-5-profile-lines", "QUICK HACK  ·  MY", ["5 PROFILE LINES", "THAT STOP", "THE SCROLL."], 2,
     ["'TOOK X TO Y / Z'", "'BUILT THING USED BY N'", "'FIXED PROCESS, SAVED $$'"],
     "REWRITE TONIGHT.", ["'LEARNED [SKILL]'", "'LOOKING FOR", "[SPECIFIC ROOM].'"]),

    ("day135-win-founder", "DNJ WIN #3  ·  MY", ["FOUNDER HIRES", "ENGINEER —", "5 DAYS."], 2,
     ["FOUNDER PINGED MON.", "AI MATCHED TUE.", "COFFEE THU."],
     "OFFER SAT.", ["NO RECRUITER.", "NO 200-CV PILE.", "RIGHT CUT."]),

    ("day137-time-to-leave", "QUICK HACK  ·  MY", ["3 SIGNS IT'S", "TIME TO LEAVE.", "(EVEN IF YOU LOVE.)"], 2,
     ["STOPPED LEARNING 60D.", "BOSS NO LONGER PUSHING.", "YOU IN 1 YR ≠ HERE."],
     "ACT FAST.", ["LOVE THE TEAM.", "OUTGROW THE ROOM."]),

    ("day138-family-lies", "CAREER REALITY  ·  MY", ["'WE'RE LIKE", "FAMILY'", "= UNPAID OT."], 2,
     ["FAMILY DOESN'T BILL.", "FAMILY DOESN'T 'FIX", "YOUR RAISE NEXT YR.'"],
     "RED FLAG.", ["FAMILY LANGUAGE +", "CORPORATE SYSTEMS", "= GASLIT."]),

    ("day140-founder-dms", "POV  ·  PRODUCT", ["FOUNDER DMs YOU", "FROM YOUR", "DNJ PROFILE."], 2,
     ["'SAW YOUR LINE.'", "'WE'RE HIRING FOR.'", "'15 MIN THU?'"],
     "RIGHT CUT.", ["FIRST TIME YOU DIDN'T", "WRITE THE FIRST", "MESSAGE."]),

    ("day142-win-grad", "DNJ WIN #4  ·  MY", ["FRESH GRAD.", "BYPASSED 60 ATS", "REJECTIONS."], 2,
     ["0 KEYWORDS.", "0 LUCK.", "60 SILENT 'NOs'."],
     "DNJ SAW HUMAN.", ["NOT KEYWORDS.", "FIRST OFFER", "IN 7 DAYS."]),

    ("day144-budget-approved", "QUICK HACK  ·  MY", ["'BUDGET APPROVED'", "INTERVIEWS = GOLD.", "(80% CLOSE.)"], 2,
     ["ASK: START DATE", "PANEL SIZE", "DECISION TIMELINE"],
     "MOVE FAST.", ["THEY'RE READY.", "DON'T MAKE", "THEM WAIT."]),

    ("day145-restructure", "CAREER REALITY  ·  MY", ["4 SIGNS A", "RESTRUCTURE", "IS COMING."], 2,
     ["SKIP-LEVEL MEETINGS", "ALL-HANDS PROMISED", "HIRING FREEZE"],
     "CV TODAY.", ["2+ SIGNS = UPDATE.", "3+ = APPLY.", "DON'T WAIT."]),

    ("day147-yes-right", "POV  ·  MY", ["YOU SAY YES", "TO THE", "RIGHT ONE."], 2,
     ["QUIET EMAIL.", "BORING NUMBERS.", "MANAGER ANSWERED."],
     "JUST CALM.", ["NO SPREADSHEET.", "NO SECOND-GUESS.", "TRUST IT."]),

    ("day149-5-wins", "DNJ WIN MONTAGE  ·  MY", ["5 WINS.", "30 DAYS.", "1 MOVEMENT."], 2,
     ["SARAH  ·  AARON", "ENGINEER  ·  HANA", "YUSUF"],
     "NEXT WIN.", ["YOURS.", "diamondandjeweler.com"]),

    ("day150-manifesto-v2", "MANIFESTO V2  ·  MY", ["WHY WE", "BUILT", "DNJ."], 2,
     ["6 IN 10 MY GRADS", "FEEL INVISIBLE.", "SYSTEM IS BROKEN."],
     "JOIN.", ["IF YOU'VE FELT", "INVISIBLE,", "YOU'RE NOT ALONE."]),

    # === PHASE 6 (Days 152-180) — RECURRING SHOWS ===
    ("day152-meme-1", "MONDAY MEME #1", ["WHEN HR SAYS", "'FAST-PACED", "ENVIRONMENT.'"], 2,
     ["TRANSLATION:", "NO SOPs. NO MENTOR.", "YOU ARE THE SOP."],
     "TAG SOMEONE.", ["WHO SURVIVED", "ONE OF THESE."]),

    ("day154-win-hana", "WEDNESDAY WIN #1", ["HANA.", "FIRST MATCH.", "FRESH GRAD."], 2,
     ["DIPLOMA, NOT DEGREE.", "80+ REJECTIONS.", "DNJ MONDAY."],
     "OFFER FRIDAY.", ["HIDDEN TALENT", "DOESN'T NEED", "PERFECT CVs."]),

    ("day155-nego-first-try", "POV  ·  MY", ["SALARY NEGOTIATION", "WORKS FIRST", "TRY."], 2,
     ["YOU NAMED VALUE,", "NOT YOUR NUMBER.", "+RM1.2K + SIGN-ON."],
     "BORING WIN.", ["NO BIG MOMENT.", "JUST PRECISION."]),

    ("day156-friday-1", "FRIDAY REALITY #1", ["PROMOTIONS", "DON'T EQUAL", "RAISES."], 2,
     ["NEW TITLE.", "SAME PAYCHECK.", "BORROWED TITLE."],
     "30-DAY RULE.", ["NO MONEY?", "START THE", "CONVERSATION."]),

    ("day159-meme-2", "MONDAY MEME #2", ["POV: ANOTHER", "'WE'LL LET", "YOU KNOW.'"], 2,
     ["TRANSLATION:", "ALREADY KNOW.", "YOU'RE 2ND CHOICE."],
     "ROAST IT.", ["LAST 'WE'LL LET YOU KNOW'", "YOU ACTUALLY", "HEARD BACK FROM?"]),

    ("day161-win-yusuf", "WEDNESDAY WIN #2", ["YUSUF.", "2 OFFERS.", "1 WEEK."], 2,
     ["3 YRS STUCK", "AT SAME LEVEL.", "QUIETLY INVISIBLE."],
     "DNJ SURFACED HIM.", ["2 WANTED HIM.", "HE PICKED THE", "BORING ONE."]),

    ("day162-bio-1-line", "QUICK HACK  ·  MY", ["WRITE A 1-LINE", "BIO HMs", "RESPECT."], 2,
     ["'[OUTCOME] FOR", "[TEAM TYPE] VIA", "[STACK/SKILL].'"],
     "TEMPLATE.", ["END WITH 'LOOKING FOR", "[SPECIFIC ROOM].'", "DROP IT BELOW."]),

    ("day163-friday-2", "FRIDAY REALITY #2", ["THE", "LOYALTY", "TAX."], 2,
     ["8 YRS.", "4% RAISES.", "NEW HIRE +30%."],
     "FIX IT.", ["LOYALTY ISN'T", "A STRATEGY.", "VISIBILITY IS."]),

    ("day166-meme-3", "MONDAY MEME #3", ["WHEN 'AGGRESSIVE", "CULTURE' SHOWS UP", "WEEK 2."], 2,
     ["DAY 1: 'HIGH-PERF TEAM.'", "DAY 9: 3 RESIGNED.", "THE PM IS CRYING."],
     "CHAOS ≠ HIGH PERF.", ["NAME THE LIE", "EARLY.", "WALK FASTER."]),

    ("day168-win-mei", "WEDNESDAY WIN #3", ["MEI.", "SWAPPED INDUSTRY.", "30 DAYS."], 2,
     ["HOSPITALITY 7 YRS.", "1 PM CERT.", "SHOWED UP ONLINE."],
     "DNJ MATCHED.", ["3 SaaS TEAMS.", "HOSPITALITY DNA.", "REAL EDGE."]),

    ("day169-founder-pov", "POV  ·  PRODUCT", ["FOUNDER REACHES", "OUT BECAUSE OF", "YOUR PROFILE."], 2,
     ["'SAW YOUR LINE", "ABOUT [PROBLEM].'", "'WE'RE HIRING FOR IT.'"],
     "11 DAYS TO OFFER.", ["REAL EXAMPLE.", "REAL FOUNDER.", "REAL OUTCOME."]),

    ("day170-friday-3", "FRIDAY REALITY #3", ["SIDE HUSTLES.", "BECAUSE MAIN.", "DOESN'T PAY."], 2,
     ["1 IN 3 KL WORKERS", "RUNS A SIDE INCOME.", "NOT FOR FUN."],
     "FIX MAIN.", ["SIDE HUSTLE ISN'T", "THE PROBLEM.", "UNDERPAID IS."]),

    ("day173-meme-4", "MONDAY MEME #4", ["WHEN THE OFFER", "IS RM2K BELOW", "YOUR MIN."], 2,
     ["'STRETCHING.'", "'NEVER GO ABOVE.'", "'REVISIT IN 6 MO.'"],
     "WALK.", ["SOMEONE ELSE", "SAID YES FOR LESS.", "YOU'RE PLAN B."]),

    ("day175-win-montage", "WEDNESDAY WIN BEST-OF", ["5 WINS.", "30 SECONDS.", "1 MOVEMENT."], 2,
     ["SARAH  ·  AARON", "HANA  ·  YUSUF", "MEI"],
     "SAVE + SEND.", ["NEXT WIN", "IS YOURS.", "diamondandjeweler.com"]),

    ("day176-180-arc", "BRAND  ·  MY", ["HOW DNJ BECAME", "THE HOME OF", "HIDDEN TALENT."], 2,
     ["DAY 1: 0 FOLLOWERS.", "DAY 180: THOUSANDS", "OF STORIES."],
     "MOVEMENT.", ["THE MOVEMENT", "IS THE PEOPLE.", "THANK YOU."]),

    ("day177-friday-4", "FRIDAY REALITY #4", ["FIRST JOB", "AFTER A", "LONG BREAK."], 2,
     ["MARKET WON'T", "NOTICE YOU.", "RIGHT ROOM WILL."],
     "BUILD 3 THINGS.", ["STORY OF THE BREAK.", "1 SKILL SHARPENED.", "ROOM, NOT TITLE."]),

    ("day180-manifesto", "180 DAYS  ·  MY", ["180 DAYS.", "HUNDREDS OF WINS.", "ONE MOVEMENT."], 2,
     ["WE DON'T SELL DIAMONDS.", "WE DON'T SELL JOBS.", "WE CLOSE THE GAP."],
     "JOIN.", ["IF YOU'VE FELT", "INVISIBLE —", "RIGHT ROOM."]),
]


# ---------- main ----------

if __name__ == "__main__":
    total = len(REELS)
    print(f"Rendering {total} reels...\n")
    for i, r in enumerate(REELS, 1):
        slug, hook_label, hook_lines, hook_gold_idx, body_lines, solve_label, solve_lines = r[:7]
        brand_line = r[7] if len(r) > 7 else "HIDDEN TALENT MOVEMENT"
        print(f"[{i}/{total}] {slug}")
        render_reel(slug, hook_label, hook_lines, hook_gold_idx,
                    body_lines, solve_label, solve_lines, brand_line)
    print(f"\nAll {total} reels done -> {OUT_DIR}")
