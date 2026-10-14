(() => {
  'use strict';

  const $ = id => document.getElementById(id);
  const endpoint = String((window.SIGNUP_CONFIG || {}).endpoint || '').trim();
  const REFRESH_MS = 10000;
  const timeFmt = new Intl.DateTimeFormat('he-IL', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jerusalem' });
  const clockFmt = new Intl.DateTimeFormat('he-IL', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

  let rows = [];
  let loading = false;

  function status(msg, isError) {
    $('status').textContent = msg;
    $('status').className = 'status' + (isError ? ' error' : '');
  }

  function render() {
    const shown = rows;
    const frag = document.createDocumentFragment();
    for (const r of shown) {
      const li = document.createElement('li');
      li.className = 'row' + (r.done ? ' done' : '');
      const t = new Date(r.time);
      for (const [cls, value] of [['n', r.n], ['who', r.performers], ['t', isNaN(t) ? '' : timeFmt.format(t)], ['what', r.song]]) {
        const e = document.createElement(cls === 'n' || cls === 't' ? 'span' : 'div');
        e.className = cls;
        e.textContent = value == null ? '' : String(value);
        li.append(e);
      }
      frag.append(li);
    }
    $('rows').replaceChildren(frag);
    $('empty').hidden = shown.length > 0;
    const pending = rows.filter(r => !r.done).length;
    $('count').textContent = rows.length + ' נרשמו' + (pending < rows.length ? ' · ' + pending + ' ממתינים' : '');
  }

  async function load() {
    if (!endpoint) {
      status('ההרשמה עדיין לא הופעלה: חסרה כתובת ב-signup/config.js (ראו README.md).', true);
      $('count').textContent = '0';
      return;
    }
    if (loading) return;
    loading = true;
    try {
      const url = endpoint + (endpoint.includes('?') ? '&' : '?') + 'action=list&_=' + Date.now();
      const res = await fetch(url, { cache: 'no-store' });
      const out = await res.json();
      if (!out || !out.ok || !Array.isArray(out.rows)) throw new Error('bad response');
      rows = out.rows;
      render();
      status('עודכן ב-' + clockFmt.format(new Date()));
    } catch (e) {
      status('לא הצלחתי להתעדכן, מנסה שוב בעוד רגע…', true);
    } finally {
      loading = false;
    }
  }

  $('refresh').addEventListener('click', load);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) load(); });

  load();
  setInterval(load, REFRESH_MS);
})();
