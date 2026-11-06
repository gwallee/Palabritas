'use strict';
/* Palabritas — Spanish spelling practice PWA */

const APP_VERSION = '2.1.0';

/* ---------- helpers ---------- */
const $ = id => document.getElementById(id);
const pick = arr => arr[Math.floor(Math.random() * arr.length)];
const shuffle = arr => {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

/* ---------- storage ---------- */
const DEFAULTS = {
  lists: [],
  activeListId: null,
  paused: null,   // snapshot of an unfinished practice session (same device)
  settings: { voiceURI: '', voiceURIEn: '', rate: 0.95, strict: false, retries: 2 },
  progress: { totalPoints: 0, streak: 0, lastPracticeDate: null, mastery: {}, trouble: {} },
};

function load() {
  try {
    const raw = JSON.parse(localStorage.getItem('palabritas') || 'null');
    if (raw) return {
      ...DEFAULTS, ...raw,
      settings: { ...DEFAULTS.settings, ...(raw.settings || {}) },
      progress: { ...DEFAULTS.progress, ...(raw.progress || {}) },
    };
  } catch (e) { /* corrupted storage — start fresh */ }
  return JSON.parse(JSON.stringify(DEFAULTS));
}
let data = load();
const save = () => localStorage.setItem('palabritas', JSON.stringify(data));
const activeList = () => data.lists.find(l => l.id === data.activeListId) || null;
// Each list has a language; everything downstream (voice, sentences, hangman
// keyboard, syllables) follows it. Spanish is the default for older lists.
const listLang = listOrId => {
  const l = typeof listOrId === 'string' ? data.lists.find(x => x.id === listOrId) : listOrId;
  return l && l.lang === 'en' ? 'en' : 'es';
};
const wordKey = (listId, word) => `${listId}|${canon(word)}`;
const masteryFor = (listId, word) => data.progress.mastery[wordKey(listId, word)] || { stars: 0, clean: 0 };
const troubleFor = (listId, word) => data.progress.trouble[wordKey(listId, word)] || null;

function recordMastery(listId, word, clean) {
  const key = wordKey(listId, word);
  const old = masteryFor(listId, word);
  const nextClean = clean ? old.clean + 1 : 0;
  data.progress.mastery[key] = { clean: nextClean, stars: clean ? Math.min(3, Math.max(old.stars, nextClean)) : Math.max(0, old.stars - 1) };
  if (!clean) data.progress.trouble[key] = { misses: (troubleFor(listId, word)?.misses || 0) + 1, clean: 0, updatedAt: Date.now() };
  else if (data.progress.trouble[key]) {
    data.progress.trouble[key].clean = (data.progress.trouble[key].clean || 0) + 1;
    data.progress.trouble[key].updatedAt = Date.now();
    if (data.progress.trouble[key].clean >= 2) delete data.progress.trouble[key];
  }
}

/* ---------- word normalization ---------- */
// NFC first: pasted/scanned text can carry "n + combining tilde" instead of a
// real ñ (and split accents), which would break matching, tiles and hangman.
const canon = s => s.normalize('NFC').trim().toLowerCase().replace(/\s+/g, ' ');
// Strip accents on vowels (á→a, ü→u) but NEVER ñ→n: ñ is its own letter in Spanish.
const stripVowelAccents = s => s
  .replace(/ñ/g, '')
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(//g, 'ñ');
// Full strip (ñ→n too) — used only to color a tile "almost right".
const stripAll = c => c.normalize('NFD').replace(/[̀-ͯ]/g, '');

function matches(attempt, target) {
  const a = canon(attempt), t = canon(target);
  if (a === t) return 'exact';
  if (!data.settings.strict && stripVowelAccents(a) === stripVowelAccents(t)) return 'accents';
  return 'no';
}

/* ---------- speech ---------- */
let voices = [];
const hasSpeech = 'speechSynthesis' in window;

// iOS runs web audio in the "ambient" session, which the hardware
// ring/silent switch mutes entirely — a phone on silent plays nothing.
// 'playback' is the category that keeps sounding regardless.
// Safari 16.4+; harmless where navigator.audioSession doesn't exist.
function audioSessionPlayback() {
  try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch (e) {}
}

// Belt and braces (v2.0.2): audioSession.type alone proved flaky — sound
// worked, then a new game came up silent until the ring switch was flipped.
// iOS can hand the page's audio session back as "ambient" after an
// interruption (speech engine, lock screen, app switch). A looping, fully
// silent <audio> element is the long-standing workaround: while a media
// element plays, WebKit keeps the whole page in the playback category, so
// chimes AND speech ignore the silent switch. Started from user taps (iOS
// needs a gesture). v2.1: only on the game screens (practice / hangman / done)
// so it doesn't stop the parent's music elsewhere, and fully torn down — not
// just paused — on leaving them or hiding the app, so no lock-screen widget.
let silentLoop = null, silentUrl = null;
const GAME_VIEWS = ['practice', 'hangman', 'done'];
const inGameView = () => GAME_VIEWS.some(v => !$('view-' + v).classList.contains('hidden'));
function silentWavUrl() {
  const rate = 8000, n = rate / 2;               // 0.5 s of 8-bit mono silence
  const buf = new ArrayBuffer(44 + n), v = new DataView(buf);
  const str = (o, s) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  str(0, 'RIFF'); v.setUint32(4, 36 + n, true); str(8, 'WAVE');
  str(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, rate, true); v.setUint32(28, rate, true); v.setUint16(32, 1, true); v.setUint16(34, 8, true);
  str(36, 'data'); v.setUint32(40, n, true);
  for (let i = 0; i < n; i++) v.setUint8(44 + i, 128); // 128 = silence for 8-bit PCM
  return URL.createObjectURL(new Blob([buf], { type: 'audio/wav' }));
}
function stopSilentLoop() {
  if (!silentLoop) return;
  try { silentLoop.pause(); silentLoop.removeAttribute('src'); silentLoop.load(); } catch (e) {}
  try { URL.revokeObjectURL(silentUrl); } catch (e) {}
  silentLoop = null; silentUrl = null;
}
function keepAudioUnmuted() {
  if (document.hidden) return;
  audioSessionPlayback();
  try {
    if (!silentLoop) {
      silentLoop = document.createElement('audio');
      silentLoop.setAttribute('x-webkit-airplay', 'deny');
      silentLoop.preload = 'auto';
      silentLoop.loop = true;
      silentLoop.src = silentUrl = silentWavUrl();
    }
    if (silentLoop.paused) { const p = silentLoop.play(); if (p) p.catch(() => {}); }
  } catch (e) {}
  if (audioCtx && audioCtx.state !== 'running' && audioCtx.state !== 'closed') {
    try { audioCtx.resume().catch(() => {}); } catch (e) {}
  }
}
// Later taps re-arm it (e.g. back from the background mid-game); the tap that
// STARTS a game calls keepAudioUnmuted() directly from startPractice/startHangman.
['pointerdown', 'touchend', 'keydown'].forEach(ev =>
  document.addEventListener(ev, () => { if (inGameView()) keepAudioUnmuted(); }, { capture: true, passive: true }));
document.addEventListener('visibilitychange', () => {
  if (document.hidden) stopSilentLoop();
  else audioSessionPlayback();
});

const voicesFor = prefix =>
  voices.filter(v => (v.lang || '').toLowerCase().replace('_', '-').startsWith(prefix));
const spanishVoices = () => voicesFor('es');
const englishVoices = () => voicesFor('en');

const NOVELTY_VOICES = /^(Albert|Bad News|Bahh|Bells|Boing|Bubbles|Cellos|Good News|Jester|Organ|Superstar|Trinoids|Whisper|Wobble|Zarvox|Fred|Junior|Kathy|Ralph|Eddy|Flo|Grandma|Grandpa|Reed|Rocko|Sandy|Shelley)\b/i;

function pickVoice(lang = 'es') {
  const wanted = lang === 'en' ? data.settings.voiceURIEn : data.settings.voiceURI;
  if (wanted) {
    const v = voices.find(v => v.voiceURI === wanted);
    if (v) return v;
  }
  let pool = lang === 'en' ? englishVoices() : spanishVoices();
  // iOS 17+ lists joke voices (Zarvox, Bad News, Grandpa…) — never auto-pick
  // those, and prefer a downloaded Enhanced/Premium voice within each locale.
  const real = pool.filter(v => !NOVELTY_VOICES.test(v.name || ''));
  if (real.length) pool = real;
  const better = v => /enhanced|premium|mejorad/i.test((v.name || '') + ' ' + (v.voiceURI || ''));
  pool = pool.filter(better).concat(pool.filter(v => !better(v)));
  const prefs = lang === 'en'
    ? ['en-us', 'en-gb', 'en-au', 'en']
    : ['es-mx', 'es-us', 'es-419', 'es-co', 'es-ar', 'es'];
  for (const p of prefs) {
    const v = pool.find(v => v.lang.toLowerCase().replace('_', '-').startsWith(p));
    if (v) return v;
  }
  return null;
}

function speak(text, rateMul = 1, lang = 'es') {
  if (!hasSpeech) return;
  audioSessionPlayback();
  try { speechSynthesis.cancel(); } catch (e) {}
  const u = new SpeechSynthesisUtterance(text);
  const v = pickVoice(lang);
  if (v) { u.voice = v; u.lang = v.lang; }
  else { u.lang = lang === 'en' ? 'en-US' : 'es-MX'; }  // even with no voice list, iOS honors the lang
  u.rate = Math.max(0.4, Math.min(1.5, data.settings.rate * rateMul));
  speechSynthesis.speak(u);
}

const speakSpelled = (word, lang) => speak(word.split('').filter(c => c.trim()).join(', '), 0.9, lang);

function refreshVoices() {
  try { voices = speechSynthesis.getVoices() || []; } catch (e) { voices = []; }
  populateVoiceSelect();
  updateVoiceBanner();
}

if (hasSpeech) {
  speechSynthesis.onvoiceschanged = refreshVoices;
  let attempts = 0;
  const iv = setInterval(() => {
    refreshVoices();
    if (spanishVoices().length || ++attempts > 10) clearInterval(iv);
  }, 300);
  refreshVoices();
}

function updateVoiceBanner() {
  const dismissed = sessionStorage.getItem('voiceBannerDismissed');
  const showIt = hasSpeech && voices.length > 0 && spanishVoices().length === 0 && !dismissed;
  $('voice-banner').classList.toggle('hidden', !showIt);
}

/* ---------- sounds ---------- */
// A clear bell "ding!" for right and a soft descending "uh-oh" for wrong —
// distinct enough to register without looking at the screen.
let audioCtx = null;
function chime(good) {
  try {
    audioSessionPlayback();
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    // iOS reports 'interrupted' (not just 'suspended') after a call/lock/app switch
    if (audioCtx.state !== 'running') audioCtx.resume().catch(() => {});
    const t0 = audioCtx.currentTime;
    const tone = (freq, start, dur, vol, type = 'sine') => {
      const o = audioCtx.createOscillator(), g = audioCtx.createGain();
      o.type = type;
      o.frequency.value = freq;
      g.gain.setValueAtTime(0.0001, t0 + start);
      g.gain.exponentialRampToValueAtTime(vol, t0 + start + 0.015);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + start + dur);
      o.connect(g); g.connect(audioCtx.destination);
      o.start(t0 + start); o.stop(t0 + start + dur + 0.05);
    };
    if (good) {   // bell strike + octave shimmer
      tone(1046.5, 0, 0.6, 0.22);
      tone(1568, 0.045, 0.5, 0.12);
      tone(2093, 0.045, 0.3, 0.05);
    } else {      // two gentle falling notes
      tone(233, 0, 0.18, 0.13, 'triangle');
      tone(175, 0.16, 0.32, 0.13, 'triangle');
    }
  } catch (e) {}
}

/* ---------- views ---------- */
function show(name) {
  ['home', 'edit', 'practice', 'hangman', 'done', 'settings'].forEach(v =>
    $('view-' + v).classList.toggle('hidden', v !== name));
  if (!GAME_VIEWS.includes(name)) stopSilentLoop();
  window.scrollTo(0, 0);
}

/* ---------- home ---------- */
function renderHome() {
  $('stat-points').textContent = data.progress.totalPoints;
  $('stat-streak').textContent = data.progress.streak;
  $('stat-streak-pill').classList.toggle('hidden', !data.progress.streak);

  const list = activeList();
  $('active-card').classList.toggle('hidden', !list);
  $('empty-card').classList.toggle('hidden', !!list);
  if (list) {
    $('active-name').textContent = list.name + (list.pendingCloud ? ' ⏳' : list.cloudError ? ' ⚠️' : '');
    let meta = list.words.length + ' words';
    if (listLang(list) === 'en') meta += ' · 🇺🇸 English';
    if (list.lastResult) meta += ` · last time ${list.lastResult.perfect}/${list.lastResult.total} on the first try`;
    const mastered = list.words.filter(w => masteryFor(list.id, w).stars === 3).length;
    if (mastered) meta += ` · ${mastered}/${list.words.length} mastered ⭐`;
    $('active-count').textContent = meta;
    const p = pausedFor(list);
    // update only the label parts so the tile keeps its icon/title/subtitle look
    $('btn-practice').querySelector('b').textContent = p ? 'Resume' : 'Practice';
    $('btn-practice').querySelector('small').textContent = p ? `${p.queue.length} to go` : 'Hints and extra tries';
    $('btn-startover').classList.toggle('hidden', !p);
    const trouble = list.words.filter(w => troubleFor(list.id, w));
    $('btn-trouble').classList.toggle('hidden', !trouble.length);
    $('trouble-count').textContent = trouble.length ? `(${trouble.length})` : '';
    const isCloud = list.id.startsWith('cloud-');
    const cloudBtn = $('btn-cloud-save');
    // With the relay configured, cloud lists can be re-published too (edits/typos).
    cloudBtn.classList.toggle('hidden', isCloud && !CLOUD_SYNC_URL);
    cloudBtn.textContent = isCloud ? '☁️ Update cloud copy' : '☁️ Save to cloud';
  }
  const others = data.lists.filter(l => l.id !== data.activeListId);
  const box = $('past-lists');
  box.innerHTML = '';
  if (others.length) {
    const h = document.createElement('p');
    h.className = 'past-title';
    h.textContent = 'OTHER LISTS';
    box.appendChild(h);
    others.forEach(l => {
      const item = document.createElement('div');
      item.className = 'past-item';
      const info = document.createElement('div');
      info.className = 'past-info';
      const nm = document.createElement('div');
      nm.className = 'past-name';
      nm.textContent = l.name + (l.pendingCloud ? ' ⏳' : '');
      const meta = document.createElement('div');
      meta.className = 'past-meta';
      meta.textContent = l.words.length + ' words' + (listLang(l) === 'en' ? ' · 🇺🇸' : '');
      info.append(nm, meta);
      const use = document.createElement('button');
      use.textContent = 'Use';
      use.addEventListener('click', () => { data.activeListId = l.id; save(); renderHome(); });
      const del = document.createElement('button');
      del.className = 'past-del';
      del.textContent = '🗑';
      del.addEventListener('click', () => {
        if (!confirm(`Delete "${l.name}"?`)) return;
        removeList(l.id);
        save(); renderHome();
      });
      item.append(info, use, del);
      box.appendChild(item);
    });
  }
}

/* ---------- edit / new list ---------- */
let editingId = null;
let editingLang = 'es';

function setEditingLang(lang) {
  editingLang = lang === 'en' ? 'en' : 'es';
  $('lang-es').classList.toggle('active', editingLang === 'es');
  $('lang-en').classList.toggle('active', editingLang === 'en');
}

const defaultListName = () =>
  'Week of ' + new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

function parseWords(text) {
  const out = [], seen = new Set();
  text.split(/[\n,;•·|]+/).forEach(raw => {
    if (/^\s*[📚🌐]/u.test(raw)) return;   // header/language lines from a shared list
    const w = raw.normalize('NFC')
      .replace(/^\s*\d+\s*[.):\-]*\s*/, '')            // leading "1." "2)" numbering
      .replace(/^[\s\-–—*✓✔☐□"“”‘’'«»]+/, '')          // leading bullets/dashes/quotes
      .replace(/[.,;:!?¡¿"“”‘’'«»]+\s*$/g, '')         // trailing punctuation/quotes
      .trim().replace(/\s+/g, ' ');
    if (!w) return;
    // typing/paste noise filters: needs at least 2 letters, no digits, sane length
    if (w.replace(/[^\p{L}]/gu, '').length < 2) return;
    if (/\d/.test(w)) return;
    if (w.length > 40) return;
    const key = canon(w);
    if (seen.has(key)) return;
    seen.add(key);
    out.push(w);
  });
  return out;
}

/* ---------- picture generation (self-serve AI illustrations) ---------- */
// One-time, in-app: for each word, ask Pollinations.ai (free, no key) for a
// picture and stage its URL. Nothing is downloaded/committed as a file — the
// URL itself rides along in the list JSON through the existing ☁️ cloud-save
// flow. Offline reliability after that depends on the service worker caching
// each image the first time it's actually loaded (see sw.js); an image that
// was never cached just falls back to the emoji hint.
const IMG_STYLE = "flat design vector illustration, thick black outlines, solid flat colors, "
  + "minimalist, cute mascot art style, children's educational app, no text, no words, no letters, "
  + 'simple pastel solid background';

const pollinationsUrl = word =>
  'https://image.pollinations.ai/prompt/' + encodeURIComponent(`${IMG_STYLE}, ${word}`)
  + '?width=512&height=512&nologo=true&model=flux&seed=7';

function preloadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';   // CORS response → the service worker can cache it for offline
    img.onload = () => resolve(url);
    img.onerror = reject;
    img.src = url;
  });
}

// word (canon) -> { image }, staged for the list currently being edited.
let editingExtras = {};

function setGenProgress(text, frac) {
  $('gen-progress').classList.remove('hidden');
  $('gen-status').textContent = text;
  $('gen-fill').style.width = Math.round(Math.max(0, Math.min(1, frac || 0)) * 100) + '%';
}

function renderPicGrid() {
  const words = parseWords($('words-input').value);
  const grid = $('pic-grid');
  grid.innerHTML = '';
  const any = words.some(w => editingExtras[canon(w)] && editingExtras[canon(w)].image);
  grid.classList.toggle('hidden', !any);
  words.forEach(w => {
    const ex = editingExtras[canon(w)];
    if (!ex || !ex.image) return;
    const item = document.createElement('div');
    item.className = 'pic-item';
    const img = document.createElement('img');
    img.crossOrigin = 'anonymous';
    img.src = ex.image;
    img.alt = w;
    const rm = document.createElement('button');
    rm.className = 'pic-remove';
    rm.textContent = '✕';
    rm.setAttribute('aria-label', 'Use emoji instead of picture for ' + w);
    rm.addEventListener('click', () => { delete ex.image; renderPicGrid(); });
    const label = document.createElement('div');
    label.className = 'pic-word';
    label.textContent = w;
    item.append(img, rm, label);
    grid.appendChild(item);
  });
}

// A run belongs to the editor it started in: leaving/reopening the editor bumps
// genRun and the old loop stops. Save is held while it runs, so no picture
// finishes after the list was already saved (and gets lost).
let genRun = 0, genBusy = false;
function stopImageGen() {
  genRun++;
  genBusy = false;
  $('btn-gen-images').disabled = false;
  $('btn-save-list').disabled = false;
}

async function generateImages() {
  const words = parseWords($('words-input').value);
  if (!words.length) { alert('Add some words first 🙂'); return; }
  const todo = words.filter(w => !(editingExtras[canon(w)] && editingExtras[canon(w)].image));
  if (!todo.length) { alert('Every word already has a picture!'); return; }
  const run = ++genRun, extras = editingExtras;
  genBusy = true;
  $('btn-gen-images').disabled = true;
  $('btn-save-list').disabled = true;
  for (let i = 0; i < todo.length; i++) {
    const w = todo[i];
    setGenProgress(`Generating pictures… ${i + 1} of ${todo.length}`, i / todo.length);
    try {
      const url = pollinationsUrl(w);
      await preloadImage(url);
      if (run !== genRun) return;   // editor was left/reopened — drop it
      extras[canon(w)] = { ...(extras[canon(w)] || {}), image: url };
      renderPicGrid();
    } catch (e) { /* generation failed — this word just falls back to emoji */ }
    if (run !== genRun) return;
    if (i < todo.length - 1) await new Promise(r => setTimeout(r, 2500));  // free-tier: 1 request at a time
    if (run !== genRun) return;
  }
  setGenProgress("Done! Tap ✕ on any picture you don't like to use the emoji instead.", 1);
  stopImageGen();
}

function openEdit(listId) {
  stopImageGen();
  editingId = listId || null;
  const list = listId ? data.lists.find(l => l.id === listId) : null;
  $('edit-title').textContent = list ? 'Edit list' : 'New word list';
  $('list-name').value = list ? list.name : defaultListName();
  $('words-input').value = list ? list.words.join('\n') : '';
  $('btn-delete-list').classList.toggle('hidden', !list);
  $('gen-progress').classList.add('hidden');
  setEditingLang(list ? listLang(list) : 'es');
  editingExtras = {};
  if (list && list.extras) {
    for (const [k, v] of Object.entries(list.extras)) {
      if (v && v.image) editingExtras[k] = { image: v.image };
    }
  }
  renderPicGrid();
  renderChips();
  show('edit');
}

// If a shared list was pasted in, lift its "📚 name" header into the name field
// and its "🌐 english" marker into the language toggle.
function absorbSharedName() {
  const ta = $('words-input');
  if (/^\s*🌐\s*english/mi.test(ta.value)) {
    setEditingLang('en');
    ta.value = ta.value.replace(/^\s*🌐.*$/m, '');
  }
  const m = ta.value.match(/^\s*📚\s*(.+)\s*$/m);
  if (!m) return;
  const nameField = $('list-name');
  if (!nameField.value.trim() || /^Week of /.test(nameField.value)) nameField.value = m[1].trim();
  ta.value = ta.value.replace(/^\s*📚.*$/m, '').replace(/^\n+/, '');
}

function renderChips() {
  absorbSharedName();
  const words = parseWords($('words-input').value);
  $('chips-label').textContent = words.length
    ? `${words.length} word${words.length === 1 ? '' : 's'} — tap ✕ to remove:` : '';
  const box = $('chips');
  box.innerHTML = '';
  words.forEach(w => {
    const chip = document.createElement('span');
    chip.className = 'chip';
    const t = document.createElement('span');
    t.textContent = w;
    const x = document.createElement('button');
    x.textContent = '✕';
    x.setAttribute('aria-label', 'Remove ' + w);
    x.addEventListener('click', () => {
      $('words-input').value = parseWords($('words-input').value).filter(v => v !== w).join('\n');
      renderChips();
    });
    chip.append(t, x);
    box.appendChild(chip);
  });
  renderPicGrid();
}

// Merges staged pictures into whatever extras (emoji/sentence) the list already
// carries, keyed the same way cloud-list extras are: canon(word) -> {...}.
function buildExtras(words, prevExtras) {
  const out = {};
  words.forEach(w => {
    const key = canon(w);
    const merged = { ...((prevExtras && prevExtras[key]) || {}) };
    const img = editingExtras[key] && editingExtras[key].image;
    if (img) merged.image = img; else delete merged.image;
    if (Object.keys(merged).length) out[key] = merged;
  });
  return Object.keys(out).length ? out : undefined;
}

function saveList() {
  const words = parseWords($('words-input').value);
  if (!words.length) { alert('Add at least one word first 🙂'); return; }
  const name = $('list-name').value.trim() || defaultListName();
  let saved;
  if (editingId) {
    saved = data.lists.find(l => l.id === editingId);
    saved.name = name;
    saved.words = words;
    saved.lang = editingLang;
    saved.extras = buildExtras(words, saved.extras);
    data.activeListId = saved.id;
    if (data.paused && data.paused.listId === editingId) data.paused = null;  // words changed
  } else {
    const extras = buildExtras(words, null);
    saved = { id: 'l' + Date.now(), name, words, lang: editingLang, extras, createdAt: Date.now() };
    data.lists.unshift(saved);
    data.activeListId = saved.id;
  }
  save(); renderHome(); show('home');
  publishList(saved, true);   // auto-sync to the other phone; queued (⏳) if offline
}

async function shareActiveList() {
  const list = activeList();
  if (!list) return;
  const langLine = listLang(list) === 'en' ? '🌐 english\n' : '';
  const text = `📚 ${list.name}\n${langLine}${list.words.join('\n')}\n\nOpen Palabritas → New word list → paste this in!\nhttps://gwallee.github.io/Palabritas/`;
  if (navigator.share) {
    try { await navigator.share({ text }); return; } catch (e) { /* user cancelled */ return; }
  }
  try {
    await navigator.clipboard.writeText(text);
    alert('List copied! Paste it into a message.');
  } catch (e) {
    alert('Could not share on this device.');
  }
}

/* ---------- shared lists from GitHub ---------- */
// Cloud lists live on the repo's main branch in two places:
//   lists/<id>.json  — one file per list; created by the ☁️ Save to cloud button
//   lists.json       — legacy single-feed file; still honored (hand-edits, Claude)
// Both are read from main (raw/API) so a github.com commit reaches every phone
// with no redeploy.

const REPO = 'gwallee/Palabritas';

// Apps Script relay (apps-script/Code.gs): lets any family phone commit a list
// to the repo with no GitHub account on the phone. Paste the deployment's /exec
// URL here. Empty = fall back to opening GitHub's prefilled commit page, which
// only works signed in with write access to the repo.
const CLOUD_SYNC_URL = 'https://script.google.com/macros/s/AKfycbwFMDYQKRpTcpmQvYr1oavoccU-cJtgGc6rvAq2G12uWtyn7v4xZQrHT_FaUKrgmivXDA/exec';

function slugify(text) {
  return stripVowelAccents(String(text).toLowerCase())
    .replace(/ñ/g, 'n')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'lista';
}

// Publishing to the cloud. With CLOUD_SYNC_URL set, lists POST to the Apps
// Script relay, which commits them to lists/ — works from any phone, no GitHub
// account. Every editor save auto-publishes (quiet); the ☁️ button is a loud
// manual push. A failed publish marks the list pendingCloud (⏳ on home) and
// retries on the next app open or when the connection returns.

// The repo filename a list publishes under. Assigned once, then reused, so a
// rename or a retry on a later day never forks a second cloud file.
function cloudIdFor(list) {
  if (list.id.startsWith('cloud-')) return list.id.slice('cloud-'.length);
  // Random tail (v2.1): both parents making "Week of Nov 3" the same day used to
  // land on the SAME file, and the second save overwrote the first list.
  if (!list.cloudId) list.cloudId = new Date().toISOString().slice(0, 10) + '-'
    + slugify(list.name).slice(0, 34).replace(/-+$/, '') + '-' + Math.random().toString(36).slice(2, 6);
  return list.cloudId;
}

function listPayload(list) {
  const payload = { id: cloudIdFor(list), name: list.name, words: list.words };
  if (listLang(list) === 'en') payload.lang = 'en';
  if (list.extras && Object.keys(list.extras).length) payload.extras = list.extras;
  return payload;
}

// Relay answers that will never succeed on retry (bad data, wrong PIN…), as
// opposed to GitHub hiccups / no connection, which are worth retrying.
const RETRYABLE_RELAY_ERROR = /^(GitHub|No GITHUB_TOKEN)/;

async function publishList(list, quiet) {
  if (!CLOUD_SYNC_URL || !list) return;
  // Marked pending BEFORE the upload (v2.1): if iOS closes the app mid-request,
  // the list still shows ⏳ and retries next open — and a sync running at the
  // same time can't overwrite these edits with the older cloud copy.
  list.pendingCloud = true;
  delete list.cloudError;
  save();
  try {
    // text/plain keeps this a "simple" CORS request — Apps Script cannot answer
    // a preflight OPTIONS (same trick as MathFacts; do not change to JSON).
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 25000);
    const r = await fetch(CLOUD_SYNC_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(listPayload(list)),
      signal: ctrl.signal,
    });
    clearTimeout(timer);
    const res = await r.json();
    if (!res.ok && !RETRYABLE_RELAY_ERROR.test(res.error || '')) {
      // Permanent refusal: stop retrying (it used to sit at ⏳ forever and block
      // all repo updates to the list). The list stays fine on this phone.
      delete list.pendingCloud;
      list.cloudError = res.error || 'refused';
      save(); renderHome();
      alert(`"${list.name}" was saved on this phone, but the cloud refused it: ${list.cloudError}`);
      return;
    }
    if (!res.ok) throw new Error(res.error || 'The cloud said no');
    delete list.pendingCloud;
    save(); renderHome();
    if (!quiet) alert('✅ Saved to the cloud!\n\nIt will show up on the other phone the next time the app opens online.');
    syncCloudLists();   // promote the local copy to its cloud- id right away
  } catch (e) {
    list.pendingCloud = true;   // ⏳ on home; retried on next open / back online
    save(); renderHome();
    if (!quiet) {
      const why = e.name === 'AbortError' ? 'it took too long' : (e.message || 'no connection');
      alert('Could not save to the cloud (' + why + ').\n\nThe list is safe on this phone and will sync by itself when there is a connection (⏳ next to its name until then).');
    }
  }
}

