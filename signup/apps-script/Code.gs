/**
 * במה פתוחה – צד השרת של ההרשמה (signup/ בריפו).
 *
 * מדביקים את הקובץ הזה ב-Extensions → Apps Script של גיליון Google Sheets,
 * מריצים פעם אחת את setup (לאישור הרשאות וליצירת הגיליונות), ואז Deploy → New deployment → Web app
 * עם Execute as: Me ו-Who has access: Anyone. ההוראות המלאות ב-signup/README.md.
 *
 * ציבורי:
 *   GET  …/exec?action=list    → {ok, open, rows:[{n,time,song,performers,done,notes}]}   (בלי טלפונים)
 *   GET  …/exec?action=status  → {ok, open}
 *   POST …/exec {"song","performers","phone"}  → {ok, number} | {ok:false, error:'closed'|'duplicate'|…}
 * ניהול (דורש key מגיליון "הגדרות"):
 *   POST {"action":"admin","key"}                  → {ok, open, rows:[… כולל phone]}
 *   POST {"action":"setOpen","key","open":true}    → {ok, open}
 *   POST {"action":"remove","key","ns":[3,7]}      → {ok, removed}
 */

const SHEET_NAME = 'הרשמות';
const OLD_HEADERS = ['#', 'זמן', 'שיר', 'מבצעים', 'בוצע', 'הערות'];   // הגרסה הראשונה, בלי טלפון
const SETTINGS_NAME = 'הגדרות';
const HEADERS = ['#', 'זמן', 'שיר', 'מבצעים', 'טלפון', 'בוצע', 'הערות'];
const ADMIN_PAGE = 'https://shiriartstein.github.io/math-open-mic/signup/admin.html';
const MAX_LEN = 120;

/** מריצים פעם אחת מהעורך: מאשר הרשאות, יוצר את הגיליונות ומדפיס את כתובת דף הניהול. */
function setup() {
  getSheet_();
  const settings = getSettings_();
  setOpen_(isOpen_());                 // מנרמל את תא המתג (B2) לתיבת סימון אמיתית
  console.log('דף הניהול: ' + settings.getRange('B3').getValue());
}

function doGet(e) {
  const p = (e && e.parameter) || {};
  const action = p.action || 'list';
  if (action === 'ping') return json_({ ok: true });
  if (action === 'status') return json_({ ok: true, open: isOpen_() });
  return json_({ ok: true, open: isOpen_(), rows: readRows_(false) });
}

function doPost(e) {
  let body = {};
  try {
    body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
  } catch (err) {
    return json_({ ok: false, error: 'bad json' });
  }
  const action = body.action || 'signup';
  if (action === 'signup') return signup_(body);

  if (!checkKey_(body.key)) return json_({ ok: false, error: 'bad key' });
  if (action === 'admin') return json_({ ok: true, open: isOpen_(), rows: readRows_(true) });
  if (action === 'setOpen') { setOpen_(body.open === true); return json_({ ok: true, open: isOpen_() }); }
  if (action === 'remove') return remove_(body.ns);
  return json_({ ok: false, error: 'unknown action' });
}

/* ---------- sign-up ---------- */

function signup_(body) {
  const song = clean_(body.song);
  const performers = clean_(body.performers);
  const digits = phoneDigits_(body.phone);
  if (!song || !performers || !digits) return json_({ ok: false, error: 'missing fields' });
  if (digits.length < 9 || digits.length > 15) return json_({ ok: false, error: 'bad phone' });

  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    if (!isOpen_()) return json_({ ok: false, error: 'closed' });
    const sheet = getSheet_();
    const dup = findByPhone_(sheet, digits);
    if (dup) return json_({ ok: false, error: 'duplicate', number: dup.n, song: dup.song });
    const number = nextNumber_(sheet);
    appendRow_(sheet, [number, new Date(), song, performers, formatPhone_(digits), false, '']);
    SpreadsheetApp.flush();
    return json_({ ok: true, number: number });
  } finally {
    lock.releaseLock();
  }
}

