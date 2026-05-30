/**
 * Egg Purchasing → Google Sheets Append (CRM webhook)
 * ----------------------------------------------------
 * Receives a 2D array from the CRM and appends it to the first sheet of the
 * matching spreadsheet (KL or PG), with 5 blank rows above the new data.
 *
 * Safe under concurrent edits:
 *   - LockService.getDocumentLock() serializes all writes per spreadsheet.
 *     If a second CRM commit fires while the first is still writing, the
 *     second waits up to 30s for the first to finish, then re-reads
 *     getLastRow() before computing where to start. No overwrites possible.
 *   - Manual edits from people typing in the sheet are not blocked, but
 *     because we measure getLastRow() inside the lock immediately before
 *     writing, our append always lands cleanly below whatever they typed.
 *
 * DEPLOYMENT
 *   1. Go to https://script.google.com/ → New project.
 *   2. Replace the default Code.gs content with this entire file.
 *   3. Click Deploy → New deployment.
 *      - Select type: Web app
 *      - Execute as: Me (your account)
 *      - Who has access: Anyone
 *   4. Copy the Web App URL.
 *   5. In the CRM: Egg Purchasing → Config tab → set
 *        "google_sheets_webhook_url": "https://script.google.com/macros/s/.../exec"
 *      in the JSON, click Save.
 *
 * REDEPLOYMENT
 *   If you edit this file later, click Deploy → Manage deployments →
 *   pencil icon → New version → Deploy. The URL stays the same.
 */

const SHEET_IDS = {
  PG: '1HUMgJfFgWpBlqGKvIVPvWGHYL2CbZLkWOWNNm1hph-s',
  KL: '1mYVqOJhprPK3u6L7huFi3B0vJYEy1OoDkHCi0mvF2-U'
};

const BLANK_ROWS_BEFORE = 5;
const LOCK_WAIT_MS = 30000;

function doPost(e) {
  try {
    if (!e || !e.postData || !e.postData.contents) {
      return jsonError('Missing request body', 400);
    }
    const body = JSON.parse(e.postData.contents);
    const region = body.region;
    const rows = body.rows;
    if (!region || !SHEET_IDS[region]) {
      return jsonError('Invalid region: ' + region + ' (expected KL or PG)', 400);
    }
    if (!Array.isArray(rows) || rows.length === 0) {
      return jsonError('rows must be a non-empty 2D array', 400);
    }
    for (let i = 0; i < rows.length; i++) {
      if (!Array.isArray(rows[i])) {
        return jsonError('rows[' + i + '] is not an array', 400);
      }
    }

    const lock = LockService.getDocumentLock();
    const gotLock = lock.tryLock(LOCK_WAIT_MS);
    if (!gotLock) {
      return jsonError('Could not acquire document lock within ' + LOCK_WAIT_MS + 'ms', 503);
    }

    try {
      const ss = SpreadsheetApp.openById(SHEET_IDS[region]);
      const sheet = ss.getSheets()[0]; // first sheet (gid=0)
      const lastRow = sheet.getLastRow();
      // 5 blank rows above the new data → start writing on lastRow + 6.
      // If the sheet is completely empty, lastRow=0 → start at row 6.
      const startRow = lastRow + BLANK_ROWS_BEFORE + 1;

      // Pad jagged rows so setValues doesn't reject the write.
      let maxCols = 0;
      for (let i = 0; i < rows.length; i++) {
        if (rows[i].length > maxCols) maxCols = rows[i].length;
      }
      if (maxCols === 0) maxCols = 1;
      const padded = rows.map(function (r) {
        if (r.length === maxCols) return r;
        return r.concat(new Array(maxCols - r.length).fill(''));
      });

      sheet.getRange(startRow, 1, padded.length, maxCols).setValues(padded);
      SpreadsheetApp.flush();

      return jsonOk({
        region: region,
        sheetId: SHEET_IDS[region],
        startRow: startRow,
        rowsWritten: padded.length,
        colsWritten: maxCols
      });
    } finally {
      lock.releaseLock();
    }
  } catch (err) {
    return jsonError('Unhandled error: ' + (err && err.message ? err.message : String(err)), 500);
  }
}

/**
 * Optional GET handler — visit the web app URL in a browser to confirm it's
 * deployed and which sheets it knows about. Doesn't expose any data.
 */
function doGet() {
  return jsonOk({
    service: 'egg-sheets-append',
    regions: Object.keys(SHEET_IDS),
    blankRowsBefore: BLANK_ROWS_BEFORE,
    lockWaitMs: LOCK_WAIT_MS
  });
}

function jsonOk(payload) {
  const out = Object.assign({ ok: true }, payload);
  return ContentService.createTextOutput(JSON.stringify(out))
    .setMimeType(ContentService.MimeType.JSON);
}

function jsonError(message, _status) {
  // Apps Script can't set HTTP status on ContentService responses, but the
  // CRM checks the `ok` field so this is functionally equivalent.
  return ContentService.createTextOutput(JSON.stringify({ ok: false, error: message }))
    .setMimeType(ContentService.MimeType.JSON);
}
