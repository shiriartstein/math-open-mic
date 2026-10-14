/**
 * במה פתוחה – צד השרת של ההרשמה (signup/ בריפו).
 *
 * מדביקים את הקובץ הזה ב-Extensions → Apps Script של גיליון Google Sheets,
 * מריצים פעם אחת את setup (לאישור הרשאות), ואז Deploy → New deployment → Web app
 * עם Execute as: Me ו-Who has access: Anyone. ההוראות המלאות ב-signup/README.md.
 *
 * GET  …/exec?action=list   → {ok:true, rows:[{n,time,song,performers,done,notes}]}
 * POST …/exec  body: {"song":"…","performers":"…"}  → {ok:true, number:N}
 */

const SHEET_NAME = 'הרשמות';
const HEADERS = ['#', 'זמן', 'שיר', 'מבצעים', 'בוצע', 'הערות'];
const MAX_LEN = 120;

/** מריצים פעם אחת מהעורך: מאשר הרשאות ויוצר את שורת הכותרת. */
function setup() {
  getSheet_();
}

function doGet(e) {
  const action = (e && e.parameter && e.parameter.action) || 'list';
  if (action === 'ping') return json_({ ok: true });
  return json_({ ok: true, rows: readRows_() });
}

function doPost(e) {
  let body = {};
  try {
    body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
  } catch (err) {
    return json_({ ok: false, error: 'bad json' });
  }
  const song = clean_(body.song);
  const performers = clean_(body.performers);
  if (!song || !performers) return json_({ ok: false, error: 'missing fields' });

  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    const sheet = getSheet_();
    const number = nextNumber_(sheet);
    sheet.appendRow([number, new Date(), song, performers, false, '']);
    SpreadsheetApp.flush();
    return json_({ ok: true, number: number });
  } finally {
    lock.releaseLock();
  }
}

/* ---------- helpers ---------- */

function getSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    const first = ss.getSheets()[0];
    if (first.getLastRow() === 0 && first.getLastColumn() === 0) {
      sheet = first.setName(SHEET_NAME);
    } else {
      sheet = ss.insertSheet(SHEET_NAME);
    }
  }
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(HEADERS);
    sheet.getRange(1, 1, 1, HEADERS.length).setFontWeight('bold');
    sheet.setFrozenRows(1);
    sheet.getRange('A2:A2000').setNumberFormat('0');
    sheet.getRange('B2:B2000').setNumberFormat('dd/MM HH:mm:ss');
    sheet.getRange('C2:D2000').setNumberFormat('@');   // plain text, never formulas
    sheet.getRange('E2:E2000').insertCheckboxes();
    sheet.setColumnWidth(1, 50);
    sheet.setColumnWidth(2, 110);
    sheet.setColumnWidth(3, 300);
    sheet.setColumnWidth(4, 220);
    sheet.setColumnWidth(5, 60);
    sheet.setColumnWidth(6, 220);
    sheet.setRightToLeft(true);
  }
  return sheet;
}

function nextNumber_(sheet) {
  const last = sheet.getLastRow();
  if (last < 2) return 1;
  const prev = Number(sheet.getRange(last, 1).getValue());
  return isFinite(prev) && prev > 0 ? prev + 1 : last;
}

function readRows_() {
  const sheet = getSheet_();
  const last = sheet.getLastRow();
  if (last < 2) return [];
  const values = sheet.getRange(2, 1, last - 1, HEADERS.length).getValues();
  const rows = [];
  values.forEach(function (r) {
    if (!r[2] && !r[3]) return;             // skip empty rows
    rows.push({
      n: r[0] === '' ? '' : Number(r[0]) || String(r[0]),
      time: r[1] instanceof Date ? r[1].toISOString() : String(r[1] || ''),
      song: String(r[2] || ''),
      performers: String(r[3] || ''),
      done: r[4] === true,
      notes: String(r[5] || '')
    });
  });
  return rows;
}

function clean_(v) {
  return String(v == null ? '' : v)
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[=+@]+/, '')
    .trim()
    .slice(0, MAX_LEN);
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
