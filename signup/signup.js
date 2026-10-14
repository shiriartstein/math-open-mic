(() => {
  'use strict';

  const $ = id => document.getElementById(id);
  const STORE = 'openmic-signup';
  const endpoint = String((window.SIGNUP_CONFIG || {}).endpoint || '').trim();
  const data = window.EVENT_DATA || {};

  /* ---------- header text, taken from the site's data.js ---------- */

  if (data.title) $('title').textContent = data.title;
  if (data.tagline) $('tagline').textContent = data.tagline;
  const when = [];
  if (data.date) {
    const d = new Date(data.date + 'T12:00:00');
    when.push(isNaN(d) ? data.date
      : new Intl.DateTimeFormat('he-IL', { weekday: 'long', day: 'numeric', month: 'long' }).format(d));
  }
  if (data.time) when.push(data.time);
  $('when').textContent = when.join(' · ');

  if (!endpoint) $('notReady').hidden = false;

  /* ---------- song list ---------- */

  const songs = String(data.songs || '').split('\n')
    .map((line, i) => {
      const [title, artist, lang] = line.trim().split('|');
      return { title: (title || '').trim(), artist: (artist || '').trim(), lang: (lang || '').trim(), n: i + 1 };
    })
    .filter(s => s.title);

  const label = s => s.artist ? `${s.title} – ${s.artist}` : s.title;

  const performersInput = $('performers');
  const songInput = $('song');
  const picker = $('picker');
  let selected = null;

  function renderPicker() {
    const q = songInput.value.trim().toLocaleLowerCase();
    const found = songs.filter(s => (s.title + ' ' + s.artist).toLocaleLowerCase().includes(q));
    const frag = document.createDocumentFragment();
    for (const s of found) {
      const row = document.createElement('div');
      row.className = 'song' + (selected === s ? ' selected' : '');
      row.dir = s.lang === 'en' ? 'ltr' : 'rtl';
      row.dataset.n = s.n;
      for (const [tag, cls, value] of [['span', 'num', String(s.n).padStart(2, '0')],
                                       ['strong', 'name', s.title],
                                       ['span', 'artist', s.artist || '—']]) {
        const e = document.createElement(tag);
        e.className = cls;
        e.textContent = value;
        row.append(e);
      }
      frag.append(row);
    }
    if (!found.length) {
      const none = document.createElement('div');
      none.className = 'none';
      none.textContent = songs.length ? 'השיר לא ברשימה. אפשר להירשם איתו בכל זאת.' : '';
      frag.append(none);
    }
    picker.replaceChildren(frag);
    picker.hidden = false;
  }

  songInput.addEventListener('focus', renderPicker);
  songInput.addEventListener('input', () => { selected = null; renderPicker(); });
  picker.addEventListener('click', ev => {
    const row = ev.target.closest('.song');
    if (!row) return;
    selected = songs.find(s => String(s.n) === row.dataset.n) || null;
    if (selected) songInput.value = label(selected);
    picker.hidden = true;
    hideError();
  });

  /* ---------- submit ---------- */

  const form = $('form');
  const btn = $('submit');

  function showError(msg) { $('error').textContent = msg; $('error').hidden = false; }
  function hideError() { $('error').hidden = true; }

  function showSuccess(number, song, performers) {
    $('number').textContent = number;
    $('summary').textContent = `${performers} · ${song}`;
    $('formCard').hidden = true;
    $('successCard').hidden = false;
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  form.addEventListener('submit', async ev => {
    ev.preventDefault();
    hideError();
    const performers = performersInput.value.trim();
    const song = songInput.value.trim();
    if (!performers) { performersInput.focus(); return showError('כתבו מי שר.'); }
    if (!song) { songInput.focus(); return showError('בחרו שיר מהרשימה או כתבו את שמו.'); }
    if (!endpoint) return showError('ההרשמה עדיין לא הופעלה.');

    btn.disabled = true;
    btn.textContent = 'רגע…';
    try {
      const res = await fetch(endpoint, { method: 'POST', body: JSON.stringify({ song, performers }) });
      const out = await res.json();
      if (!out || !out.ok) throw new Error(out && out.error ? out.error : 'server');
      try {
        localStorage.setItem(STORE, JSON.stringify({ number: out.number, song, performers, at: Date.now() }));
        localStorage.setItem(STORE + '-name', performers);
      } catch (e) { /* storage unavailable: fine */ }
      showSuccess(out.number, song, performers);
    } catch (e) {
      showError('ההרשמה לא הצליחה. בדקו את החיבור ונסו שוב, או פנו למארגנים ליד הבמה.');
    } finally {
      btn.disabled = false;
      btn.textContent = 'להירשם!';
    }
  });

  $('again').addEventListener('click', () => {
    selected = null;
    songInput.value = '';
    picker.hidden = true;
    $('successCard').hidden = true;
    $('formCard').hidden = false;
    songInput.focus();
  });

  /* ---------- restore state after a reload ---------- */

  try {
    const name = localStorage.getItem(STORE + '-name');
    if (name) performersInput.value = name;
    const last = JSON.parse(localStorage.getItem(STORE) || 'null');
    if (last && last.number && Date.now() - last.at < 12 * 3600 * 1000) {
      showSuccess(last.number, last.song, last.performers);
    }
  } catch (e) { /* ignore */ }
})();
