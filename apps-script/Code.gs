/* Palabritas cloud-save relay — Google Apps Script
 *
 * Lets ANY family phone publish a word list to the repo, without a GitHub
 * account on the phone. The app POSTs a list here; this script commits it to
 * lists/<id>.json on main using a GitHub token that lives ONLY in Script
 * Properties (never in the app's public source). The phones' existing sync
 * then distributes it — the repo stays the single source of truth.
 *
 * SETUP (once, ~10 minutes — same dance as MathFacts):
 * 1. github.com → Settings → Developer settings → Fine-grained tokens →
 *    Generate new token. Repository access: ONLY gwallee/Palabritas.
 *    Permissions: Contents → Read and write. Copy the token.
 * 2. script.google.com → New project → paste this file over Code.gs.
 * 3. Project Settings (gear) → Script Properties → add:
 *      GITHUB_TOKEN = <the token>          (required)
 *      PARENT_PIN   = <digits>             (optional — leave unset for none)
 * 4. Deploy → New deployment → Web app → Execute as: Me,
 *    Who has access: Anyone → Deploy. Copy the /exec URL.
 * 5. Put that URL in CLOUD_SYNC_URL near the top of app.js and redeploy the
 *    app (or tell Claude the URL and it will do it).
 * 6. Run testConnectivity() from the editor once — it should log the repo name.
 *
 * Remember (learned the hard way on MathFacts): pasting a fresh copy of this
 * file does NOT touch Script Properties, but a NEW script project starts with
 * none — re-enter the token after moving projects. And every code edit needs
 * Deploy → Manage deployments → New version, or phones keep hitting old code.
 */

const REPO = 'gwallee/Palabritas';
const BRANCH = 'main';
const API = 'https://api.github.com/repos/' + REPO + '/contents/';

const LIMITS = {
  nameLen: 60,
  words: 100,
  wordLen: 40,
  emojiLen: 16,
  sentenceLen: 300,
  imageLen: 600,
};

function doPost(e) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const payload = JSON.parse(e.postData.contents);
    return json_(saveList_(payload));
  } catch (err) {
    return json_({ ok: false, error: String(err && err.message || err) });
  } finally {
    lock.releaseLock();
  }
}

