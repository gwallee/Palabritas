'use strict';
/* Palabritas — Spanish spelling practice PWA */

const APP_VERSION = '1.4.0';

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
};

function load() {
  try {
    const raw = JSON.parse(localStorage.getItem('palabritas') || 'null');
    if (raw) return { ...DEFAULTS, ...raw, settings: { ...DEFAULTS.settings, ...(raw.settings || {}) } };
  } catch (e) { /* corrupted storage — start fresh */ }
  return JSON.parse(JSON.stringify(DEFAULTS));
}
let data = load();
const save = () => localStorage.setItem('palabritas', JSON.stringify(data));
const activeList = () => data.lists.find(l => l.id === data.activeListId) || null;

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
let audioCtx = null;
function chime(good) {
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
    const notes = good ? [523.25, 783.99] : [220];
    notes.forEach((f, i) => {
      const o = audioCtx.createOscillator(), g = audioCtx.createGain();
      o.type = 'sine';
      o.frequency.value = f;
      const t = audioCtx.currentTime + i * 0.09;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(good ? 0.12 : 0.07, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.25);
      o.connect(g); g.connect(audioCtx.destination);
      o.start(t); o.stop(t + 0.3);
    });
  } catch (e) {}
}

/* ---------- views ---------- */
function show(name) {
  ['home', 'edit', 'practice', 'done', 'settings'].forEach(v =>
    $('view-' + v).classList.toggle('hidden', v !== name));
  if (name !== 'edit') releaseOcr();   // free OCR memory when leaving the editor
  window.scrollTo(0, 0);
}

