# Palabritas — project handoff

Offline Spanish spelling-practice PWA for Brian's 8-year-old daughter. Two iPhones in the
household (Brian + wife) install it from Safari via Add to Home Screen. No accounts, no
backend; word lists and scores live in each device's localStorage.

- **Live app:** https://gwallee.github.io/Palabritas/
- **Repo:** https://github.com/gwallee/Palabritas (public)
- **Stack:** vanilla HTML/CSS/JS, no build step, no dependencies beyond vendored Tesseract.

## Hard requirements (from Brian)

- Works fully offline after install (practice happens away from home).
- Latin American Spanish pronunciation (es-MX voice preferred; picker in settings).
- Words presented in random order; missed words re-queued into the same round.
- On a miss: 2 extra tries (configurable), letter-tile feedback showing which letters are
  right (green), accent-only wrong (yellow), or wrong (red) — without revealing the answer.
- Accent-lenient matching by default ("arbol" ≈ "árbol", correction shown; strict toggle in
  settings) but **ñ is always a distinct letter from n** — never lenient.
- Word entry by photo (in-app OCR) or typing.

## File map

- `index.html` — all views in one page: home, edit (list editor), practice, done, settings.
- `app.js` — everything: storage, parser, speech, practice loop, OCR, emoji hints, share,
  cloud sync, session resume. Read top-to-bottom; sections are comment-labeled.