async function retryPendingPublishes() {
  if (!CLOUD_SYNC_URL) return;
  for (const list of data.lists.filter(l => l.pendingCloud)) {
    await publishList(list, true);   // sequential — one commit at a time
  }
}

function cloudSaveActiveList() {
  const list = activeList();
  if (!list) return;
  const isCloud = list.id.startsWith('cloud-');

  if (!CLOUD_SYNC_URL) {   // fallback: GitHub's prefilled commit page (needs repo write access)
    if (isCloud) { alert('This list is already in the cloud.'); return; }
    const body = JSON.stringify(listPayload(list), null, 2) + '\n';
    const url = 'https://github.com/' + REPO + '/new/main'
      + '?filename=' + encodeURIComponent('lists/' + cloudIdFor(list) + '.json')
      + '&value=' + encodeURIComponent(body);
    save();   // keep the assigned cloudId
    window.open(url, '_blank');
    return;
  }

  if (isCloud && !confirm('Update the cloud copy of this list for everyone?')) return;
  const btn = $('btn-cloud-save');
  const oldLabel = btn.textContent;
  btn.disabled = true;
  btn.textContent = '☁️ Saving…';
  publishList(list, false).finally(() => {
    btn.disabled = false;
    btn.textContent = oldLabel;
  });
}