function doGet(e) {
  if (e && e.parameter && e.parameter.ping) {
    return json_({ ok: true, repo: REPO, tokenSet: !!token_() });
  }
  return json_({ ok: false, error: 'POST a list, or GET ?ping=1' });
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function saveList_(payload) {
  const pin = PropertiesService.getScriptProperties().getProperty('PARENT_PIN') || '';
  if (pin && String(payload.pin || '') !== pin) return { ok: false, error: 'Wrong PIN' };

  const list = validateList_(payload);   // throws with a clear message on bad input

  const token = token_();
  if (!token) return { ok: false, error: 'No GITHUB_TOKEN in Script Properties — see setup step 3' };

  const path = 'lists/' + list.id + '.json';
  const body = JSON.stringify(list, null, 2) + '\n';

  // Does the file exist already? Need its blob sha to update instead of create.
  const existing = ghFetch_('GET', path + '?ref=' + BRANCH, token, null);
  let sha = null;
  if (existing.code === 200) sha = JSON.parse(existing.text).sha;
  else if (existing.code !== 404) return { ok: false, error: 'GitHub read failed: HTTP ' + existing.code };

  const commit = {
    message: (sha ? 'Update' : 'Add') + ' word list "' + list.name + '" (from the app)',
    content: Utilities.base64Encode(body, Utilities.Charset.UTF_8),
    branch: BRANCH,
  };
  if (sha) commit.sha = sha;

  const put = ghFetch_('PUT', path, token, commit);
  if (put.code < 200 || put.code >= 300) {
    // Surface the real error — a swallowed failure cost hours on MathFacts.
    let detail = '';
    try { detail = JSON.parse(put.text).message || ''; } catch (ignored) {}
    return { ok: false, error: 'GitHub commit failed: HTTP ' + put.code + (detail ? ' — ' + detail : '') };
  }
  return { ok: true, id: list.id, updated: !!sha };
}

function validateList_(p) {
  if (!p || typeof p !== 'object') throw new Error('Not a list');

  const id = String(p.id || '');
  if (!/^\d{4}-\d{2}-\d{2}-[a-z0-9][a-z0-9-]{0,39}$/.test(id)) throw new Error('Bad list id');

  const name = String(p.name || '').trim().slice(0, LIMITS.nameLen);
  if (!name) throw new Error('The list needs a name');

  if (!Array.isArray(p.words) || !p.words.length) throw new Error('The list has no words');
  if (p.words.length > LIMITS.words) throw new Error('Too many words (max ' + LIMITS.words + ')');
  const words = p.words.map(function (w) {
    const s = String(w).trim();
    if (!s || s.length > LIMITS.wordLen) throw new Error('Bad word: "' + String(w).slice(0, 50) + '"');
    return s;
  });

  const out = { id: id, name: name, words: words };

  // Optional per-word extras (emoji / teaching sentence / image URL) ride along
  // unchanged so updating a list never strips its enrichment.
  if (p.extras && typeof p.extras === 'object' && !Array.isArray(p.extras)) {
    const extras = {};
    Object.keys(p.extras).slice(0, LIMITS.words).forEach(function (k) {
      const v = p.extras[k];
      if (!v || typeof v !== 'object') return;
      const clean = {};
      if (typeof v.emoji === 'string' && v.emoji.length <= LIMITS.emojiLen) clean.emoji = v.emoji;
      if (typeof v.sentence === 'string' && v.sentence.length <= LIMITS.sentenceLen) clean.sentence = v.sentence.trim();
      if (typeof v.image === 'string' && /^https:\/\//.test(v.image) && v.image.length <= LIMITS.imageLen) clean.image = v.image;
      if (Object.keys(clean).length) extras[String(k).slice(0, LIMITS.wordLen)] = clean;
    });
    if (Object.keys(extras).length) out.extras = extras;
  }

  return out;
}

function token_() {
  const t = PropertiesService.getScriptProperties().getProperty('GITHUB_TOKEN') || '';
  // Refuse obvious placeholders — MathFacts once pushed to a placeholder topic for days.
  if (!t || (t.length < 30 && /YOUR|TOKEN|HERE/i.test(t))) return '';
  return t;
}

function ghFetch_(method, pathAndQuery, token, jsonBody) {
  const resp = UrlFetchApp.fetch(API + pathAndQuery, {
    method: method.toLowerCase(),
    headers: {
      Authorization: 'Bearer ' + token,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
    payload: jsonBody ? JSON.stringify(jsonBody) : undefined,
    contentType: jsonBody ? 'application/json' : undefined,
    muteHttpExceptions: true,   // fine HERE: every caller checks .code explicitly
  });
  return { code: resp.getResponseCode(), text: resp.getContentText() };
}

/* ---------- run these by hand from the editor ---------- */

// Proves the token works before touching the phones. Check the log output.
function testConnectivity() {
  const token = token_();
  if (!token) { Logger.log('NO TOKEN — set GITHUB_TOKEN in Script Properties'); return; }
  const r = UrlFetchApp.fetch('https://api.github.com/repos/' + REPO, {
    headers: { Authorization: 'Bearer ' + token, Accept: 'application/vnd.github+json' },
    muteHttpExceptions: true,
  });
  Logger.log('HTTP ' + r.getResponseCode() + ' — ' + (r.getResponseCode() === 200
    ? 'token can see ' + JSON.parse(r.getContentText()).full_name
    : r.getContentText().slice(0, 300)));
}

// End-to-end dry run: commits (then you can delete) lists/1999-01-01-prueba.json.
function testCommit() {
  Logger.log(JSON.stringify(saveList_({
    id: '1999-01-01-prueba',
    name: 'Prueba',
    words: ['hola', 'adiós'],
  })));
}