function remove_(ns) {
  if (!Array.isArray(ns) || !ns.length) return json_({ ok: false, error: 'nothing to remove' });
  const wanted = {};
  ns.forEach(function (n) { wanted[String(n)] = true; });

  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    const sheet = getSheet_();
    const last = sheet.getLastRow();
    let removed = 0;
    if (last >= 2) {
      const col = sheet.getRange(2, 1, last - 1, 1).getValues();
      for (let i = col.length - 1; i >= 0; i--) {          // מלמטה למעלה, כדי שהאינדקסים לא יזוזו
        if (col[i][0] !== '' && wanted[String(col[i][0])]) {
          sheet.deleteRow(i + 2);
          removed++;
        }
      }
    }
    SpreadsheetApp.flush();
    return json_({ ok: true, removed: removed });
  } finally {
    lock.releaseLock();
  }
}

/* ---------- sheets ---------- */

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
  ensureLayout_(sheet);
  return sheet;
}

/** גיליון ריק מקבל כותרת; גיליון מהגרסה הראשונה (בלי עמודת טלפון) מוסב אוטומטית. */
function ensureLayout_(sheet) {
  if (sheet.getLastRow() === 0) {
    writeHeader_(sheet);
    return;
  }
  const header = sheet.getRange(1, 1, 1, HEADERS.length).getValues()[0].map(String);
  if (header.join('|') === HEADERS.join('|')) return;
  if (header.slice(0, OLD_HEADERS.length).join('|') !== OLD_HEADERS.join('|')) return;   // כותרת לא מוכרת: לא נוגעים

  // גרסה ישנה: שומרים רק שורות אמיתיות, מנקים הכול (כולל תיבות הסימון שמילאו 2000 שורות), וכותבים מחדש
  const last = sheet.getLastRow();
  const old = last > 1 ? sheet.getRange(2, 1, last - 1, OLD_HEADERS.length).getValues() : [];
  const keep = old.filter(function (r) { return r[2] || r[3]; });
  sheet.getRange(1, 1, Math.max(last, 1), 26).clearDataValidations();
  sheet.clear();
  writeHeader_(sheet);
  keep.forEach(function (r, i) {
    appendRow_(sheet, [i + 1, r[1], String(r[2] || ''), String(r[3] || ''), '', r[4] === true, String(r[5] || '')]);
  });
}

function writeHeader_(sheet) {
  sheet.appendRow(HEADERS);
  sheet.getRange(1, 1, 1, HEADERS.length).setFontWeight('bold');
  sheet.setFrozenRows(1);
  sheet.getRange('A2:A5000').setNumberFormat('0');
  sheet.getRange('B2:B5000').setNumberFormat('dd/MM HH:mm:ss');
  sheet.getRange('C2:E5000').setNumberFormat('@');   // טקסט בלבד: לא נוסחאות, ולא אובדן אפס מוביל בטלפון
  [50, 110, 300, 220, 130, 60, 220].forEach(function (w, i) { sheet.setColumnWidth(i + 1, w); });
  sheet.setRightToLeft(true);
}

/** מוסיף שורה ושם תיבת סימון רק בעמודת "בוצע" של אותה שורה (תיבות מראש היו נספרות כתוכן). */
function appendRow_(sheet, values) {
  sheet.appendRow(values);
  const cell = sheet.getRange(sheet.getLastRow(), 6);
  cell.insertCheckboxes();
  if (values[5] === true) cell.setValue(true);
}

