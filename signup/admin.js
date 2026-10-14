(() => {
  'use strict';

  const $ = id => document.getElementById(id);
  const endpoint = String((window.SIGNUP_CONFIG || {}).endpoint || '').trim();
  const KEY_STORE = 'openmic-admin-key';
  const REFRESH_MS = 10000;
  const timeFmt = new Intl.DateTimeFormat('he-IL', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jerusalem' });
  const clockFmt = new Intl.DateTimeFormat('he-IL', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

  let key = '';
  let rows = [];
  let open = null;
  let loading = false;
  let busy = false;                        // a removal / toggle in progress: pause auto-refresh
  const selected = new Set();              // numbers (n) of ticked rows

  /* ---------- password: remembered on this device; a #hash in the URL is also accepted ---------- */

  function forgetKey() {
    key = '';
    try { localStorage.removeItem(KEY_STORE); } catch (e) { /* ignore */ }
    if (location.hash) history.replaceState(null, '', location.pathname + location.search);
  }

  function readKey() {
    const fromHash = decodeURIComponent(location.hash.replace(/^#(key=)?/, '')).trim();
    if (fromHash) {
      key = fromHash;
      try { localStorage.setItem(KEY_STORE, key); } catch (e) { /* ignore */ }
      history.replaceState(null, '', location.pathname + location.search);   // keep the password out of the address bar
      return;
    }
    try { key = (localStorage.getItem(KEY_STORE) || '').trim(); } catch (e) { key = ''; }
  }

  function askKey(msg) {
    $('keyCard').hidden = false;
    $('panel').hidden = true;
    $('keyInput').value = '';
    $('keyError').hidden = !msg;
    if (msg) $('keyError').textContent = msg;
  }

  $('keySave').addEventListener('click', () => {
    const k = $('keyInput').value.trim();
    if (!k) return;
    key = k;
    try { localStorage.setItem(KEY_STORE, key); } catch (e) { /* ignore */ }
    $('keyError').hidden = true;
    $('keyCard').hidden = true;
    $('panel').hidden = false;
    load();
  });
  $('keyInput').addEventListener('keydown', ev => { if (ev.key === 'Enter') $('keySave').click(); });
  $('logout').addEventListener('click', () => { forgetKey(); askKey(); });

  /* ---------- backend ---------- */

  async function call(body) {
    const res = await fetch(endpoint, { method: 'POST', body: JSON.stringify(Object.assign({ key }, body)) });
    const out = await res.json();
    if (!out) throw new Error('empty');
    if (out.error === 'bad key') { forgetKey(); askKey('הסיסמה לא נכונה.'); throw new Error('bad key'); }
    if (!out.ok) throw new Error(out.error || 'server');
    return out;
  }

  function status(msg, isError) {
    $('status').textContent = msg;
    $('status').className = 'status' + (isError ? ' error' : '');
  }

  /* ---------- rendering ---------- */

  function telHref(phone) {
    let d = String(phone || '').replace(/\D/g, '');
    if (d.startsWith('00972')) d = '0' + d.slice(5);
    else if (d.startsWith('972') && d.length >= 11) d = '0' + d.slice(3);
    if (d.startsWith('0')) d = '972' + d.slice(1);
    return 'tel:+' + d;
  }

  function renderToggle() {
    const t = $('toggle');
    t.disabled = open === null;
    t.textContent = open === null ? '…' : open ? 'ההרשמה פתוחה ✓ (לחצו לסגירה)' : 'ההרשמה סגורה ✗ (לחצו לפתיחה)';
    t.className = 'toggle ' + (open ? 'on' : 'off');
  }

  function updateBatch() {
    const n = selected.size;
    $('removeSelected').disabled = n === 0 || busy;
    $('removeSelected').textContent = `להסיר את המסומנים (${n})`;
    $('selectAll').checked = rows.length > 0 && rows.every(r => r.n === '' || selected.has(r.n));
  }

  function render() {
    const existing = new Set(rows.map(r => r.n));
    for (const n of [...selected]) if (!existing.has(n)) selected.delete(n);
    const hideDone = $('hideDone').checked;

    const frag = document.createDocumentFragment();
    for (const r of rows) {
      if (hideDone && r.done) continue;
      const li = document.createElement('li');
      li.className = 'arow' + (r.done ? ' done' : '');

      const pick = document.createElement('input');
      pick.type = 'checkbox';
      pick.className = 'pick';
      pick.disabled = r.n === '';
      pick.checked = selected.has(r.n);
      pick.setAttribute('aria-label', 'לסמן');
      pick.addEventListener('change', () => { pick.checked ? selected.add(r.n) : selected.delete(r.n); updateBatch(); });
      li.append(pick);

      const n = document.createElement('span');
      n.className = 'n';
      n.textContent = r.n === '' ? '–' : r.n;
      li.append(n);

      const info = document.createElement('div');
      info.className = 'info';
      const who = document.createElement('div'); who.className = 'who'; who.textContent = r.performers;
      const what = document.createElement('div'); what.className = 'what'; what.textContent = r.song;
      const meta = document.createElement('div'); meta.className = 'meta';
      if (r.phone) {
        const a = document.createElement('a');
        a.href = telHref(r.phone);
        a.textContent = r.phone;
        a.dir = 'ltr';
        meta.append('📞 ', a);
      } else {
        meta.append('📞 אין טלפון');
      }
      const t = new Date(r.time);
      if (!isNaN(t)) meta.append(' · ' + timeFmt.format(t));
      if (r.notes) meta.append(' · ' + r.notes);
      info.append(who, what, meta);
      li.append(info);

      const actions = document.createElement('div');
      actions.className = 'actions';

      const mark = document.createElement('button');
      mark.type = 'button';
      mark.className = 'mark' + (r.done ? ' undo' : '');
      mark.textContent = r.done ? 'לבטל "בוצע"' : 'בוצע ✓';
      mark.disabled = r.n === '' || busy;
      mark.addEventListener('click', () => setDone(r.n, !r.done));
      actions.append(mark);

      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'remove';
      del.textContent = 'הסרה';
      del.disabled = r.n === '' || busy;
      del.addEventListener('click', () => removeRows([r.n], `להסיר לגמרי את ההרשמה של ${r.performers} (${r.song})?`));
      actions.append(del);

      li.append(actions);

      frag.append(li);
    }
    $('rows').replaceChildren(frag);
    $('empty').hidden = rows.length > 0;
    $('empty').textContent = rows.length ? '' : 'עדיין לא נרשם אף אחד.';
    const pending = rows.filter(r => !r.done).length;
    $('count').textContent = rows.length + ' נרשמו' + (pending < rows.length ? ' · ' + pending + ' ממתינים' : '');
    renderToggle();
    updateBatch();
  }

  /* ---------- actions ---------- */

  async function load() {
    if (!endpoint) { status('ההרשמה עדיין לא הופעלה: חסרה כתובת ב-signup/config.js (ראו README.md).', true); $('count').textContent = '0'; return; }
    if (!key) { askKey(); return; }
    if (loading || busy) return;
    loading = true;
    try {
      const out = await call({ action: 'admin' });
      rows = out.rows;
      open = out.open === true;
      render();
      status('עודכן ב-' + clockFmt.format(new Date()));
    } catch (e) {
      if (e.message !== 'bad key') status('לא הצלחתי להתעדכן, מנסה שוב בעוד רגע…', true);
    } finally {
      loading = false;
    }
  }

  async function removeRows(ns, question) {
    if (!ns.length || busy) return;
    if (!window.confirm(question)) return;
    busy = true;
    updateBatch();
    status('מסיר…');
    try {
      const out = await call({ action: 'remove', ns });
      ns.forEach(n => selected.delete(n));
      status(`הוסרו ${out.removed} הרשמות`);
    } catch (e) {
      if (e.message !== 'bad key') status('ההסרה לא הצליחה, נסו שוב.', true);
    } finally {
      busy = false;
    }
    load();
  }

  async function setDone(n, done) {
    if (busy) return;
    busy = true;
    status(done ? 'מסמן כבוצע…' : 'מבטל סימון…');
    try {
      await call({ action: 'setDone', n, done });
      const row = rows.find(r => r.n === n);
      if (row) { row.done = done; render(); }
      status(done ? 'סומן כבוצע' : 'הסימון בוטל');
    } catch (e) {
      if (e.message !== 'bad key') status('הסימון לא נשמר, נסו שוב.', true);
    } finally {
      busy = false;
    }
    load();
  }

  $('hideDone').addEventListener('change', render);

  $('removeSelected').addEventListener('click', () => {
    const ns = [...selected];
    removeRows(ns, ns.length === 1 ? 'להסיר הרשמה אחת?' : `להסיר ${ns.length} הרשמות? אי אפשר לבטל.`);
  });

  $('selectAll').addEventListener('change', ev => {
    for (const r of rows) if (r.n !== '') ev.target.checked ? selected.add(r.n) : selected.delete(r.n);
    render();
  });

  $('toggle').addEventListener('click', async () => {
    if (busy || open === null) return;
    busy = true;
    $('toggle').disabled = true;
    try {
      const out = await call({ action: 'setOpen', open: !open });
      open = out.open === true;
      status(open ? 'ההרשמה נפתחה' : 'ההרשמה נסגרה');
    } catch (e) {
      if (e.message !== 'bad key') status('השינוי לא הצליח, נסו שוב.', true);
    } finally {
      busy = false;
      renderToggle();
    }
    load();
  });

  $('refresh').addEventListener('click', load);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) load(); });

  /* ---------- start ---------- */

  readKey();
  if (key) { $('panel').hidden = false; } else { askKey(); }
  load();
  setInterval(load, REFRESH_MS);
})();