async function fetchListsJson() {
  try {
    const r = await fetch('https://raw.githubusercontent.com/gwallee/Palabritas/main/lists.json', { cache: 'no-cache' });
    if (r.ok) return await r.json();
  } catch (e) { /* offline or blocked — try the deployed copy */ }
  const r2 = await fetch('./lists.json', { cache: 'no-cache' });
  if (!r2.ok) return null;
  return r2.json();
}

// git's blob id = sha1("blob <size>\0" + bytes). No crypto.subtle (very old
// browser / insecure origin) → can't check, so accept as before.
async function blobShaMatches(bytes, sha) {
  if (!(window.crypto && crypto.subtle) || !sha) return true;
  const head = new TextEncoder().encode(`blob ${bytes.byteLength}\0`);
  const buf = new Uint8Array(head.length + bytes.byteLength);
  buf.set(head);
  buf.set(new Uint8Array(bytes), head.length);
  const d = new Uint8Array(await crypto.subtle.digest('SHA-1', buf));
  return [...d].map(b => b.toString(16).padStart(2, '0')).join('') === sha;
}

// One file per list in lists/ on main. The directory listing gives each file's
// blob sha, so unchanged lists cost no extra fetches on later syncs.
async function fetchCloudFiles() {
  const entries = [];
  try {
    const r = await fetch('https://api.github.com/repos/' + REPO + '/contents/lists?ref=main',
      { cache: 'no-cache', headers: { accept: 'application/vnd.github+json' } });
    if (!r.ok) return entries;   // 404 = no lists/ folder yet
    const files = await r.json();
    if (!Array.isArray(files)) return entries;
    // date-prefixed filenames sort chronologically — newest first
    files.sort((a, b) => (a.name < b.name ? 1 : -1));
    for (const f of files) {
      if (f.type !== 'file' || !f.name.endsWith('.json') || !f.download_url) continue;
      const id = f.name.slice(0, -5);
      const existing = data.lists.find(l => l.id === 'cloud-' + id);
      if (existing && existing.cloudSha === f.sha) continue;   // unchanged
      const del = data.deletedCloud && data.deletedCloud[id];
      if (del && (del === true || del === f.sha)) continue;    // deleted on this phone
      try {
        const u = new URL(f.download_url);
        u.searchParams.set('v', f.sha);   // nudges the raw CDN past its 5-minute cache
        const fr = await fetch(u.href, { cache: 'no-cache' });
        if (!fr.ok) continue;
        const bytes = await fr.arrayBuffer();
        // raw.githubusercontent.com can serve the OLD body for ~5 min after a
        // commit while the listing already shows the NEW sha. Storing that pair
        // froze phones on stale words (the sha matched, so it never refetched).
        // Only accept a body whose git blob hash IS the listed sha; otherwise
        // skip and the next sync tries again.
        if (!(await blobShaMatches(bytes, f.sha))) continue;
        const j = JSON.parse(new TextDecoder().decode(bytes));
        entries.push({ id, name: j.name, words: j.words, lang: j.lang, extras: j.extras, sha: f.sha });
      } catch (e) { /* skip malformed/unreachable file */ }
    }
  } catch (e) { /* offline — no problem */ }
  return entries;
}

