/**
 * DNJ RedNote — Post Log endpoint (Google Apps Script Web App)  [LAYER 2: dashboard + image vault]
 *
 * What it does on each POST from log_post.py:
 *   - auto-creates (once) a Google Sheet  "DNJ RedNote · Post Log"  and remembers its ID
 *   - auto-creates a Drive folder          "DNJ RedNote Assets/dayNN/"  and stores the images
 *   - upserts one row per post (re-logging the same day overwrites that row)
 *
 * ===== ONE-TIME DEPLOY (≈2 min) =====
 * 1. https://script.google.com  ->  New project  ->  paste this whole file.
 * 2. Change SECRET below to a long random string.
 * 3. Deploy  ->  New deployment  ->  type: Web app
 *      - Execute as: Me
 *      - Who has access: Anyone with the link
 * 4. Authorize when prompted (it needs Sheets + Drive on YOUR account).
 * 5. Copy the Web app URL (ends with /exec).
 * 6. In log_post.py set  RN_WEBHOOK = <that /exec URL>  and  RN_SECRET = <same SECRET>
 *      (or export them as env vars). Done — every future log_post.py run mirrors to the Sheet.
 *
 * Health check: open the /exec URL in a browser -> should say {"ok":true,"service":"dnj-rednote-log"}.
 */

const SECRET = 'CHANGE_ME_to_a_long_random_string';
const SHEET_NAME = 'DNJ RedNote · Post Log';
const DRIVE_FOLDER = 'DNJ RedNote Assets';
const HEADERS = ['day', 'date', 'time', 'format', 'pillar', 'account', 'title',
  'cover_hook', 'description', 'hashtags', 'images', 'image_count',
  'status', 'note_url', 'folder', 'drive_link', 'logged_at'];

function doGet() {
  return out({ ok: true, service: 'dnj-rednote-log' });
}

function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);
    if (body.secret !== SECRET) return out({ ok: false, error: 'bad secret' });

    const driveLink = saveImages(body);
    const sheet = getSheet();
    const row = HEADERS.map(function (h) {
      if (h === 'drive_link') return driveLink;
      if (h === 'hashtags') return (body.hashtags || []).join(' ');
      if (h === 'images') return (body.images || []).join(', ');
      return body[h] !== undefined ? body[h] : '';
    });

    // upsert by day
    const data = sheet.getDataRange().getValues();
    let foundRow = -1;
    for (let i = 1; i < data.length; i++) {
      if (String(data[i][0]) === String(body.day)) { foundRow = i + 1; break; }
    }
    if (foundRow > 0) sheet.getRange(foundRow, 1, 1, row.length).setValues([row]);
    else sheet.appendRow(row);

    return out({ ok: true, day: body.day, drive: driveLink });
  } catch (err) {
    return out({ ok: false, error: String(err) });
  }
}

function getSheet() {
  const props = PropertiesService.getScriptProperties();
  let id = props.getProperty('SHEET_ID');
  let ss;
  if (id) {
    try { ss = SpreadsheetApp.openById(id); } catch (e) { id = null; }
  }
  if (!id) {
    ss = SpreadsheetApp.create(SHEET_NAME);
    props.setProperty('SHEET_ID', ss.getId());
  }
  let sh = ss.getSheets()[0];
  sh.setName(SHEET_NAME);
  if (sh.getLastRow() === 0) { sh.appendRow(HEADERS); sh.setFrozenRows(1); }
  return sh;
}

function saveImages(body) {
  if (!body.images_b64 || !body.images_b64.length) return '';
  const root = getOrCreateFolder(DriveApp.getRootFolder(), DRIVE_FOLDER);
  const dayName = 'day' + ('0' + body.day).slice(-2);
  const dayFolder = getOrCreateFolder(root, dayName);
  body.images_b64.forEach(function (img) {
    const ex = dayFolder.getFilesByName(img.name);
    while (ex.hasNext()) ex.next().setTrashed(true); // replace on re-log
    const blob = Utilities.newBlob(Utilities.base64Decode(img.b64), 'image/png', img.name);
    dayFolder.createFile(blob);
  });
  return dayFolder.getUrl();
}

function getOrCreateFolder(parent, name) {
  const it = parent.getFoldersByName(name);
  return it.hasNext() ? it.next() : parent.createFolder(name);
}

function out(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
