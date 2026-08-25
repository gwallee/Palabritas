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
  *second* open — this lag is normal, remember it when testing too).
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
{ lists: [{ id, name, words[], createdAt, lastResult? }],
  activeListId,
  paused: null | { listId, queue[], done, results, requeued[], savedAt },
  settings: { voiceURI, rate, strict, retries } }
```

- List ids: `l<timestamp>` for device-created, `cloud-<id>` for lists from `lists.json`.
- `paused` = auto-saved unfinished practice session (saved after every answer). Resumable
  on the same device for 24 h; home button becomes "Resume — N to go" with a Start-over
  text button. Editing/deleting/cloud-updating a list clears its pause. Finishing clears it.
- iOS gotcha (Brian hit this): Safari and the installed home-screen app have **separate**
  localStorage. All real usage should happen in the installed app.

## Word entry

- **📷 Scan a photo** button → hidden `<input type=file accept=image/*>` → downscale to
  ≤1700 px on canvas (EXIF-safe via `<img>.decode()`) → Tesseract (`spa`, oem 1,
  `workerBlobURL:false`, absolute worker/core/lang URLs) → text through `parseWords`.
- `parseWords` rules: split on newlines/commas/etc, strip leading list numbering, require
  ≥2 letters, reject anything with a digit (OCR noise), cap 40 chars, skip lines starting
  with 📚, dedupe accent-insensitively (ñ preserved). Chips UI lets the parent prune strays.
- iOS keyboard "Scan Text" still works as a bonus path but is NOT relied on (it proved
  too hidden/unavailable — that's why OCR is embedded).

## Sharing lists between phones

1. **📤 Share list** (home) → share sheet with plain text: `📚 <name>` header line + one
   word per line + app URL. On the receiving phone: New word list → paste into the words
   box → `absorbSharedName()` lifts the 📚 header into the name field automatically.
2. **`lists.json` in the repo** (the "universal" store):
   `[{ "id": "2026-08-31", "name": "Week of Aug 31", "words": ["gato", ...] }, ...]`
   newest first. The app fetches it from **raw.githubusercontent.com/…/main/lists.json**
   first (so a github.com web edit on main reaches phones with NO redeploy — this is the
   parent self-serve path), falling back to the copy deployed with the site. New ids are
   imported as `cloud-<id>` and the newest new one becomes the active list. The repo file
   is the source of truth for cloud lists: repo edits overwrite them on sync (local edits
   to cloud lists get reverted). Two workflows: Brian edits lists.json on github.com from
   any device (main branch, i.e. the default — commit and done), or tells Claude the
   week's words. A malformed JSON edit fails silently (sync just skips it) — if a list
   doesn't appear on phones, validate the JSON first.

## Practice loop specifics

- Random order via shuffle; missed word re-queued 2+ positions later (once per word).
- 3 strikes (1 + `retries`=2) → word is revealed, she copies it once ("copy" mode), and it
  re-queues; it counts as missed for the end screen ("tricky words" get a ⭐ redo option).
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
  v1.2.0: practice-session resume. v1.3.0 (current): lists.json fetched from raw main (see
  above), SW precache uses no-cache requests.
- `lists.json` is committed empty (`[]`) — no AI/test lists were ever deployed; a "Cloud
  Test List" existed only inside a local test browser during development.
- **Removed by Brian's request (2026-08-24, "that was an accident"):** an uncommitted
  theme-bank + Anthropic-API list-generator feature ("✨ Make words for me" / "🤖 Ask AI",
  settings key field) that a session had added. Do NOT re-add unless Brian explicitly asks.
- No known open bugs. Ideas floated but not requested: streaks, multiple kid profiles,
  update-available toast, pre-generated premium TTS audio.