// After a list is committed to the cloud and synced back, drop the local copy
// it was promoted from (same name, same words) so it doesn't show up twice.
function dropPromotedLocal(cloudId, name, words) {
  const rawId = cloudId.slice('cloud-'.length);
  const key = words.map(canon).sort().join('\n');
  const dup = data.lists.find(l =>
    !l.id.startsWith('cloud-') && !l.pendingCloud &&
    (l.cloudId === rawId ||   // it published itself under this filename
      (canon(l.name) === canon(name) &&
        l.words.length === words.length &&
        l.words.map(canon).sort().join('\n') === key)));
  if (!dup) return;
  data.lists = data.lists.filter(l => l.id !== dup.id);
  if (data.activeListId === dup.id) data.activeListId = cloudId;
  // Same list under a new id: carry its stars, trouble words, last result and
  // paused round over instead of losing them (keys are "<listId>|word").
  for (const store of [data.progress.mastery, data.progress.trouble]) {
    for (const k of Object.keys(store)) {
      if (!k.startsWith(dup.id + '|')) continue;
      const nk = cloudId + k.slice(dup.id.length);
      if (!store[nk]) store[nk] = store[k];
      delete store[k];
    }
  }
  const cloud = data.lists.find(l => l.id === cloudId);
  if (cloud && dup.lastResult && !cloud.lastResult) cloud.lastResult = dup.lastResult;
  if (data.paused && data.paused.listId === dup.id) data.paused.listId = cloudId;
}

// One at a time — the open, post-publish and back-online syncs used to overlap.
// A request that arrives mid-sync runs once more afterwards (it may need files
// committed after the running sync listed the folder).
let syncing = null, syncAgain = false;
function syncCloudLists() {
  if (syncing) { syncAgain = true; return syncing; }
  syncing = doSyncCloudLists().finally(() => {
    syncing = null;
    if (syncAgain) { syncAgain = false; syncCloudLists(); }
  });
  return syncing;
}

async function doSyncCloudLists() {
  try {
    const entries = [];
    const legacy = await fetchListsJson();
    if (Array.isArray(legacy)) legacy.forEach(e => entries.push(e));
    (await fetchCloudFiles()).forEach(e => entries.push(e));
    let changed = false;
    const addedIds = [];
    entries.forEach(cl => {
      if (!cl || !cl.id || !Array.isArray(cl.words) || !cl.words.length) return;
      // A local list with unpublished edits destined for this same file wins —
      // importing the older cloud copy now would duplicate or clobber it.
      if (data.lists.some(l => l.pendingCloud && l.cloudId === String(cl.id))) return;
      const del = data.deletedCloud && data.deletedCloud[String(cl.id)];
      if (del && (del === true || !cl.sha || del === cl.sha)) return;   // deleted on this phone
      const id = 'cloud-' + String(cl.id);
      const name = String(cl.name || cl.id);
      const words = cl.words.map(w => String(w).normalize('NFC'));
      // Only an EXPLICIT lang in the repo file may change an existing list's
      // language. A file with no lang says nothing — the old relay stripped the
      // field from every publish, and treating that as "Spanish" kept reverting
      // English lists on the phones (the v2.0.0 revert bug).
      const cloudLang = (cl.lang === 'en' || cl.lang === 'es') ? cl.lang : null;
      const extras = (cl.extras && typeof cl.extras === 'object') ? cl.extras : undefined;
      const existing = data.lists.find(l => l.id === id);
      if (existing && existing.pendingCloud) return;   // local edits not yet uploaded win until they land
      if (existing) {   // the repo is the source of truth for cloud lists
        if (existing.name !== name || JSON.stringify(existing.words) !== JSON.stringify(words)) {
          existing.name = name;
          existing.words = words;
          if (data.paused && data.paused.listId === id) data.paused = null;
          changed = true;
        }
        if (cloudLang && listLang(existing) !== cloudLang) { existing.lang = cloudLang; changed = true; }
        if (JSON.stringify(existing.extras || null) !== JSON.stringify(extras || null)) {
          existing.extras = extras;   // enrichment arriving later shouldn't clear a pause
          changed = true;
        }
        if (cl.sha && existing.cloudSha !== cl.sha) { existing.cloudSha = cl.sha; changed = true; }
      } else {
        data.lists.unshift({ id, name, words, lang: cloudLang || 'es', extras, createdAt: Date.now(), cloudSha: cl.sha });
        dropPromotedLocal(id, name, words);
        addedIds.push(id);
        changed = true;
      }
    });
    if (addedIds.length) data.activeListId = addedIds[0];  // entries arrive newest-first
    if (changed) { save(); renderHome(); }
  } catch (e) { /* offline — no problem */ }
}

// Deleting a list that has a cloud copy remembers that file (and the version
// deleted), so the next sync doesn't quietly bring it back. If someone later
// EDITS that file in the cloud, its sha changes and it returns — on purpose.
function removeList(id) {
  const l = data.lists.find(x => x.id === id);
  if (!l) return;
  const fileId = l.id.startsWith('cloud-') ? l.id.slice('cloud-'.length) : l.cloudId;
  if (fileId) {
    data.deletedCloud = data.deletedCloud || {};
    data.deletedCloud[fileId] = l.cloudSha || true;
  }
  data.lists = data.lists.filter(x => x.id !== id);
  if (data.paused && data.paused.listId === id) data.paused = null;
  if (data.activeListId === id) data.activeListId = data.lists.length ? data.lists[0].id : null;
}

function deleteList() {
  if (!editingId || !confirm('Delete this list?')) return;
  stopImageGen();
  removeList(editingId);
  save(); renderHome(); show('home');
}

