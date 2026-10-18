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
  let busy = false;                        // a change is in progress: pause auto-refresh
  let editing = null;                      // null = editor closed, 'new' = adding, otherwise the n being edited
  let draggingN = null;                    // entry being dragged (desktop drag-and-drop)
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
    if (!out.ok) { const err = new Error(out.error || 'server'); err.data = out; throw err; }
    return out;
  }

  function status(msg, isError) {
    $('status').textContent = msg;
    $('status').className = 'status' + (isError ? ' error' : '');
  }

  /* ---------- song list for the editor (from the site's data.js) ---------- */

  const songs = String((window.EVENT_DATA || {}).songs || '').split('\n')
    .map(line => { const [title, artist] = line.trim().split('|'); return { title: (title || '').trim(), artist: (artist || '').trim() }; })
    .filter(s => s.title);
  {
    const frag = document.createDocumentFragment();
    for (const s of songs) {
      const o = document.createElement('option');
      o.value = s.artist ? `${s.title} – ${s.artist}` : s.title;
      frag.append(o);
    }
    $('songOptions').replaceChildren(frag);
  }

  /* ---------- phone helpers ---------- */

  function phoneDigits(v) {
    let d = String(v || '').replace(/\D/g, '');
    if (d.startsWith('00972')) d = '0' + d.slice(5);
    else if (d.startsWith('972') && d.length >= 11) d = '0' + d.slice(3);
    return d;
  }

  function telHref(phone) {
    let d = phoneDigits(phone);
    if (d.startsWith('0')) d = '972' + d.slice(1);
    return 'tel:+' + d;
  }

  /* ---------- rendering ---------- */

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

  function button(cls, text, disabled, onClick) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = cls;
    b.textContent = text;
    b.disabled = disabled;
    b.addEventListener('click', onClick);
    return b;
  }

  function render() {
    const existing = new Set(rows.map(r => r.n));
    for (const n of [...selected]) if (!existing.has(n)) selected.delete(n);
    const hideDone = $('hideDone').checked;

    const visible = rows.filter(r => !(hideDone && r.done));
    const frag = document.createDocumentFragment();
    for (let i = 0; i < visible.length; i++) {
      const r = visible[i];
      const noId = r.n === '';
      const li = document.createElement('li');
      li.className = 'arow' + (r.done ? ' done' : '');
      li.dataset.n = r.n;

      // drag-and-drop (desktop): drop a row onto another to place it before that row
      li.draggable = !noId;
      li.addEventListener('dragstart', ev => {
        if (noId) return ev.preventDefault();
        draggingN = r.n;
        busy = true;                                   // no auto-refresh while dragging
        li.classList.add('dragging');
        $('rows').classList.add('dragging');
        try { ev.dataTransfer.setData('text/plain', String(r.n)); } catch (e) { /* ignore */ }
      });
      li.addEventListener('dragend', () => {
        draggingN = null;
        busy = false;
        li.classList.remove('dragging');
        $('rows').classList.remove('dragging');
        for (const x of $('rows').querySelectorAll('.drop-before')) x.classList.remove('drop-before');
        load();
      });
      li.addEventListener('dragover', ev => { if (draggingN !== null && draggingN !== r.n) { ev.preventDefault(); li.classList.add('drop-before'); } });
      li.addEventListener('dragleave', () => li.classList.remove('drop-before'));
      li.addEventListener('drop', ev => {
        ev.preventDefault();
        li.classList.remove('drop-before');
        if (draggingN !== null && draggingN !== r.n) { const from = draggingN; draggingN = null; busy = false; moveEntry(from, r.n); }
      });

      const pick = document.createElement('input');
      pick.type = 'checkbox';
      pick.className = 'pick';
      pick.disabled = r.n === '';
      pick.checked = selected.has(r.n);
      pick.setAttribute('aria-label', 'לסמן');
      pick.addEventListener('change', () => { pick.checked ? selected.add(r.n) : selected.delete(r.n); updateBatch(); });
      li.append(pick);

      const order = document.createElement('div');
      order.className = 'order';
      const up = button('up', '▲', noId || busy || i === 0, () => moveEntry(r.n, visible[i - 1].n));
      up.title = 'להעלות מקום אחד';
      const down = button('down', '▼', noId || busy || i === visible.length - 1, () => moveEntry(r.n, i + 2 < visible.length ? visible[i + 2].n : null));
      down.title = 'להוריד מקום אחד';
      const jump = button('jump', '⇅', noId || busy, () => promptMove(r));
      jump.title = 'להעביר למקום אחר';
      order.append(up, down, jump);
      li.append(order);

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
      actions.append(
        button('mark' + (r.done ? ' undo' : ''), r.done ? 'לבטל "בוצע"' : 'בוצע ✓', noId || busy, () => setDone(r.n, !r.done)),
        button('edit', 'עריכה', noId || busy, () => openEditor(r)),
        button('remove', 'הסרה', noId || busy, () => removeRows([r.n], `להסיר לגמרי את ההרשמה של ${r.performers} (${r.song})?`))
      );
      li.append(actions);

      frag.append(li);
    }
    if (visible.length > 1) {
      const end = document.createElement('li');
      end.className = 'drop-end';
      end.textContent = 'גררו לכאן כדי להעביר לסוף הרשימה';
      end.addEventListener('dragover', ev => { if (draggingN !== null) { ev.preventDefault(); end.classList.add('drop-before'); } });
      end.addEventListener('dragleave', () => end.classList.remove('drop-before'));
      end.addEventListener('drop', ev => { ev.preventDefault(); if (draggingN !== null) { const from = draggingN; draggingN = null; busy = false; moveEntry(from, null); } });
      frag.append(end);
    }
    $('rows').replaceChildren(frag);
    $('empty').hidden = rows.length > 0;
    $('empty').textContent = rows.length ? '' : 'עדיין לא נרשם אף אחד.';
    const done = rows.filter(r => r.done).length;
    $('count').textContent = rows.length
      ? `${rows.length} נרשמו · ${done} בוצעו · ${rows.length - done} ממתינים`
      : '0 נרשמו';
    renderToggle();
    updateBatch();
  }

  /* ---------- reorder ---------- */

  async function moveEntry(n, before) {
    if (busy || n === before) return;
    busy = true;
    status('משנה סדר…');
    try {
      await call({ action: 'move', n, before });
      status('הסדר עודכן');
    } catch (e) {
      if (e.message === 'target not found') status('אין נרשם עם המספר הזה.', true);
      else if (e.message !== 'bad key') status('שינוי הסדר לא נשמר, נסו שוב.', true);
    } finally {
      busy = false;
    }
    load();
  }

  function promptMove(r) {
    const answer = window.prompt(`להעביר את נרשם מספר ${r.n} לפני נרשם מספר… (ריק = לסוף הרשימה)`, '');
    if (answer === null) return;
    const target = answer.trim();
    if (target === '') return moveEntry(r.n, null);
    const hit = rows.find(x => x.n !== '' && String(x.n) === target);
    if (!hit) return status('אין נרשם עם המספר הזה.', true);
    moveEntry(r.n, hit.n);
  }

  /* ---------- editor: add a new entry or edit an existing one ---------- */

  function showEditError(msg) { $('eError').textContent = msg; $('eError').hidden = false; }

  function openEditor(row) {
    editing = row ? row.n : 'new';
    $('editTitle').textContent = row ? `עריכת נרשם מספר ${row.n}` : 'הוספת נרשם';
    $('ePerformers').value = row ? row.performers : '';
    $('eSong').value = row ? row.song : '';
    $('ePhone').value = row ? row.phone || '' : '';
    $('eNotes').value = row ? row.notes || '' : '';
    $('eError').hidden = true;
    $('editCard').hidden = false;
    if ($('editCard').scrollIntoView) $('editCard').scrollIntoView({ behavior: 'smooth', block: 'start' });
    $('ePerformers').focus();
  }

  function closeEditor() {
    editing = null;
    $('editCard').hidden = true;
  }

  async function saveEditor(force) {
    if (editing === null || busy) return;
    const performers = $('ePerformers').value.trim();
    const song = $('eSong').value.trim();
    const digits = phoneDigits($('ePhone').value);
    const notes = $('eNotes').value.trim();
    $('eError').hidden = true;
    if (!performers) { $('ePerformers').focus(); return showEditError('כתבו מי שר.'); }
    if (!song) { $('eSong').focus(); return showEditError('כתבו או בחרו שיר.'); }
    if (digits && (digits.length < 9 || digits.length > 15)) { $('ePhone').focus(); return showEditError('מספר הטלפון לא נראה תקין.'); }

    const payload = { action: editing === 'new' ? 'add' : 'edit', song, performers, phone: $('ePhone').value.trim(), notes };
    if (editing !== 'new') payload.n = editing;
    if (force) payload.force = true;

    busy = true;
    $('eSave').disabled = true;
    status('שומר…');
    try {
      const out = await call(payload);
      const what = editing === 'new' ? `נוסף נרשם מספר ${out.number}` : `נרשם מספר ${editing} עודכן`;
      closeEditor();
      status(what);
    } catch (e) {
      if (e.message === 'bad key') { /* handled: login shown */ }
      else if (e.message === 'duplicate') {
        const d = e.data || {};
        busy = false; $('eSave').disabled = false;
        if (window.confirm(`הטלפון הזה כבר רשום לשיר "${d.song}" (מספר ${d.number}). לשמור בכל זאת?`)) return saveEditor(true);
        return status('לא נשמר');
      }
      else if (e.message === 'not found') showEditError('ההרשמה לא נמצאה. אולי הוסרה בינתיים.');
      else if (e.message === 'bad phone') showEditError('מספר הטלפון לא נראה תקין.');
      else if (e.message === 'missing fields') showEditError('חסר שם או שיר.');
      else showEditError('השמירה לא הצליחה. נסו שוב.');
      status('לא נשמר', true);
    } finally {
      busy = false;
      $('eSave').disabled = false;
    }
    load();
  }

  $('addNew').addEventListener('click', () => openEditor(null));
  $('eCancel').addEventListener('click', closeEditor);
  $('eSave').addEventListener('click', () => saveEditor(false));
  for (const id of ['ePerformers', 'eSong', 'ePhone', 'eNotes']) {
    $(id).addEventListener('keydown', ev => { if (ev.key === 'Enter') { ev.preventDefault(); saveEditor(false); } });
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
      if (editing !== null && ns.includes(editing)) closeEditor();
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