/* ---------- home ---------- */
function renderHome() {
  const list = activeList();
  $('active-card').classList.toggle('hidden', !list);
  $('empty-card').classList.toggle('hidden', !!list);
  if (list) {
    $('active-name').textContent = list.name;
    let meta = list.words.length + ' words';
    if (list.lastResult) meta += ` · last time ${list.lastResult.perfect}/${list.lastResult.total} on the first try`;
    $('active-count').textContent = meta;
    const p = pausedFor(list);
    $('btn-practice').innerHTML = p
      ? `▶&nbsp;&nbsp;Resume — ${p.queue.length} to go`
      : '▶&nbsp;&nbsp;¡A practicar!';
    $('btn-startover').classList.toggle('hidden', !p);
    $('btn-cloud-save').classList.toggle('hidden', list.id.startsWith('cloud-'));
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
    // OCR/typing noise filters: needs at least 2 letters, no digits, sane length
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

/* ---------- photo scan (on-device OCR) ---------- */
let ocrWorker = null;

async function getOcrWorker() {
  if (ocrWorker) return ocrWorker;
  const base = new URL('.', location.href).href;
  ocrWorker = await Tesseract.createWorker('spa', 1, {
    workerPath: base + 'vendor/worker.min.js',
    corePath: base + 'vendor/core',
    langPath: base + 'vendor/lang',
    gzip: true,
    workerBlobURL: false,
    logger: m => {
      if (m.status === 'recognizing text') setScanProgress('Reading the words…', 0.2 + m.progress * 0.8);
    },
  });
  return ocrWorker;
}

function releaseOcr() {
  if (ocrWorker) {
    try { ocrWorker.terminate(); } catch (e) {}
    ocrWorker = null;
  }
  $('scan-progress').classList.add('hidden');
}

function setScanProgress(text, frac) {
  $('scan-progress').classList.remove('hidden');
  $('scan-status').textContent = text;
  $('scan-fill').style.width = Math.round(Math.max(0, Math.min(1, frac || 0)) * 100) + '%';
}

// Draw the photo onto a canvas (downscaled) so EXIF rotation is applied and OCR is fast.
async function photoToCanvas(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const scale = Math.min(1, 1700 / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
    canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas;
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function scanPhoto(file) {
  const btn = $('btn-scan');
  btn.disabled = true;
  try {
    setScanProgress('Warming up the scanner…', 0.05);
    const canvas = await photoToCanvas(file);
    const worker = await getOcrWorker();
    setScanProgress('Reading the words…', 0.2);
    const { data } = await worker.recognize(canvas);
    const found = parseWords(data.text || '');
    if (!found.length) {
      setScanProgress('No words found — try a closer, straight-on photo in good light.', 0);
    } else {
      const existing = $('words-input').value.trim();
      $('words-input').value = (existing ? existing + '\n' : '') + found.join('\n');
      renderChips();
      setScanProgress(`Found ${found.length} word${found.length === 1 ? '' : 's'} — check them and remove any strays.`, 1);
    }
  } catch (err) {
    setScanProgress("Scanning didn't work — you can still type or paste the words.", 0);
    releaseOcr();
  } finally {
    btn.disabled = false;
  }
}

function openEdit(listId) {
  editingId = listId || null;
  const list = listId ? data.lists.find(l => l.id === listId) : null;
  $('edit-title').textContent = list ? 'Edit list' : 'New word list';
  $('list-name').value = list ? list.name : defaultListName();
  $('words-input').value = list ? list.words.join('\n') : '';
  $('btn-delete-list').classList.toggle('hidden', !list);
  $('scan-progress').classList.add('hidden');
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
}

function saveList() {
  const words = parseWords($('words-input').value);
  if (!words.length) { alert('Add at least one word first 🙂'); return; }
  const name = $('list-name').value.trim() || defaultListName();
  if (editingId) {
    const list = data.lists.find(l => l.id === editingId);
    list.name = name;
    list.words = words;
    data.activeListId = list.id;
    if (data.paused && data.paused.listId === editingId) data.paused = null;  // words changed
  } else {
    data.lists.unshift({ id: 'l' + Date.now(), name, words, createdAt: Date.now() });
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

function slugify(text) {
  return stripVowelAccents(String(text).toLowerCase())
    .replace(/ñ/g, 'n')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'lista';
}

// ☁️ Save to cloud: open GitHub's new-file page pre-filled with this list —
// the parent just taps Commit. No token, no credentials in the app.
function cloudSaveActiveList() {
  const list = activeList();
  if (!list) return;
  if (list.id.startsWith('cloud-')) { alert('This list is already in the cloud.'); return; }
  const id = new Date().toISOString().slice(0, 10) + '-' + slugify(list.name);
  const body = JSON.stringify({ id, name: list.name, words: list.words }, null, 2) + '\n';
  const url = 'https://github.com/' + REPO + '/new/main'
    + '?filename=' + encodeURIComponent('lists/' + id + '.json')
    + '&value=' + encodeURIComponent(body);
  window.open(url, '_blank');
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
        entries.push({ id, name: j.name, words: j.words, sha: f.sha });
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
      const existing = data.lists.find(l => l.id === id);
      if (existing) {   // the repo is the source of truth for cloud lists
        if (existing.name !== name || JSON.stringify(existing.words) !== JSON.stringify(words)) {
          existing.name = name;
          existing.words = words;
          if (data.paused && data.paused.listId === id) data.paused = null;
          changed = true;
        }
        if (cl.sha && existing.cloudSha !== cl.sha) { existing.cloudSha = cl.sha; changed = true; }
      } else {
        data.lists.unshift({ id, name, words, createdAt: Date.now(), cloudSha: cl.sha });
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

/* ---------- sentences (word-mention frames: always grammatical) ---------- */
const SENTENCE_FRAMES = [
  'La palabra de hoy es: {w}.',
  'Mi palabra favorita es: {w}.',
  'Escucha bien: {w}.',
  '¿Puedes escribir la palabra {w}?',
  'En la escuela aprendimos la palabra {w}.',
];
const speakSentence = word => speak(pick(SENTENCE_FRAMES).replace('{w}', word), 0.95);

/* ---------- practice ---------- */
const PRAISE = ['¡Muy bien!', '¡Excelente!', '¡Perfecto!', '¡Genial!', '¡Fantástico!', '¡Súper!', '¡Increíble!'];
let session = null;

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
  // The in-progress word goes back to the front (fresh tries on resume);
  // in copy mode it's already re-queued, so don't add it twice.
  const head = (session.mode !== 'copy' && session.current) ? [session.current] : [];
  data.paused = {
    listId: session.listId,
    queue: head.concat(session.queue),
    done: session.done,
    results: session.results,
    requeued: [...session.requeued],
    savedAt: Date.now(),
  };
  save();
}

function startPractice(fresh = false) {
  const list = activeList();
  if (!list || !list.words.length) return;
  const p = fresh ? null : pausedFor(list);
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
    };
  } else {
    data.paused = null;
    save();
    session = {
      listId: list.id,
      queue: shuffle(list.words),
      done: 0,
      current: null,
      tries: 0,           // wrong attempts on the current word
      mode: 'spell',      // 'spell' (hidden word) | 'copy' (word revealed, type it once)
      requeued: new Set(),
      results: {},        // word -> { misses, firstTry }
    };
  }
  show('practice');
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
  if (!session.queue.length) { finishSession(); return; }
  session.current = session.queue.shift();
  session.tries = 0;
  session.mode = 'spell';
  if (!session.results[session.current]) session.results[session.current] = { misses: 0, firstTry: null };
  updateProgress();
  $('prompt-msg').textContent = 'Listen… then spell it! 👂';
  const pic = emojiFor(session.current);
  $('word-pic').textContent = pic || '';
  $('word-pic').classList.toggle('hidden', !pic);
  saveSession();
  speak(session.current);
  $('answer').focus();
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
    chime(true);
    if (m === 'accents') flash(`¡Sí! Recuerda: ${word} ✨`, 'info');
    else flash(pick(PRAISE) + ' ' + pick(['⭐', '🌟', '🎈', '🦜', '💚']), 'good');
    completeWord();
  } else {
    session.tries++;
    res.misses++;
    if (res.firstTry === null) res.firstTry = false;
    chime(false);
    renderAttemptRow(raw, word);
    saveSession();
    const left = 1 + data.settings.retries - session.tries;
    if (left > 0) {
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
  if (list) list.lastResult = { perfect: perfect.length, total: words.length, at: Date.now() };
  data.paused = null;   // finished — nothing to resume
  save();

  $('done-title').textContent = tricky.length === 0 ? '¡Perfecto! 🌟' : '¡Lo lograste!';
  const stars = Math.max(1, Math.round(perfect.length / Math.max(1, words.length) * 5));
  $('done-stars').textContent = '⭐'.repeat(stars) + '☆'.repeat(5 - stars);
  $('done-summary').textContent = `${perfect.length} of ${words.length} words right on the first try`;

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
  speak(tricky.length === 0 ? '¡Perfecto! ¡Eres una estrella!' : '¡Muy bien! ¡Lo lograste!');
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
  $('btn-practice').addEventListener('click', () => startPractice(false));
  $('btn-startover').addEventListener('click', () => startPractice(true));
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
  $('btn-scan').addEventListener('click', () => {
    if (typeof Tesseract === 'undefined') {
      alert('The scanner needs its one-time download — open the app once with internet, then try again.');
      return;
    }
    $('scan-file').click();
  });
  $('scan-file').addEventListener('change', e => {
    const f = e.target.files && e.target.files[0];
    if (f) scanPhoto(f);
    e.target.value = '';
  });
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