/* ---------- word pictures (emoji hints) ---------- */
const WORD_EMOJI = {
  // animals
  gato:'🐱', perro:'🐶', pez:'🐟', pescado:'🐟', pájaro:'🐦', ave:'🐦', caballo:'🐴', vaca:'🐮',
  cerdo:'🐷', puerco:'🐷', pollo:'🐔', gallina:'🐔', gallo:'🐓', pato:'🦆', oso:'🐻', león:'🦁',
  tigre:'🐯', mono:'🐵', changuito:'🐵', chango:'🐵', elefante:'🐘', jirafa:'🦒', ratón:'🐭', rata:'🐀',
  conejo:'🐰', tortuga:'🐢', serpiente:'🐍', víbora:'🐍', culebra:'🐍', rana:'🐸', sapo:'🐸',
  abeja:'🐝', mariposa:'🦋', araña:'🕷️', hormiga:'🐜', mosca:'🪰', grillo:'🦗', catarina:'🐞',
  caracol:'🐌', delfín:'🐬', ballena:'🐋', tiburón:'🦈', pulpo:'🐙', cangrejo:'🦀', camarón:'🦐',
  búho:'🦉', lechuza:'🦉', lobo:'🐺', zorro:'🦊', venado:'🦌', ardilla:'🐿️', murciélago:'🦇',
  pingüino:'🐧', águila:'🦅', loro:'🦜', perico:'🦜', gusano:'🪱', dinosaurio:'🦖', unicornio:'🦄',
  dragón:'🐉', camello:'🐫', burro:'🫏', oveja:'🐑', borrego:'🐑', cabra:'🐐', chivo:'🐐',
  koala:'🐨', canguro:'🦘', hipopótamo:'🦛', rinoceronte:'🦏', cocodrilo:'🐊', lagarto:'🦎',
  lagartija:'🦎', iguana:'🦎', flamenco:'🦩', cisne:'🦢', pavo:'🦃', foca:'🦭', pantera:'🐆',
  // food
  manzana:'🍎', plátano:'🍌', banana:'🍌', naranja:'🍊', limón:'🍋', uva:'🍇', fresa:'🍓',
  sandía:'🍉', melón:'🍈', piña:'🍍', mango:'🥭', pera:'🍐', durazno:'🍑', cereza:'🍒', coco:'🥥',
  aguacate:'🥑', tomate:'🍅', jitomate:'🍅', zanahoria:'🥕', maíz:'🌽', elote:'🌽', papa:'🥔',
  pan:'🍞', queso:'🧀', huevo:'🥚', leche:'🥛', agua:'💧', jugo:'🧃', café:'☕', té:'🍵',
  taco:'🌮', pizza:'🍕', hamburguesa:'🍔', sopa:'🍲', arroz:'🍚', pastel:'🎂', galleta:'🍪',
  dulce:'🍬', caramelo:'🍬', chocolate:'🍫', helado:'🍨', paleta:'🍭', miel:'🍯', sal:'🧂',
  frijol:'🫘', pepino:'🥒', lechuga:'🥬', brócoli:'🥦', cebolla:'🧅', ajo:'🧄', chile:'🌶️',
  hongo:'🍄', champiñón:'🍄', mantequilla:'🧈', tortilla:'🫓', espagueti:'🍝', cuchara:'🥄',
  sándwich:'🥪', cacahuate:'🥜', calabaza:'🎃', comida:'🍽️',
  // school & objects
  libro:'📖', lápiz:'✏️', pluma:'🖊️', crayón:'🖍️', tijeras:'✂️', mochila:'🎒', escuela:'🏫',
  maestro:'🧑‍🏫', maestra:'👩‍🏫', papel:'📄', cuaderno:'📓', regla:'📏', computadora:'💻',
  teléfono:'📱', televisión:'📺', reloj:'⏰', silla:'🪑', cama:'🛏️', puerta:'🚪', ventana:'🪟',
  llave:'🔑', casa:'🏠', carro:'🚗', coche:'🚗', camión:'🚚', autobús:'🚌', tren:'🚂', avión:'✈️',
  barco:'⛵', bicicleta:'🚲', cohete:'🚀', globo:'🎈', pelota:'⚽', balón:'⚽', juguete:'🧸',
  muñeca:'🪆', 'oso de peluche':'🧸', regalo:'🎁', dinero:'💰', moneda:'🪙', anillo:'💍',
  corona:'👑', espada:'🗡️', escudo:'🛡️', campana:'🔔', tambor:'🥁', guitarra:'🎸', piano:'🎹',
  violín:'🎻', trompeta:'🎺', música:'🎵', canción:'🎵', foto:'📷', cámara:'📷', lámpara:'💡',
  foco:'💡', vela:'🕯️', fuego:'🔥', escoba:'🧹', jabón:'🧼', cepillo:'🪥', sombrero:'🎩',
  zapato:'👟', calcetín:'🧦', camisa:'👕', playera:'👕', pantalón:'👖', vestido:'👗', falda:'👗',
  abrigo:'🧥', guante:'🧤', bufanda:'🧣', gorra:'🧢', lentes:'👓', paraguas:'☂️', bota:'👢',
  corbata:'👔', tesoro:'💎', mapa:'🗺️', bandera:'🚩', carta:'✉️', sobre:'✉️', basura:'🗑️',
  martillo:'🔨', cubeta:'🪣', imán:'🧲',
  // nature
  sol:'☀️', luna:'🌙', estrella:'⭐', nube:'☁️', lluvia:'🌧️', nieve:'❄️', rayo:'⚡', trueno:'⚡',
  arcoíris:'🌈', tornado:'🌪️', viento:'🌬️', montaña:'⛰️', río:'🏞️', mar:'🌊', océano:'🌊',
  ola:'🌊', playa:'🏖️', isla:'🏝️', árbol:'🌳', flor:'🌸', rosa:'🌹', girasol:'🌻', hoja:'🍃',
  planta:'🪴', semilla:'🌱', cactus:'🌵', bosque:'🌲', tierra:'🌎', mundo:'🌎', planeta:'🪐',
  volcán:'🌋', piedra:'🪨', roca:'🪨', hielo:'🧊', desierto:'🏜️', primavera:'🌷', verano:'☀️',
  otoño:'🍂', invierno:'⛄',
  // people & body
  ojo:'👁️', boca:'👄', nariz:'👃', oreja:'👂', mano:'✋', pie:'🦶', diente:'🦷', corazón:'❤️',
  cerebro:'🧠', hueso:'🦴', bebé:'👶', niño:'👦', niña:'👧', hombre:'👨', mujer:'👩',
  abuelo:'👴', abuela:'👵', familia:'👨‍👩‍👧‍👦', amigo:'🧑‍🤝‍🧑', amiga:'🧑‍🤝‍🧑', rey:'🤴',
  reina:'👸', princesa:'👸', príncipe:'🤴', doctor:'🧑‍⚕️', doctora:'👩‍⚕️', policía:'👮',
  bombero:'🧑‍🚒', astronauta:'🧑‍🚀', pirata:'🏴‍☠️', payaso:'🤡', fantasma:'👻', monstruo:'👹',
  robot:'🤖', ángel:'😇', bruja:'🧙', hada:'🧚', sirena:'🧜',
  // actions & feelings
  feliz:'😊', triste:'😢', enojado:'😠', enojada:'😠', cansado:'😴', cansada:'😴', dormir:'😴',
  correr:'🏃', caminar:'🚶', nadar:'🏊', bailar:'💃', cantar:'🎤', leer:'📖', escribir:'✍️',
  pintar:'🎨', dibujar:'🖍️', cocinar:'🍳', amor:'❤️', beso:'💋', abrazo:'🤗', risa:'😂',
  llorar:'😭', hola:'👋', gracias:'🙏', silencio:'🤫',
  // colors & misc
  rojo:'🔴', azul:'🔵', verde:'🟢', amarillo:'🟡', morado:'🟣', negro:'⚫', blanco:'⚪',
  cumpleaños:'🎂', fiesta:'🎉', navidad:'🎄', fútbol:'⚽', béisbol:'⚾', básquetbol:'🏀',
  baloncesto:'🏀', tenis:'🎾', magia:'✨', sueño:'💤', noche:'🌃', día:'🌅', mañana:'🌅',
};

let EMOJI_INDEX = null;
function emojiFor(word) {
  if (!EMOJI_INDEX) {
    EMOJI_INDEX = {};
    for (const [k, v] of Object.entries(WORD_EMOJI)) EMOJI_INDEX[stripVowelAccents(k)] = v;
  }
  let w = canon(word).replace(/^(el|la|los|las|un|una|unos|unas|the|a|an)\s+/, '');
  const candidates = [w];
  if (w.endsWith('es')) candidates.push(w.slice(0, -2));
  if (w.endsWith('s')) candidates.push(w.slice(0, -1));
  for (const c of candidates) {
    const hit = EMOJI_INDEX[stripVowelAccents(c)];
    if (hit) return hit;
  }
  return null;
}

/* ---------- sentences ---------- */
// Enriched cloud lists carry a real usage sentence per word (extras). The
// generic frames below are only the fallback for lists without extras.
const SENTENCE_FRAMES = [
  'Escucha bien: {w}.',
  'La palabra de hoy es: {w}.',
  'En la escuela aprendimos la palabra {w}.',
];
const SENTENCE_FRAMES_EN = [
  'Listen carefully: {w}.',
  "Today's word is: {w}.",
  'Can you spell the word {w}?',
];

// Per-word enrichment ({ emoji, sentence, image }) — defaults to the practice
// session's list; hangman passes its own listId explicitly.
function wordExtra(word, listId) {
  const sid = listId || (session && session.listId);
  if (!sid) return null;
  const list = data.lists.find(l => l.id === sid);
  const extras = list && list.extras;
  return (extras && extras[canon(word)]) || null;
}

function speakSentence(word, listId) {
  const lang = listLang(listId || (session && session.listId));
  const ex = wordExtra(word, listId);
  if (ex && ex.sentence) { speak(ex.sentence, 0.92, lang); return; }
  const frames = lang === 'en' ? SENTENCE_FRAMES_EN : SENTENCE_FRAMES;
  speak(pick(frames).replace('{w}', word), 0.95, lang);
}

/* ---------- practice ---------- */
const PRAISE = ['¡Muy bien!', '¡Excelente!', '¡Perfecto!', '¡Genial!', '¡Fantástico!', '¡Súper!', '¡Increíble!', '¡Qué buena ortografía!', '¡Lo clavaste!', '¡Eres una campeona!'];
const MINI_STREAKS = { 3: '🔥 ¡3 seguidas!', 5: '🌟 ¡5 seguidas! ¡Imparable!', 10: '🚀 ¡10 seguidas! ¡Sensacional!' };
// Points for a correct answer, indexed by how many wrong tries came first
// (index 2 covers "3rd try or later"). A word that gets revealed earns 0.
const POINTS_BY_TRY = [10, 8, 5];
let session = null;
let againKind = 'practice';

