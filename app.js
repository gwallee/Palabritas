'use strict';
/* Palabritas — Spanish spelling practice PWA */

const APP_VERSION = '1.8.2';

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
  settings: { voiceURI: '', rate: 0.95, strict: false, retries: 2 },
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
const canon = s => s.trim().toLowerCase().replace(/\s+/g, ' ');
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

function spanishVoices() {
  return voices.filter(v => (v.lang || '').toLowerCase().replace('_', '-').startsWith('es'));
}

function pickVoice() {
  const wanted = data.settings.voiceURI;
  if (wanted) {
    const v = voices.find(v => v.voiceURI === wanted);
    if (v) return v;
  }
  const es = spanishVoices();
  for (const p of ['es-mx', 'es-us', 'es-419', 'es-co', 'es-ar', 'es']) {
    const v = es.find(v => v.lang.toLowerCase().replace('_', '-').startsWith(p));
    if (v) return v;
  }
  return null;
}

function speak(text, rateMul = 1) {
  if (!hasSpeech) return;
  audioSessionPlayback();
  try { speechSynthesis.cancel(); } catch (e) {}
  const u = new SpeechSynthesisUtterance(text);
  const v = pickVoice();
  if (v) { u.voice = v; u.lang = v.lang; }
  else { u.lang = 'es-MX'; }  // even with no voice list, iOS honors the lang
  u.rate = Math.max(0.4, Math.min(1.5, data.settings.rate * rateMul));
  speechSynthesis.speak(u);
}

const speakSpelled = word => speak(word.split('').filter(c => c.trim()).join(', '), 0.9);

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
    if (audioCtx.state === 'suspended') audioCtx.resume();
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
    $('active-name').textContent = list.name;
    let meta = list.words.length + ' words';
    if (list.lastResult) meta += ` · last time ${list.lastResult.perfect}/${list.lastResult.total} on the first try`;
    const mastered = list.words.filter(w => masteryFor(list.id, w).stars === 3).length;
    if (mastered) meta += ` · ${mastered}/${list.words.length} mastered ⭐`;
    $('active-count').textContent = meta;
    const p = pausedFor(list);
    $('btn-practice').innerHTML = p
      ? `▶&nbsp;&nbsp;Resume — ${p.queue.length} to go`
      : '▶&nbsp;&nbsp;¡A practicar!';
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
      nm.textContent = l.name;
      const meta = document.createElement('div');
      meta.className = 'past-meta';
      meta.textContent = l.words.length + ' words';
      info.append(nm, meta);
      const use = document.createElement('button');
      use.textContent = 'Use';
      use.addEventListener('click', () => { data.activeListId = l.id; save(); renderHome(); });
      const del = document.createElement('button');
      del.className = 'past-del';
      del.textContent = '🗑';
      del.addEventListener('click', () => {
        if (!confirm(`Delete "${l.name}"?`)) return;
        data.lists = data.lists.filter(x => x.id !== l.id);
        save(); renderHome();
      });
      item.append(info, use, del);
      box.appendChild(item);
    });
  }
}

/* ---------- edit / new list ---------- */
let editingId = null;

const defaultListName = () =>
  'Week of ' + new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

