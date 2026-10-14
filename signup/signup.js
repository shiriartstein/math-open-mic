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

  /* ---------- open / closed state ---------- */

  const fields = $('fields');
  let open = null;                       // null = unknown yet

  function applyState() {
    const blocked = !endpoint || open === false;
    fields.disabled = blocked;
    $('notReady').hidden = !!endpoint;
    $('closed').hidden = !(endpoint && open === false);
  }

  async function refreshStatus() {
    if (!endpoint) return;
    try {
      const res = await fetch(endpoint + (endpoint.includes('?') ? '&' : '?') + 'action=status&_=' + Date.now(), { cache: 'no-store' });
      const out = await res.json();
      open = out && out.ok ? out.open === true : null;
    } catch (e) {
      open = null;                       // unknown: let the server decide on submit
    }
    applyState();
  }

  applyState();
  refreshStatus();
  setInterval(refreshStatus, 30000);

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
  const phoneInput = $('phone');
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

  /* ---------- phone helpers ---------- */

  function phoneDigits(v) {
    let d = String(v || '').replace(/\D/g, '');
    if (d.startsWith('00972')) d = '0' + d.slice(5);
    else if (d.startsWith('972') && d.length >= 11) d = '0' + d.slice(3);
    return d;
  }

  function prettyPhone(d) {
    if (d.length === 10 && d[0] === '0') return d.slice(0, 3) + '-' + d.slice(3);
    if (d.length === 9 && d[0] === '0') return d.slice(0, 2) + '-' + d.slice(2);
    return d;
  }

  /* ---------- submit ---------- */

  const form = $('form');
  const btn = $('submit');

  function showError(msg) { $('error').textContent = msg; $('error').hidden = false; }
  function hideError() { $('error').hidden = true; }

  function showSuccess(number, song, performers, phone) {
    $('number').textContent = number;
    $('summary').textContent = `${performers} · ${song}`;
    $('callNote').textContent = phone
      ? `כשמגיע תורכם נתקשר אליכם למספר ${phone}. שימו לב לטלפון!`
      : 'כשמגיע תורכם נתקשר אליכם. שימו לב לטלפון!';
    $('formCard').hidden = true;
    $('successCard').hidden = false;
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  const MESSAGES = {
    closed: 'ההרשמה סגורה כרגע.',
    duplicate: 'מספר הטלפון הזה כבר רשום לשיר. מבקשים להירשם לשיר אחד בלבד 🙏 אם צריך לשנות משהו, פנו למארגנים ליד הבמה.',
    'bad phone': 'מספר הטלפון לא נראה תקין. בדקו אותו ונסו שוב.',
    'missing fields': 'חסר פרט בטופס. מלאו את כל השדות.'
  };

  form.addEventListener('submit', async ev => {
    ev.preventDefault();
    hideError();
    const performers = performersInput.value.trim();
    const song = songInput.value.trim();
    const digits = phoneDigits(phoneInput.value);
    if (!performers) { performersInput.focus(); return showError('כתבו מי שר.'); }
    if (!song) { songInput.focus(); return showError('בחרו שיר מהרשימה או כתבו את שמו.'); }
    if (!digits) { phoneInput.focus(); return showError('כתבו מספר טלפון נייד, כדי שנוכל להתקשר כשמגיע תורכם.'); }
    if (digits.length < 9 || digits.length > 15) { phoneInput.focus(); return showError(MESSAGES['bad phone']); }
    if (!endpoint) return showError('ההרשמה עדיין לא הופעלה.');
    if (open === false) return showError(MESSAGES.closed);

    const phone = prettyPhone(digits);
    btn.disabled = true;
    btn.textContent = 'רגע…';
    try {
      const res = await fetch(endpoint, { method: 'POST', body: JSON.stringify({ song, performers, phone }) });
      const out = await res.json();
      if (!out || !out.ok) {
        const err = out && out.error;
        if (err === 'closed') { open = false; applyState(); }
        if (err === 'duplicate' && out.song) {
          return showError(`מספר הטלפון הזה כבר רשום לשיר "${out.song}" (מספר ${out.number} בתור). מבקשים להירשם לשיר אחד בלבד 🙏 אם צריך לשנות משהו, פנו למארגנים ליד הבמה.`);
        }
        return showError(MESSAGES[err] || 'ההרשמה לא הצליחה. נסו שוב, או פנו למארגנים ליד הבמה.');
      }
      try {
        localStorage.setItem(STORE, JSON.stringify({ number: out.number, song, performers, phone, at: Date.now() }));
        localStorage.setItem(STORE + '-name', performers);
      } catch (e) { /* storage unavailable: fine */ }
      showSuccess(out.number, song, performers, phone);
    } catch (e) {
      showError('ההרשמה לא הצליחה. בדקו את החיבור ונסו שוב, או פנו למארגנים ליד הבמה.');
    } finally {
      btn.disabled = false;
      btn.textContent = 'להירשם!';
    }
  });

  /* ---------- restore state after a reload ---------- */

  try {
    const name = localStorage.getItem(STORE + '-name');
    if (name) performersInput.value = name;
    const last = JSON.parse(localStorage.getItem(STORE) || 'null');
    if (last && last.number && Date.now() - last.at < 12 * 3600 * 1000) {
      showSuccess(last.number, last.song, last.performers, last.phone);
    }
  } catch (e) { /* ignore */ }
})();