const todayStr = () => {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
};

// A streak day requires finishing a full practice round that day. Consecutive
// calendar days (not 24h windows) extend it; any gap resets it to 1.
function updateStreak() {
  const today = todayStr();
  const last = data.progress.lastPracticeDate;
  if (last === today) return;
  if (last) {
    const gapDays = Math.round((new Date(today) - new Date(last)) / 86400000);
    data.progress.streak = gapDays === 1 ? data.progress.streak + 1 : 1;
  } else {
    data.progress.streak = 1;
  }
  data.progress.lastPracticeDate = today;
}

// A paused session is resumable on this device for 24h, for the matching list.
function pausedFor(list) {
  const p = data.paused;
  if (!p || !list || p.listId !== list.id) return null;
  if (!Array.isArray(p.queue) || !p.queue.length) return null;
  if (Date.now() - (p.savedAt || 0) > 24 * 3600 * 1000) return null;
  return p;
}

function saveSession() {
  if (!session) return;
  if (session.kind !== 'practice') { save(); return; }
  // The in-progress word goes back to the front. In copy mode it's usually
  // already re-queued — but not on its SECOND reveal (re-queue is once per
  // word), so check the queue instead of assuming, or the word gets dropped.
  const cur = session.current;
  const head = cur && !(session.mode === 'copy' && session.queue.includes(cur)) ? [cur] : [];
  data.paused = {
    listId: session.listId,
    queue: head.concat(session.queue),
    done: session.done,
    results: session.results,
    requeued: [...session.requeued],
    pointsEarned: session.pointsEarned,
    kind: session.kind,
    cleanRun: session.cleanRun,
    // wrong tries already spent on the head word, so resuming can't reset them
    // (that turned a 5-point word back into a 10-point one)
    headTries: head.length && session.mode !== 'copy' ? session.tries : 0,
    savedAt: Date.now(),
  };
  save();
}

function startPractice(fresh = false, kind = 'practice') {
  const list = activeList();
  if (!list || !list.words.length) return;
  const p = (!fresh && kind === 'practice') ? pausedFor(list) : null;
  let words = list.words;
  if (kind === 'trouble') words = words.filter(w => troubleFor(list.id, w));
  if (!words.length) return;
  const lang = listLang(list);
  if (p) {
    session = {
      listId: list.id,
      lang,
      queue: p.queue.slice(),
      done: p.done || 0,
      current: null,
      tries: 0,
      mode: 'spell',
      requeued: new Set(p.requeued || []),
      results: p.results || {},
      pointsEarned: p.pointsEarned || 0,
      kind: p.kind || 'practice',
      cleanRun: p.cleanRun || 0,
      headTries: p.headTries || 0,   // applied to the first word nextWord() pulls
    };
  } else {
    if (kind === 'practice') { data.paused = null; save(); }
    session = {
      listId: list.id,
      lang,
      queue: kind === 'learn' ? words.slice() : shuffle(words),
      done: 0,
      current: null,
      tries: 0,           // wrong attempts on the current word
      mode: 'spell',      // 'spell' (hidden word) | 'copy' (word revealed, type it once)
      requeued: new Set(),
      results: {},        // word -> { misses, firstTry }
      pointsEarned: 0,
      kind,
      cleanRun: 0,
    };
  }
  show('practice');
  keepAudioUnmuted();   // inside the tap that started the game — iOS needs that
  $('view-practice').classList.toggle('test-mode', session.kind === 'test');
  nextWord();
}

// Delayed "next word" that only fires for the session that scheduled it.
// Quit → Resume (or a new game) within the delay used to skip a word.
function nextWordLater(ms) {
  const s = session;
  setTimeout(() => { if (session === s) nextWord(); }, ms);
}

function updateProgress() {
  const remaining = session.queue.length + (session.current ? 1 : 0);
  const total = session.done + remaining;
  $('progress-text').textContent = `⭐ ${session.done} done · ${remaining} to go`;
  $('progress-fill').style.width = total ? (session.done / total * 100) + '%' : '0%';
}

function nextWord() {
  if (!session) return;
  $('attempts').innerHTML = '';
  $('reveal-box').classList.add('hidden');
  $('btn-spellout').classList.add('hidden');
  $('result-flash').classList.add('hidden');
  $('answer').value = '';
  $('btn-check').disabled = false;
  $('answer-area').classList.remove('hidden');
  $('learn-card').classList.add('hidden');
  if (!session.queue.length) { finishSession(); return; }
  session.current = session.queue.shift();
  session.tries = session.headTries || 0;
  session.headTries = 0;
  session.lastWrong = null;
  session.mode = 'spell';
  if (!session.results[session.current]) session.results[session.current] = { misses: 0, firstTry: null };
  updateProgress();
  if (session.kind === 'learn') { renderLearnWord(); return; }
  $('prompt-msg').textContent = 'Listen… then spell it! 👂';
  renderWordPic(session.current);
  saveSession();
  speak(session.current, 1, session.lang);
  $('answer').focus();
}

function renderLearnWord() {
  const word = session.current;
  $('answer-area').classList.add('hidden');
  $('learn-card').classList.remove('hidden');
  $('prompt-msg').textContent = 'Look, listen, and say it aloud 👂';
  $('learn-word').textContent = word;
  // syllable splitting is Spanish-only logic — hide it for English lists
  const parts = session.lang === 'en' ? null : syllabifySpanish(word);
  $('learn-syllables').classList.toggle('hidden', !parts);
  $('learn-syllables').textContent = parts ? parts.join(' · ') : '';
  const stars = masteryFor(session.listId, word).stars;
  $('word-mastery').textContent = `Mastery ${'★'.repeat(stars)}${'☆'.repeat(3 - stars)}`;
  renderWordPic(word);
  saveSession();
  speak(word, 1, session.lang);
}

function finishLearnWord() {
  if (!session || !session.current) return;   // double-tap on Next skipped a word
  session.current = null;
  session.done++;
  updateProgress();
  nextWordLater(150);
}

// Prefers the enriched AI picture over the built-in emoji; falls back to emoji
// if the image never loads (e.g. offline and never cached on this device).
function renderWordPic(word, el, listId) {
  const pic = el || $('word-pic');
  const ex = wordExtra(word, listId);
  const emoji = (ex && ex.emoji) || emojiFor(word);
  if (ex && ex.image) {
    pic.innerHTML = '';
    const img = document.createElement('img');
    img.crossOrigin = 'anonymous';   // must match preloadImage so the cached copy is reused
    img.src = ex.image;
    img.alt = '';
    img.addEventListener('error', () => {
      pic.textContent = emoji || '';
      pic.classList.toggle('hidden', !emoji);
    });
    pic.appendChild(img);
    pic.classList.remove('hidden');
  } else {
    pic.textContent = emoji || '';
    pic.classList.toggle('hidden', !emoji);
  }
}

function renderAttemptRow(attempt, target) {
  const a = canon(attempt), t = canon(target);
  const row = document.createElement('div');
  row.className = 'attempt-row shake';
  const n = Math.max(a.length, t.length);
  for (let i = 0; i < n; i++) {
    const ac = a[i], tc = t[i];
    const tile = document.createElement('div');
    tile.className = 'tile';
    if ((ac === ' ' || ac === undefined) && tc === ' ') {
      tile.classList.add('space');
    } else if (ac === ' ') {
      tile.classList.add('bad');                // a space where a letter belongs
    } else if (ac === undefined) {
      tile.classList.add('missing');            // a letter is missing — empty dashed box
    } else {
      tile.textContent = ac;
      if (tc === undefined) tile.classList.add('bad');                 // extra letter
      else if (ac === tc) tile.classList.add('good');                  // right letter, right spot
      else if (stripAll(ac) === stripAll(tc)) tile.classList.add('almost'); // right letter, wrong accent
      else tile.classList.add('bad');
    }
    row.appendChild(tile);
  }
  $('attempts').appendChild(row);
  return row;
}

function flash(text, cls) {
  const el = $('result-flash');
  el.textContent = text;
  el.className = 'result-flash ' + cls;
  void el.offsetWidth;  // restart the pop animation
  el.classList.remove('hidden');
}

function completeWord() {
  session.current = null;
  session.done++;
  $('btn-check').disabled = true;
  updateProgress();
  saveSession();
  nextWordLater(1400);
}

function revealWord() {
  const word = session.current;
  session.results[word].revealed = true;   // seen the answer — no points even if she gets it right after
  $('reveal-word').textContent = word;
  $('reveal-box').classList.remove('hidden');
  $('btn-spellout').classList.remove('hidden');
  $('prompt-msg').textContent = 'Look at the word, then type it 👀';
  session.mode = 'copy';
  session.lastWrong = null;
  if (!session.requeued.has(word)) {   // sneak it back in later for a hidden re-test (once)
    session.requeued.add(word);
    const pos = Math.min(session.queue.length, 2 + Math.floor(Math.random() * (session.queue.length + 1)));
    session.queue.splice(pos, 0, word);
  }
  saveSession();
  speak(word, 1, session.lang);
  $('answer').value = '';
  $('answer').focus();
}