function parseWords(text) {
  const out = [], seen = new Set();
  text.split(/[\n,;•·|]+/).forEach(raw => {
    if (/^\s*📚/.test(raw)) return;   // header line from a shared list
    const w = raw
      .replace(/^\s*\d+\s*[.):\-]*\s*/, '')            // leading "1." "2)" numbering
      .replace(/^[\s\-–—*✓✔☐□]+/, '')                  // leading bullets/dashes
      .replace(/[.,;:!?¡¿"“”'']+\s*$/g, '')            // trailing punctuation
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

async function generateImages() {
  const words = parseWords($('words-input').value);
  if (!words.length) { alert('Add some words first 🙂'); return; }
  const todo = words.filter(w => !(editingExtras[canon(w)] && editingExtras[canon(w)].image));
  if (!todo.length) { alert('Every word already has a picture!'); return; }
  const btn = $('btn-gen-images');
  btn.disabled = true;
  for (let i = 0; i < todo.length; i++) {
    const w = todo[i];
    setGenProgress(`Generating pictures… ${i + 1} of ${todo.length}`, i / todo.length);
    try {
      const url = pollinationsUrl(w);
      await preloadImage(url);
      editingExtras[canon(w)] = { ...(editingExtras[canon(w)] || {}), image: url };
      renderPicGrid();
    } catch (e) { /* generation failed — this word just falls back to emoji */ }
    if (i < todo.length - 1) await new Promise(r => setTimeout(r, 2500));  // free-tier: 1 request at a time
  }
  setGenProgress("Done! Tap ✕ on any picture you don't like to use the emoji instead.", 1);
  btn.disabled = false;
}

function openEdit(listId) {
  editingId = listId || null;
  const list = listId ? data.lists.find(l => l.id === listId) : null;
  $('edit-title').textContent = list ? 'Edit list' : 'New word list';
  $('list-name').value = list ? list.name : defaultListName();
  $('words-input').value = list ? list.words.join('\n') : '';
  $('btn-delete-list').classList.toggle('hidden', !list);
  $('gen-progress').classList.add('hidden');
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

// If a shared list was pasted in, lift its "📚 name" header into the name field.
function absorbSharedName() {
  const ta = $('words-input');
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
  if (editingId) {
    const list = data.lists.find(l => l.id === editingId);
    list.name = name;
    list.words = words;
    list.extras = buildExtras(words, list.extras);
    data.activeListId = list.id;
    if (data.paused && data.paused.listId === editingId) data.paused = null;  // words changed
  } else {
    const extras = buildExtras(words, null);
    data.lists.unshift({ id: 'l' + Date.now(), name, words, extras, createdAt: Date.now() });
    data.activeListId = data.lists[0].id;
  }
  save(); renderHome(); show('home');
}

async function shareActiveList() {
  const list = activeList();
  if (!list) return;
  const text = `📚 ${list.name}\n${list.words.join('\n')}\n\nOpen Palabritas → New word list → paste this in!\nhttps://gwallee.github.io/Palabritas/`;
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
const CLOUD_SYNC_URL = '';

function slugify(text) {
  return stripVowelAccents(String(text).toLowerCase())
    .replace(/ñ/g, 'n')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'lista';
}

// ☁️ Save to cloud. With CLOUD_SYNC_URL set, POST the list to the Apps Script
// relay, which commits it to lists/ — works from any phone, no GitHub account.
// Without it, fall back to opening GitHub's prefilled new-file commit page
// (only completes for someone signed in with write access).
function cloudSaveActiveList() {
  const list = activeList();
  if (!list) return;
  const isCloud = list.id.startsWith('cloud-');

  if (!CLOUD_SYNC_URL) {
    if (isCloud) { alert('This list is already in the cloud.'); return; }
    const id = new Date().toISOString().slice(0, 10) + '-' + slugify(list.name);
    const payload = { id, name: list.name, words: list.words };
    if (list.extras && Object.keys(list.extras).length) payload.extras = list.extras;
    const body = JSON.stringify(payload, null, 2) + '\n';
    const url = 'https://github.com/' + REPO + '/new/main'
      + '?filename=' + encodeURIComponent('lists/' + id + '.json')
      + '&value=' + encodeURIComponent(body);
    window.open(url, '_blank');
    return;
  }

  if (isCloud && !confirm('Update the cloud copy of this list for everyone?')) return;
  const id = isCloud
    ? list.id.slice('cloud-'.length)
    : new Date().toISOString().slice(0, 10) + '-' + slugify(list.name);
  const payload = { id, name: list.name, words: list.words };
  if (list.extras && Object.keys(list.extras).length) payload.extras = list.extras;
  cloudPost(payload);
}

async function cloudPost(payload) {
  const btn = $('btn-cloud-save');
  const oldLabel = btn.textContent;
  btn.disabled = true;
  btn.textContent = '☁️ Saving…';
  try {
    // text/plain keeps this a "simple" CORS request — Apps Script cannot answer
    // a preflight OPTIONS (same trick as MathFacts; do not change to JSON).
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 25000);
    const r = await fetch(CLOUD_SYNC_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(payload),
      signal: ctrl.signal,
    });
    clearTimeout(timer);
    const res = await r.json();
    if (!res.ok) throw new Error(res.error || 'The cloud said no');
    alert('✅ Saved to the cloud!\n\nIt will show up on the other phone the next time the app opens online.');
    syncCloudLists();   // promote the local copy to its cloud- id right away
  } catch (e) {
    const why = e.name === 'AbortError' ? 'it took too long' : (e.message || 'no connection');
    alert('Could not save to the cloud (' + why + ').\n\nThe list is still safe on this phone — try again later, or use 📤 Share list.');
  } finally {
    btn.disabled = false;
    btn.textContent = oldLabel;
  }
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
      try {
        const fr = await fetch(f.download_url, { cache: 'no-cache' });
        if (!fr.ok) continue;
        const j = await fr.json();
        entries.push({ id, name: j.name, words: j.words, extras: j.extras, sha: f.sha });
      } catch (e) { /* skip malformed/unreachable file */ }
    }
  } catch (e) { /* offline — no problem */ }
  return entries;
}

// After a list is committed to the cloud and synced back, drop the local copy
// it was promoted from (same name, same words) so it doesn't show up twice.
function dropPromotedLocal(cloudId, name, words) {
  const key = words.map(canon).sort().join('\n');
  const dup = data.lists.find(l =>
    !l.id.startsWith('cloud-') &&
    canon(l.name) === canon(name) &&
    l.words.length === words.length &&
    l.words.map(canon).sort().join('\n') === key);
  if (!dup) return;
  data.lists = data.lists.filter(l => l.id !== dup.id);
  if (data.activeListId === dup.id) data.activeListId = cloudId;
  if (data.paused && data.paused.listId === dup.id) data.paused = null;
}

async function syncCloudLists() {
  try {
    const entries = [];
    const legacy = await fetchListsJson();
    if (Array.isArray(legacy)) legacy.forEach(e => entries.push(e));
    (await fetchCloudFiles()).forEach(e => entries.push(e));
    let changed = false;
    const addedIds = [];
    entries.forEach(cl => {
      if (!cl || !cl.id || !Array.isArray(cl.words) || !cl.words.length) return;
      const id = 'cloud-' + String(cl.id);
      const name = String(cl.name || cl.id);
      const words = cl.words.map(String);
      const extras = (cl.extras && typeof cl.extras === 'object') ? cl.extras : undefined;
      const existing = data.lists.find(l => l.id === id);
      if (existing) {   // the repo is the source of truth for cloud lists
        if (existing.name !== name || JSON.stringify(existing.words) !== JSON.stringify(words)) {
          existing.name = name;
          existing.words = words;
          if (data.paused && data.paused.listId === id) data.paused = null;
          changed = true;
        }
        if (JSON.stringify(existing.extras || null) !== JSON.stringify(extras || null)) {
          existing.extras = extras;   // enrichment arriving later shouldn't clear a pause
          changed = true;
        }
        if (cl.sha && existing.cloudSha !== cl.sha) { existing.cloudSha = cl.sha; changed = true; }
      } else {
        data.lists.unshift({ id, name, words, extras, createdAt: Date.now(), cloudSha: cl.sha });
        dropPromotedLocal(id, name, words);
        addedIds.push(id);
        changed = true;
      }
    });
    if (addedIds.length) data.activeListId = addedIds[0];  // entries arrive newest-first
    if (changed) { save(); renderHome(); }
  } catch (e) { /* offline — no problem */ }
}

function deleteList() {
  if (!editingId || !confirm('Delete this list?')) return;
  data.lists = data.lists.filter(l => l.id !== editingId);
  if (data.paused && data.paused.listId === editingId) data.paused = null;
  if (data.activeListId === editingId) data.activeListId = data.lists.length ? data.lists[0].id : null;
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
  let w = canon(word).replace(/^(el|la|los|las|un|una|unos|unas)\s+/, '');
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
  const ex = wordExtra(word, listId);
  if (ex && ex.sentence) { speak(ex.sentence, 0.92); return; }
  speak(pick(SENTENCE_FRAMES).replace('{w}', word), 0.95);
}

/* ---------- practice ---------- */
const PRAISE = ['¡Muy bien!', '¡Excelente!', '¡Perfecto!', '¡Genial!', '¡Fantástico!', '¡Súper!', '¡Increíble!', '¡Qué buena ortografía!', '¡Lo clavaste!', '¡Eres una campeona!'];
const MINI_STREAKS = { 3: '🔥 ¡3 seguidas!', 5: '🌟 ¡5 seguidas! ¡Imparable!', 10: '🚀 ¡10 seguidas! ¡Sensacional!' };
// Points for a correct answer, indexed by how many wrong tries came first
// (index 2 covers "3rd try or later"). A word that gets revealed earns 0.
const POINTS_BY_TRY = [10, 8, 5];
let session = null;

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
  // The in-progress word goes back to the front (fresh tries on resume);
  // in copy mode it's already re-queued, so don't add it twice.
  const head = (session.mode !== 'copy' && session.current) ? [session.current] : [];
  data.paused = {
    listId: session.listId,
    queue: head.concat(session.queue),
    done: session.done,
    results: session.results,
    requeued: [...session.requeued],
    pointsEarned: session.pointsEarned,
    kind: session.kind,
    cleanRun: session.cleanRun,
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
  if (p) {
    session = {
      listId: list.id,
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
    };
  } else {
    if (kind === 'practice') { data.paused = null; save(); }
    session = {
      listId: list.id,
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
  $('view-practice').classList.toggle('test-mode', session.kind === 'test');
  nextWord();
}

function updateProgress() {
  const remaining = session.queue.length + (session.current ? 1 : 0);
  const total = session.done + remaining;
  $('progress-text').textContent = `⭐ ${session.done} done · ${remaining} to go`;
  $('progress-fill').style.width = total ? (session.done / total * 100) + '%' : '0%';
}

function nextWord() {
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
  session.tries = 0;
  session.mode = 'spell';
  if (!session.results[session.current]) session.results[session.current] = { misses: 0, firstTry: null };
  updateProgress();
  if (session.kind === 'learn') { renderLearnWord(); return; }
  $('prompt-msg').textContent = 'Listen… then spell it! 👂';
  renderWordPic(session.current);
  saveSession();
  speak(session.current);
  $('answer').focus();
}

function renderLearnWord() {
  const word = session.current;
  $('answer-area').classList.add('hidden');
  $('learn-card').classList.remove('hidden');
  $('prompt-msg').textContent = 'Look, listen, and say it aloud 👂';
  $('learn-word').textContent = word;
  const parts = syllabifySpanish(word);
  $('learn-syllables').classList.toggle('hidden', !parts);
  $('learn-syllables').textContent = parts ? parts.join(' · ') : '';
  const stars = masteryFor(session.listId, word).stars;
  $('word-mastery').textContent = `Mastery ${'★'.repeat(stars)}${'☆'.repeat(3 - stars)}`;
  renderWordPic(word);
  saveSession();
  speak(word);
}

function finishLearnWord() {
  session.current = null;
  session.done++;
  updateProgress();
  setTimeout(nextWord, 150);
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
    if (ac === ' ' || (ac === undefined && tc === ' ')) {
      tile.classList.add('space');
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
  setTimeout(nextWord, 1400);
}

function revealWord() {
  const word = session.current;
  session.results[word].revealed = true;   // seen the answer — no points even if she gets it right after
  $('reveal-word').textContent = word;
  $('reveal-box').classList.remove('hidden');
  $('btn-spellout').classList.remove('hidden');
  $('prompt-msg').textContent = 'Look at the word, then type it 👀';
  session.mode = 'copy';
  if (!session.requeued.has(word)) {   // sneak it back in later for a hidden re-test (once)
    session.requeued.add(word);
    const pos = Math.min(session.queue.length, 2 + Math.floor(Math.random() * (session.queue.length + 1)));
    session.queue.splice(pos, 0, word);
  }
  saveSession();
  speak(word);
  $('answer').value = '';
  $('answer').focus();
}

function check() {
  if (!session || !session.current || $('btn-check').disabled) return;
  const raw = $('answer').value;
  const word = session.current;
  if (!canon(raw)) { speak(word); return; }   // empty check = just say it again
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
    res.misses++;
    session.cleanRun = 0;
    if (!res.masteryRecorded) { recordMastery(session.listId, word, false); res.masteryRecorded = true; }
    if (res.firstTry === null) res.firstTry = false;
    chime(false);
    renderAttemptRow(raw, word);
    saveSession();
    const left = session.kind === 'test' ? 0 : 1 + data.settings.retries - session.tries;
    if (session.kind === 'test') {
      flash('Guardada para repasar 💪', 'info');
      completeWord();
    } else if (left > 0) {
      $('prompt-msg').textContent = left === 1
        ? 'One more try — you can do it! 💪'
        : `Try again! (${left} tries left) 💪`;
      speak(word);
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
  if (list && session.kind !== 'learn') list.lastResult = { perfect: perfect.length, total: words.length, at: Date.now() };
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

  const box = $('tricky-box'), listEl = $('tricky-list');
  listEl.innerHTML = '';
  box.classList.toggle('hidden', !tricky.length);
  tricky.forEach(w => {
    const div = document.createElement('div');
    div.className = 'tricky-item';
    const btn = document.createElement('button');
    btn.textContent = '🔊';
    btn.setAttribute('aria-label', 'Say ' + w);
    btn.addEventListener('click', () => speak(w));
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
const H_MAX_WRONG = 6;
const H_POINTS_PER_WIN = 5;
let hSession = null;

const hKey = ch => (ch === 'ñ' ? 'ñ' : stripAll(ch));

function startHangman() {
  const list = activeList();
  if (!list || !list.words.length) return;
  hSession = {
    listId: list.id,
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
  speak(word);
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
  H_ROWS.forEach(row => {
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
    speak(word);
    if (!hSession.requeued.has(word)) {   // one more chance at the end of the round
      hSession.requeued.add(word);
      hSession.queue.push(word);
    }
  }
  hUpdateProgress();
  setTimeout(hNextWord, win ? 1600 : 2600);
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
function populateVoiceSelect() {
  const sel = $('voice-select');
  if (!sel) return;
  const es = spanishVoices();
  sel.innerHTML = '';
  const auto = document.createElement('option');
  auto.value = '';
  auto.textContent = 'Auto — best Spanish voice';
  sel.appendChild(auto);
  es.forEach(v => {
    const o = document.createElement('option');
    o.value = v.voiceURI;
    o.textContent = `${v.name} (${v.lang})`;
    sel.appendChild(o);
  });
  sel.value = es.some(v => v.voiceURI === data.settings.voiceURI) ? data.settings.voiceURI : '';
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

  $('btn-edit-back').addEventListener('click', () => show('home'));
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
  $('btn-say').addEventListener('click', () => session && session.current && speak(session.current));
  $('btn-slow').addEventListener('click', () => session && session.current && speak(session.current, 0.55));
  $('btn-spellout').addEventListener('click', () => session && session.current && speakSpelled(session.current));
  $('btn-check').addEventListener('click', check);
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

  $('btn-again').addEventListener('click', () => startPractice(true));
  $('btn-done-home').addEventListener('click', () => { renderHome(); show('home'); });

  $('btn-hangman').addEventListener('click', startHangman);
  $('h-quit').addEventListener('click', () => {
    if (hasSpeech) try { speechSynthesis.cancel(); } catch (e) {}
    hSession = null;
    renderHome();
    show('home');
  });
  $('h-say').addEventListener('click', () => hSession && hSession.current && speak(hSession.current));
  $('h-slow').addEventListener('click', () => hSession && hSession.current && speak(hSession.current, 0.55));
  $('h-sentence').addEventListener('click', () => hSession && hSession.current && speakSentence(hSession.current, hSession.listId));
  $('h-again').addEventListener('click', startHangman);
  $('h-home').addEventListener('click', () => { hSession = null; renderHome(); show('home'); });

  $('btn-settings-back').addEventListener('click', () => { renderHome(); show('home'); });
  $('voice-select').addEventListener('change', e => { data.settings.voiceURI = e.target.value; save(); });
  $('btn-test-voice').addEventListener('click', () => speak('¡Hola! ¿Lista para practicar? Mariposa.'));
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
syncCloudLists();

/* ---------- offline support ---------- */
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  });
}