- `style.css` — warm kid-friendly theme, big touch targets.
- `sw.js` — service worker. `CACHE = 'palabritas-vN'`: **bump N on every deploy that
  changes any cached file** (that's the only cache-busting mechanism). Precaches ~14 files
  including the OCR stack (~8.8 MB). `lists.json` is network-first; everything else is
  cache-first with background refresh (so code changes reach an installed phone on the
  *second* open — this lag is normal, remember it when testing too). Cross-origin
  `image.pollinations.ai` requests (AI word pictures) get their own cache-first runtime
  caching branch, checked before the same-origin-only guard.
- `lists.json` — the shared word-list feed (see below). Currently `[]`.
- `vendor/` — tesseract.js 5.1.1 (`tesseract.min.js`, `worker.min.js`),
  `core/` = only the two **lstm** wasm.js builds (simd + non-simd; oem is pinned to 1 —
  if you ever change oem, you must vendor more core files), `lang/spa.traineddata.gz` =
  tessdata_fast 4.0.0 Spanish.
- `dev-server.mjs` + `.claude/launch.json` (server name `palabritas`) — local static server
  for testing in the Claude Code browser pane.
- `manifest.webmanifest`, icons — PWA install metadata.

## Data model (localStorage key `palabritas`)

```
{ lists: [{ id, name, words[], createdAt, lastResult?, extras? }],
  activeListId,
  paused: null | { listId, queue[], done, results, requeued[], pointsEarned, savedAt },
  settings: { voiceURI, rate, strict, retries },
  progress: { totalPoints, streak, lastPracticeDate } }
```

- List ids: `l<timestamp>` for device-created, `cloud-<id>` for lists from `lists.json`.
- `paused` = auto-saved unfinished practice session (saved after every answer). Resumable
  on the same device for 24 h; home button becomes "Resume — N to go" with a Start-over
  text button. Editing/deleting/cloud-updating a list clears its pause. Finishing clears it.
- iOS gotcha (Brian hit this): Safari and the installed home-screen app have **separate**
  localStorage. All real usage should happen in the installed app.
- `progress` is **per-device, not synced** (Brian's explicit choice — no accounts, no
  backend, so the two phones track separate totals/streaks rather than sharing one).

## Word entry

- **📷 Scan a photo** button → hidden `<input type=file accept=image/*>` → downscale to
  ≤1700 px on canvas (EXIF-safe via `<img>.decode()`) → Tesseract (`spa`, oem 1,
  `workerBlobURL:false`, absolute worker/core/lang URLs) → text through `parseWords`.
- `parseWords` rules: split on newlines/commas/etc, strip leading list numbering, require
  ≥2 letters, reject anything with a digit (OCR noise), cap 40 chars, skip lines starting
  with 📚, dedupe accent-insensitively (ñ preserved). Chips UI lets the parent prune strays.
- iOS keyboard "Scan Text" still works as a bonus path but is NOT relied on (it proved
  too hidden/unavailable — that's why OCR is embedded).

## Word pictures (AI illustrations)

- **🎨 Generate pictures for these words** button in the list editor — self-serve, one
  device, no Claude round-trip. For each word without one already, it asks
  [Pollinations.ai](https://image.pollinations.ai) (free, no key/account) for a
  512×512 flat-illustration image and stages the **URL** (not a downloaded file) on
  `editingExtras`, keyed by `canon(word)` same as cloud `extras`. Sequential with a
  ~2.5s gap between words — the free tier allows only 1 request at a time.
- Generated pictures render live in a small grid below the button; tap ✕ on any one to
  discard it and fall back to the emoji hint instead (there's no client-side way to
  auto-judge image quality, so this is the review step — mirrors how OCR chips can be
  pruned).
- On **Save list**, staged images merge into `list.extras` (preserving any existing
  `emoji`/`sentence` from cloud enrichment — see below). On **☁️ Save to cloud**,
  `extras` (images included) rides along in the same prefilled-GitHub-commit JSON, so
  no separate sync step was needed for this.
- Practice screen (`renderWordPic` in app.js) prefers `extra.image` over
  `extra.emoji`/`WORD_EMOJI` when present, with an `<img onerror>` fallback to emoji if
  the image fails to load.
- **This is a live external dependency**, unlike everything else in this app (which is
  deliberately self-hosted/vendored — see the Tesseract setup). Offline reliability
  after the first load depends on the service worker's runtime cache for
  `image.pollinations.ai` (sw.js) — an image never seen before while online just isn't
  cached, and falls back to emoji when offline. This tradeoff was discussed with Brian
  and accepted (see State / history) because downloading+committing actual image files
  isn't possible from an in-app button — GitHub's prefilled-commit trick only takes one
  text file, and base64-embedding images would blow past its URL-length limit.

## Sharing lists between phones

1. **📤 Share list** (home) → share sheet with plain text: `📚 <name>` header line + one
   word per line + app URL. On the receiving phone: New word list → paste into the words
   box → `absorbSharedName()` lifts the 📚 header into the name field automatically.
2. **Cloud lists in the repo** (all read from **main**, so a github.com commit reaches
   phones with NO redeploy). Two stores, both honored by sync:
   - `lists/<id>.json` — one file per list, `{ "id", "name", "words": [...] }`. Created by
     the **☁️ Save to cloud** button (home screen, device-created lists only): it opens
     GitHub's new-file page pre-filled via `/new/main?filename=lists/<id>.json&value=…` —
     Brian (signed into github.com in Safari) just taps Commit. No token, no credentials
     in the app. Includes `extras` (per-word emoji/sentence/image) when present. Ids are
     `YYYY-MM-DD-<name-slug>` so the directory sorts chronologically.
     Sync lists the folder via the GitHub contents API (unauthenticated, 60 req/h/IP) and
     uses each file's blob `sha` (stored as `cloudSha` on the list) to skip unchanged
     files. When a synced cloud list matches a local list by name+words, the local one is
     dropped (it was just promoted) so it doesn't appear twice.
   - `lists.json` — legacy single feed, newest first, fetched from raw main with the
     deployed copy as fallback. Still fine for hand edits / Claude-committed lists.
   - **Per-word enrichment** (either store): optional `"extras"` object keyed by the
     lowercase word: `{ "camuflaje": { "emoji": "🦎", "sentence": "Con su camuflaje, el
     camaleón se esconde…", "image": "https://image.pollinations.ai/prompt/…" } }`. The
     practice screen prefers `image` over `emoji`/WORD_EMOJI, and 💬 speaks the extra
     sentence (a real usage sentence that TEACHES the meaning — Brian explicitly
     rejected filler frames like "mi palabra favorita es X") instead of a generic frame.
     Two ways extras get added: (a) the device-side **🎨 Generate pictures** button (see
     Word pictures, above) for images, self-serve, no Claude involved; (b) Brian asking
     Claude to "enrich this week's list" for emoji + sentences → Claude writes kid-level
     Latin American Spanish sentences + picks emoji per word and commits the updated
     lists/ file. Enrichment arriving later does NOT clear a paused session.
   New ids are imported as `cloud-<id>` and the newest new one becomes the active list.
   The repo is the source of truth for cloud lists: repo edits overwrite them on sync.
   A malformed JSON file fails silently (sync skips it) — if a list doesn't appear on
   phones, validate the JSON first.

## Practice loop specifics

- Random order via shuffle; missed word re-queued 2+ positions later (once per word).
- 3 strikes (1 + `retries`=2) → word is revealed, she copies it once ("copy" mode), and it
  re-queues; it counts as missed for the end screen ("tricky words" get a ⭐ redo option).
- **Points**: 10/8/5 for correct on the 1st/2nd/3rd(+) try (`POINTS_BY_TRY` in app.js);
  0 for a word that gets revealed, even if she later gets the hidden re-test right — a
  word only ever scores once, gated by `res.scored`/`res.revealed` on its result record
  (NOT by `res.firstTry`, which is set to `false` on the very first wrong answer and so
  can't double as a "not yet scored" flag — this tripped up the first implementation).
  Shown on the done screen (`⭐ +N points · total`) and as a running total pill on home.
- **Streaks**: a calendar day counts once she finishes a full round that day
  (`updateStreak()`); a gap of more than one day resets it to 1. Shown on home once
  `streak > 0`, and added to the done-screen line once `streak > 1`.
- Emoji picture hint (`WORD_EMOJI`, ~250 entries + plural/article stripping) shows above
  the speaker when the word is known — disambiguation without spelling giveaway.
- 💬 button speaks the word in a random word-mention frame sentence (always grammatical).
- 🔊 repeat and 🐢 slow (rate×0.6) buttons; es voice picked by: saved voiceURI → es-MX →
  es-US → es-419 → any es. iOS tip for the parents: download "Paulina (Enhanced)" under
  Settings → Accessibility → Spoken Content → Voices → Spanish.

## Deploying

GitHub Pages serves the **gh-pages** branch (auto-enabled by pushing it; there is no local
gh-pages branch — push main onto it):

```
git add -A && git commit -m "..."          # identity: gwallee / gwallee@users.noreply.github.com
git push origin main && git push origin main:gh-pages
```

- In Claude Code shells, set `$env:GCM_INTERACTIVE = 'auto'` first or the credential
  helper refuses to prompt (session default is `never`).
- Remember the SW `CACHE` bump for any change to cached files.
- Deploys go live in ~30-60 s; verify with
  `https://gwallee.github.io/Palabritas/sw.js` containing the new cache name.
- Phones pick updates up automatically: first online open downloads, second open runs it.

## Testing

- `node --check app.js` for syntax.
- Browser-pane server: `preview_start {name: "palabritas"}` → localhost. When testing SW
  changes, load the page **twice** (cache-first lag) and clear old registrations if state
  looks stale. Speech quality itself can only be judged on the actual iPhones.

## State / history

- v1.0.0: core app. v1.1.0: embedded OCR, emoji hints, sentences, share + lists.json sync.
  v1.2.0: practice-session resume. v1.3.0: lists.json fetched from raw main, SW precache
  uses no-cache requests. v1.4.0: ☁️ Save to cloud (token-free, prefilled GitHub commit
  page) + per-file `lists/` store with sha-based sync. v1.5.0: per-word extras (emoji +
  teaching sentence) on cloud lists; Claude enriches each week's list on request.
  v1.6.0 (current): points (10/8/5 by try) + streaks, per-device only by explicit
  choice — no accounts/backend exist to sync them; self-serve 🎨 Generate pictures
  button (Pollinations.ai AI illustrations, staged as URLs, no Claude round-trip).
- `lists.json` is committed empty (`[]`) — no AI/test lists were ever deployed; a "Cloud
  Test List" existed only inside a local test browser during development.
- **Removed by Brian's request (2026-08-24, "that was an accident"):** an uncommitted
  theme-bank + Anthropic-API list-generator feature ("✨ Make words for me" / "🤖 Ask AI",
  settings key field) that a session had added. Do NOT re-add unless Brian explicitly asks.
- Native iOS app was discussed and explicitly ruled out (2026-08-25): Brian has no Mac
  access ever, and free/sideloaded distribution (Xcode direct install, AltStore/SideStore)
  all require at least one interactive Xcode session on macOS to sign a personal-team
  build — not automatable in CI. The PWA (Add to Home Screen) remains the app.
- Cross-phone point/streak sync was explicitly deferred (2026-08-25): options discussed
  were a free cloud DB (e.g. Firebase), an auto-committing GitHub token on-device, or a
  manual sync button; Brian chose to keep it simple and per-device for now. Revisit if
  he asks for shared totals later — the options above are the real candidates.
- No known open bugs. Ideas floated but not requested: multiple kid profiles,
  update-available toast, pre-generated premium TTS audio, cross-phone point sync.