function check() {
  if (!session || !session.current || $('btn-check').disabled) return;
  const raw = $('answer').value;
  const word = session.current;
  if (!canon(raw)) { speak(word, 1, session.lang); return; }   // empty check = just say it again
  const res = session.results[word];

  if (session.mode === 'copy') {
    if (matches(raw, word) !== 'no') {
      chime(true);
      flash(pick(PRAISE) + ' ⭐', 'good');
      completeWord();
    } else {
      chime(false);
      renderAttemptRow(raw, word);
      $('answer').select();
    }
    return;
  }

  const m = matches(raw, word);
  // The wrong answer stays in the box, so a quick double Enter/Check used to
  // spend two tries on one mistake. Same wrong answer again = no new try.
  if (m === 'no' && canon(raw) === session.lastWrong) {
    $('prompt-msg').textContent = 'Change some letters, then check again ✏️';
    return;
  }
  if (m !== 'no') {
    if (res.firstTry === null) res.firstTry = session.tries === 0;
    // Points count once per word, and never for a word that's already been
    // revealed (a hidden re-test success afterward still counts as missed).
    if (!res.scored && !res.revealed) {
      session.pointsEarned += POINTS_BY_TRY[Math.min(session.tries, POINTS_BY_TRY.length - 1)];
      res.scored = true;
    }
    chime(true);
    const clean = session.tries === 0 && !res.revealed;
    if (clean && !res.masteryRecorded) {
      recordMastery(session.listId, word, true);
      res.masteryRecorded = true;
      session.cleanRun++;
    }
    if (m === 'accents') flash(`¡Sí! Recuerda: ${word} ✨`, 'info');
    else flash((MINI_STREAKS[session.cleanRun] || pick(PRAISE)) + ' ' + pick(['⭐', '🌟', '🎈', '🦜', '💚']), 'good');
    completeWord();
  } else {
    session.tries++;
    session.lastWrong = canon(raw);
    res.misses++;
    session.cleanRun = 0;
    if (!res.masteryRecorded) { recordMastery(session.listId, word, false); res.masteryRecorded = true; }
    if (res.firstTry === null) res.firstTry = false;
    chime(false);
    if (session.kind !== 'test') renderAttemptRow(raw, word);   // Test gives no letter feedback
    saveSession();
    const left = session.kind === 'test' ? 0 : 1 + data.settings.retries - session.tries;
    if (session.kind === 'test') {
      flash('Guardada para repasar 💪', 'info');
      completeWord();
    } else if (left > 0) {
      $('prompt-msg').textContent = left === 1
        ? 'One more try — you can do it! 💪'
        : `Try again! (${left} tries left) 💪`;
      speak(word, 1, session.lang);
      $('answer').select();
    } else {
      revealWord();
    }
  }
}

function finishSession() {
  const words = Object.keys(session.results);
  const perfect = words.filter(w => session.results[w].firstTry === true);
  const tricky = words.filter(w => session.results[w].misses > 0);

  const list = data.lists.find(l => l.id === session.listId);
  // "last time X/Y" on home describes a full Practice round, not a 2-word Trouble round
  if (list && session.kind === 'practice') list.lastResult = { perfect: perfect.length, total: words.length, at: Date.now() };
  if (session.kind !== 'learn') {
    data.progress.totalPoints += session.pointsEarned;
    updateStreak();
  }
  data.paused = null;   // finished — nothing to resume
  save();

  $('done-title').textContent = session.kind === 'learn' ? '¡Lista para practicar! 🌟' : (tricky.length === 0 ? '¡Perfecto! 🌟' : '¡Lo lograste!');
  const stars = Math.max(1, Math.round(perfect.length / Math.max(1, words.length) * 5));
  $('done-stars').textContent = session.kind === 'learn' ? '🌟' : '⭐'.repeat(stars) + '☆'.repeat(5 - stars);
  $('done-summary').textContent = session.kind === 'learn' ? `You explored all ${words.length} words` : `${perfect.length} of ${words.length} words right on the first try`;
  $('done-points').textContent = session.kind === 'learn' ? 'Now try Practice when you feel ready' : `⭐ +${session.pointsEarned} points · ${data.progress.totalPoints} total`
    + (data.progress.streak > 1 ? ` · 🔥 ${data.progress.streak}-day streak` : '');

  // "again" repeats the mode she just played (Trouble falls back to Practice
  // once no trouble words are left)
  againKind = session.kind;
  if (againKind === 'trouble' && !(list && list.words.some(w => troubleFor(list.id, w)))) againKind = 'practice';
  $('btn-again').textContent = { learn: 'Learn again 🔁', test: 'Test again 🔁', trouble: 'Trouble words again 🔁' }[againKind] || 'Practice again 🔁';

  const box = $('tricky-box'), listEl = $('tricky-list');
  listEl.innerHTML = '';
  box.classList.toggle('hidden', !tricky.length);
  const lng = session.lang;   // captured — session may be gone when the buttons fire
  tricky.forEach(w => {
    const div = document.createElement('div');
    div.className = 'tricky-item';
    const btn = document.createElement('button');
    btn.textContent = '🔊';
    btn.setAttribute('aria-label', 'Say ' + w);
    btn.addEventListener('click', () => speak(w, 1, lng));
    const span = document.createElement('span');
    span.textContent = w;
    div.append(btn, span);
    listEl.appendChild(div);
  });

  show('done');
  renderHome();
  confettiBurst();
  speak(session.kind === 'learn' ? '¡Muy bien! Ahora estás lista para practicar.' : (tricky.length === 0 ? '¡Perfecto! ¡Eres una estrella!' : '¡Muy bien! ¡Lo lograste!'));
}

/* ---------- hangman ---------- */
// Spelling hangman: the word is SPOKEN (never shown), and she builds it letter
// by letter before the little guy is fully drawn. Same leniency rules as
// typing practice: accents fold (guessing A reveals á) but ñ is its own key.
// One letter is revealed free at the start; hidden letters show as underlines.
// Points bank immediately per rescue; mastery/trouble/streak are practice-only.
const H_ROWS = ['abcdefghi', 'jklmnñopq', 'rstuvwxyz'];
const H_ROWS_EN = ['abcdefghi', 'jklmnopqr', 'stuvwxyz'];   // no ñ for English lists
const H_MAX_WRONG = 6;
const H_POINTS_PER_WIN = 5;
let hSession = null;

const hKey = ch => (ch === 'ñ' ? 'ñ' : stripAll(ch));

function startHangman() {
  const list = activeList();
  if (!list || !list.words.length) return;
  hSession = {
    listId: list.id,
    lang: listLang(list),
    queue: shuffle(list.words),
    current: null,
    chars: [],
    revealed: [],
    guessed: {},           // letter -> 'hit' | 'miss'
    wrong: 0,
    played: 0,
    solved: 0,
    requeued: new Set(),
    points: 0,
    over: false,           // current word finished (win or loss), awaiting next
  };
  $('h-play').classList.remove('hidden');
  $('h-done').classList.add('hidden');
  show('hangman');
  keepAudioUnmuted();
  hNextWord();
}

function hUpdateProgress() {
  const remaining = hSession.queue.length + (hSession.current ? 1 : 0);
  const total = hSession.played + remaining;
  $('h-progress-text').textContent = `🎈 ${hSession.played} done · ${remaining} to go`;
  $('h-progress-fill').style.width = total ? (hSession.played / total * 100) + '%' : '0%';
}

function hNextWord() {
  if (!hSession) return;   // quit while the next-word timer was pending
  if (!hSession.queue.length) { hFinish(); return; }
  const word = hSession.queue.shift();
  hSession.current = word;
  hSession.chars = canon(word).split('');
  // spaces and any non-letter characters start revealed — structure, not spelling
  hSession.revealed = hSession.chars.map(c => !/^[a-zñ]$/.test(hKey(c)));
  hSession.guessed = {};
  hSession.wrong = 0;
  hSession.over = false;
  // gift one starter letter (all its spots) when the word has letters to spare
  const distinct = [...new Set(hSession.chars.filter((c, i) => !hSession.revealed[i]).map(hKey))];
  let gift = null;
  if (distinct.length >= 3) {
    gift = pick(distinct);
    hSession.chars.forEach((c, i) => { if (hKey(c) === gift) hSession.revealed[i] = true; });
    hSession.guessed[gift] = 'hit';
  }
  hUpdateProgress();
  $('h-msg').textContent = gift
    ? `Free letter: ${gift.toUpperCase()} 🎁 Listen and find the rest!`
    : 'Listen… which letters does it have? 👂';
  renderWordPic(word, $('h-word-pic'), hSession.listId);
  hDraw();
  hRenderTiles(false);
  hRenderKeys();
  speak(word, 1, hSession.lang);
}

function hDraw() {
  for (let i = 1; i <= H_MAX_WRONG; i++)
    $('h-part-' + i).classList.toggle('hidden', i > hSession.wrong);
}

function hRenderTiles(showAll) {
  const box = $('h-tiles');
  box.innerHTML = '';
  hSession.chars.forEach((c, i) => {
    const tile = document.createElement('div');
    tile.className = 'tile';
    if (c === ' ') {
      tile.classList.add('space');
    } else if (hSession.revealed[i]) {
      tile.textContent = c;
      tile.classList.add('good');
    } else if (showAll) {
      tile.textContent = c;      // the letters she didn't find, shown on a loss
      tile.classList.add('bad');
    } else {
      tile.classList.add('missing');   // empty underline
    }
    box.appendChild(tile);
  });
}

function hRenderKeys() {
  const box = $('h-keys');
  box.innerHTML = '';
  (hSession.lang === 'en' ? H_ROWS_EN : H_ROWS).forEach(row => {
    const r = document.createElement('div');
    r.className = 'h-krow';
    row.split('').forEach(ch => {
      const b = document.createElement('button');
      b.className = 'h-key';
      b.textContent = ch;
      const st = hSession.guessed[ch];
      if (st) b.classList.add(st);
      if (st || hSession.over) b.disabled = true;
      b.addEventListener('click', () => hGuess(ch));
      r.appendChild(b);
    });
    box.appendChild(r);
  });
}

function hGuess(ch) {
  if (!hSession || hSession.over || hSession.guessed[ch]) return;
  let hit = false;
  hSession.chars.forEach((c, i) => {
    if (!hSession.revealed[i] && hKey(c) === ch) {
      hSession.revealed[i] = true;
      hit = true;
    }
  });
  hSession.guessed[ch] = hit ? 'hit' : 'miss';
  if (hit) {
    chime(true);
    hRenderTiles(false);
    if (hSession.revealed.every(Boolean)) { hWordDone(true); return; }
    $('h-msg').textContent = pick(['¡Sí! 🎉', '¡Eso es! ⭐', '¡Bien! 🦜', '¡Genial! 💚']);
  } else {
    hSession.wrong++;
    chime(false);
    hDraw();
    const left = H_MAX_WRONG - hSession.wrong;
    if (left <= 0) { hWordDone(false); return; }
    $('h-msg').textContent = left === 1
      ? '¡Cuidado! Only 1 miss left 😬'
      : `No ${ch.toUpperCase()} in this word… ${left} misses left`;
  }
  hRenderKeys();
}