function getSettings_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let s = ss.getSheetByName(SETTINGS_NAME);
  if (!s) {
    s = ss.insertSheet(SETTINGS_NAME);
    const key = Utilities.getUuid().replace(/-/g, '').slice(0, 16);
    s.getRange('A1:B3').setValues([
      ['מפתח ניהול', key],
      ['הרשמה פתוחה', false],
      ['דף הניהול', ADMIN_PAGE + '#' + key]
    ]);
    s.getRange('B1').setNumberFormat('@');
    s.getRange('B3').setNumberFormat('@');
    s.getRange('B2').insertCheckboxes();          // B2 נשאר בפורמט רגיל: פורמט "טקסט" הופך TRUE למחרוזת
    s.getRange('A1:A3').setFontWeight('bold');
    s.setColumnWidth(1, 130);
    s.setColumnWidth(2, 560);
    s.setRightToLeft(true);
  }
  return s;
}

function adminKey_() {
  return String(getSettings_().getRange('B1').getValue() || '').trim();
}

function checkKey_(k) {
  const real = adminKey_();
  return !!real && typeof k === 'string' && k.trim() === real;
}

function isOpen_() {
  const v = getSettings_().getRange('B2').getValue();
  return v === true || String(v).trim().toUpperCase() === 'TRUE';
}

function setOpen_(v) {
  const cell = getSettings_().getRange('B2');
  cell.setNumberFormat('General');   // מתקן תא שנשאר בפורמט "טקסט" (גרסה קודמת), אחרת TRUE נשמר כמחרוזת והמתג "נכבה" לבד
  cell.insertCheckboxes();
  cell.setValue(v === true);
  SpreadsheetApp.flush();
}

/* ---------- rows ---------- */

function nextNumber_(sheet) {
  const last = sheet.getLastRow();
  if (last < 2) return 1;
  let max = 0;
  sheet.getRange(2, 1, last - 1, 1).getValues().forEach(function (r) {
    const v = Number(r[0]);
    if (isFinite(v) && v > max) max = v;
  });
  return max + 1;
}

function findByPhone_(sheet, digits) {
  const last = sheet.getLastRow();
  if (last < 2) return null;
  const values = sheet.getRange(2, 1, last - 1, HEADERS.length).getValues();
  for (let i = 0; i < values.length; i++) {
    if (phoneDigits_(values[i][4]) === digits) {
      return { n: values[i][0], song: String(values[i][2] || '') };
    }
  }
  return null;
}

function readRows_(withPhone) {
  const sheet = getSheet_();
  const last = sheet.getLastRow();
  if (last < 2) return [];
  const values = sheet.getRange(2, 1, last - 1, HEADERS.length).getValues();
  const rows = [];
  values.forEach(function (r) {
    if (!r[2] && !r[3]) return;             // שורות ריקות
    const row = {
      n: r[0] === '' ? '' : Number(r[0]) || String(r[0]),
      time: r[1] instanceof Date ? r[1].toISOString() : String(r[1] || ''),
      song: String(r[2] || ''),
      performers: String(r[3] || ''),
      done: r[5] === true,
      notes: String(r[6] || '')
    };
    if (withPhone) row.phone = String(r[4] || '');
    rows.push(row);
  });
  return rows;
}

/* ---------- helpers ---------- */

function clean_(v) {
  return String(v == null ? '' : v)
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[=+@]+/, '')
    .trim()
    .slice(0, MAX_LEN);
}

/** ספרות בלבד; קידומת בינלאומית של ישראל הופכת ל-0 (‎+972-54… → 054…). */
function phoneDigits_(v) {
  let d = String(v == null ? '' : v).replace(/\D/g, '');
  if (d.indexOf('00972') === 0) d = '0' + d.slice(5);
  else if (d.indexOf('972') === 0 && d.length >= 11) d = '0' + d.slice(3);
  return d.slice(0, 20);
}

function formatPhone_(d) {
  if (d.length === 10 && d.charAt(0) === '0') return d.slice(0, 3) + '-' + d.slice(3);
  if (d.length === 9 && d.charAt(0) === '0') return d.slice(0, 2) + '-' + d.slice(2);
  return d;
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