function hWordDone(win) {
  const word = hSession.current;
  hSession.over = true;
  hSession.played++;
  hSession.current = null;
  hRenderKeys();
  if (win) {
    hSession.solved++;
    hSession.points += H_POINTS_PER_WIN;
    data.progress.totalPoints += H_POINTS_PER_WIN;   // banked right away — quitting keeps them
    save();
    chime(true);
    hRenderTiles(false);
    $('h-msg').textContent = `${pick(PRAISE)} ⭐ +${H_POINTS_PER_WIN} points`;
    speak(pick(PRAISE));
  } else {
    hRenderTiles(true);
    $('h-msg').textContent = `The word was “${word}” — it'll come back! 💪`;
    speak(word, 1, hSession.lang);
    if (!hSession.requeued.has(word)) {   // one more chance at the end of the round
      hSession.requeued.add(word);
      hSession.queue.push(word);
    }
  }
  hUpdateProgress();
  const s = hSession;   // only for THIS game — quit + 🎈 again used to skip a word
  setTimeout(() => { if (hSession === s) hNextWord(); }, win ? 1600 : 2600);
}

function hFinish() {
  const s = hSession;
  const perfect = s.solved === s.played && s.played > 0;
  $('h-play').classList.add('hidden');
  $('h-done').classList.remove('hidden');
  $('h-done-emoji').textContent = perfect ? '🌟' : '🎈';
  $('h-done-title').textContent = perfect ? '¡Increíble!' : '¡Juego terminado!';
  $('h-done-summary').textContent = `You rescued the little guy ${s.solved} of ${s.played} times`;
  $('h-done-points').textContent = `⭐ +${s.points} points · ${data.progress.totalPoints} total`;
  renderHome();
  if (s.solved > 0) confettiBurst();
  speak(perfect ? '¡Increíble! ¡Eres una estrella!' : '¡Muy bien! ¡Qué divertido!');
}

/* ---------- confetti ---------- */
function confettiBurst() {
  const canvas = $('confetti');
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  canvas.width = innerWidth * dpr;
  canvas.height = innerHeight * dpr;
  ctx.scale(dpr, dpr);
  const colors = ['#FF6B6B', '#0FB9B1', '#FFC145', '#845EF0', '#35C46F'];
  const parts = Array.from({ length: 140 }, () => ({
    x: Math.random() * innerWidth,
    y: -20 - Math.random() * innerHeight * 0.5,
    w: 6 + Math.random() * 6,
    h: 8 + Math.random() * 8,
    c: pick(colors),
    vy: 2 + Math.random() * 3,
    vx: -1.5 + Math.random() * 3,
    rot: Math.random() * Math.PI,
    vr: -0.15 + Math.random() * 0.3,
  }));
  const t0 = performance.now();
  (function frame(t) {
    ctx.clearRect(0, 0, innerWidth, innerHeight);
    parts.forEach(p => {
      p.x += p.vx; p.y += p.vy; p.rot += p.vr;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.fillStyle = p.c;
      ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      ctx.restore();
    });
    if (t - t0 < 3200) requestAnimationFrame(frame);
    else ctx.clearRect(0, 0, innerWidth, innerHeight);
  })(t0);
}

/* ---------- settings ---------- */
function fillVoiceSelect(sel, pool, autoLabel, savedURI) {
  if (!sel) return;
  sel.innerHTML = '';
  const auto = document.createElement('option');
  auto.value = '';
  auto.textContent = autoLabel;
  sel.appendChild(auto);
  pool.forEach(v => {
    const o = document.createElement('option');
    o.value = v.voiceURI;
    o.textContent = `${v.name} (${v.lang})`;
    sel.appendChild(o);
  });
  sel.value = pool.some(v => v.voiceURI === savedURI) ? savedURI : '';
}

function populateVoiceSelect() {
  fillVoiceSelect($('voice-select'), spanishVoices(), 'Auto — best Spanish voice', data.settings.voiceURI);
  fillVoiceSelect($('voice-select-en'), englishVoices(), 'Auto — best English voice', data.settings.voiceURIEn);
}

function applySettingsUI() {
  $('rate-slider').value = data.settings.rate;
  $('rate-value').textContent = Number(data.settings.rate).toFixed(2) + '× speed';
  $('strict-toggle').checked = !!data.settings.strict;
  $('retries-select').value = String(data.settings.retries);
  $('version-line').textContent = 'Palabritas v' + APP_VERSION + ' · words are stored only on this device';
  populateVoiceSelect();
}

/* ---------- wire up ---------- */
function init() {
  $('btn-learn').addEventListener('click', () => startPractice(true, 'learn'));
  $('btn-practice').addEventListener('click', () => startPractice(false, 'practice'));
  $('btn-test').addEventListener('click', () => startPractice(true, 'test'));
  $('btn-trouble').addEventListener('click', () => startPractice(true, 'trouble'));
  $('btn-startover').addEventListener('click', () => startPractice(true, 'practice'));
  $('btn-learn-next').addEventListener('click', finishLearnWord);
  $('btn-new-list').addEventListener('click', () => openEdit(null));
  $('btn-edit-active').addEventListener('click', () => activeList() && openEdit(activeList().id));
  $('btn-settings').addEventListener('click', () => { applySettingsUI(); show('settings'); });
  $('btn-voice-banner-close').addEventListener('click', () => {
    sessionStorage.setItem('voiceBannerDismissed', '1');
    updateVoiceBanner();
  });

  $('btn-edit-back').addEventListener('click', () => { stopImageGen(); show('home'); });
  $('lang-es').addEventListener('click', () => setEditingLang('es'));
  $('lang-en').addEventListener('click', () => setEditingLang('en'));
  $('words-input').addEventListener('input', renderChips);
  $('btn-save-list').addEventListener('click', saveList);
  $('btn-delete-list').addEventListener('click', deleteList);
  $('btn-share-active').addEventListener('click', shareActiveList);
  $('btn-cloud-save').addEventListener('click', cloudSaveActiveList);
  $('btn-gen-images').addEventListener('click', generateImages);
  $('btn-sentence').addEventListener('click', () => session && session.current && speakSentence(session.current));

  $('btn-quit').addEventListener('click', () => {
    if (hasSpeech) try { speechSynthesis.cancel(); } catch (e) {}
    session = null;
    renderHome();
    show('home');
  });
  $('btn-say').addEventListener('click', () => session && session.current && speak(session.current, 1, session.lang));
  $('btn-slow').addEventListener('click', () => session && session.current && speak(session.current, 0.55, session.lang));
  $('btn-spellout').addEventListener('click', () => session && session.current && speakSpelled(session.current, session.lang));
  $('btn-check').addEventListener('click', check);
  // don't let tapping Check blur the input — iOS won't reopen the keyboard from a timer
  $('btn-check').addEventListener('pointerdown', e => e.preventDefault());
  $('answer').addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); check(); }
  });
  document.querySelectorAll('.accent-btn').forEach(btn => {
    btn.addEventListener('pointerdown', e => {
      e.preventDefault();  // keep the keyboard open and focus on the input
      const input = $('answer');
      const s = input.selectionStart ?? input.value.length;
      const en = input.selectionEnd ?? input.value.length;
      input.value = input.value.slice(0, s) + btn.textContent + input.value.slice(en);
      input.focus();
      const np = s + btn.textContent.length;
      try { input.setSelectionRange(np, np); } catch (err) {}
    });
  });

  $('btn-again').addEventListener('click', () => startPractice(true, againKind));
  $('btn-done-home').addEventListener('click', () => { renderHome(); show('home'); });

  $('btn-hangman').addEventListener('click', startHangman);
  $('h-quit').addEventListener('click', () => {
    if (hasSpeech) try { speechSynthesis.cancel(); } catch (e) {}
    hSession = null;
    renderHome();
    show('home');
  });
  $('h-say').addEventListener('click', () => hSession && hSession.current && speak(hSession.current, 1, hSession.lang));
  $('h-slow').addEventListener('click', () => hSession && hSession.current && speak(hSession.current, 0.55, hSession.lang));
  $('h-sentence').addEventListener('click', () => hSession && hSession.current && speakSentence(hSession.current, hSession.listId));
  $('h-again').addEventListener('click', startHangman);
  $('h-home').addEventListener('click', () => { hSession = null; renderHome(); show('home'); });

  $('btn-settings-back').addEventListener('click', () => { renderHome(); show('home'); });
  $('voice-select').addEventListener('change', e => { data.settings.voiceURI = e.target.value; save(); });
  $('btn-test-voice').addEventListener('click', () => speak('¡Hola! ¿Lista para practicar? Mariposa.'));
  $('voice-select-en').addEventListener('change', e => { data.settings.voiceURIEn = e.target.value; save(); });
  $('btn-test-voice-en').addEventListener('click', () => speak('Hello! Ready to practice? Butterfly.', 1, 'en'));
  $('rate-slider').addEventListener('input', e => {
    data.settings.rate = Number(e.target.value);
    $('rate-value').textContent = data.settings.rate.toFixed(2) + '× speed';
    save();
  });
  $('strict-toggle').addEventListener('change', e => { data.settings.strict = e.target.checked; save(); });
  $('retries-select').addEventListener('change', e => { data.settings.retries = Number(e.target.value); save(); });

  renderHome();
  applySettingsUI();
}

init();
// Upload anything still waiting (⏳) first, so the sync that follows sees the
// freshest files; then pull. Also retry the moment a connection comes back.
retryPendingPublishes().then(syncCloudLists);
window.addEventListener('online', retryPendingPublishes);

/* ---------- offline support ---------- */
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  });
}
