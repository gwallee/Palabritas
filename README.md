# Palabritas 🦜

A tiny offline-capable web app for practicing weekly Spanish spelling words.
Built for an 8-year-old: hear the word in a Latin American Spanish voice, type it,
get letter-by-letter feedback, and celebrate with confetti.

Everything is stored **on the device** (localStorage) — no accounts, no servers, no data collection.

## How it works

- **Add the week's words:** tap *New word list* → **📷 Scan a photo of the list** (embedded
  Tesseract OCR, Spanish-trained, runs on-device and offline). Review the parsed word chips,
  remove any strays, save. Typing/pasting works too, and iOS's own keyboard "Scan Text" is a
  bonus path where available.
- **Two phones, one list:** on the home screen tap **📤 Share list** and text it to the other
  phone — there, *New word list* → paste. Or add lists to `lists.json` in this repo
  (`[{ "id": "2026-08-31", "name": "Week of Aug 31", "words": ["gato", "..."] }]`, newest first):
  every phone pulls new entries automatically when online, and the newest becomes active.
  Repo lists are overwritten by the repo on sync — edit them in the repo, not on the phone.
- **Storage note (iOS):** Safari and the installed home-screen app have *separate* storage.
  Lists live in whichever one you created them in — use the home-screen app for everything.
- **Practice:** words come in random order. The app speaks each word (repeat 🔊 / slow 🐢).
  She types it — wrong answers show which letters were right (green), which have an accent
  problem (yellow), and which are wrong (red), without revealing the answer. After the
  first miss she gets 2 more tries (configurable), then the word is revealed, she copies it
  once, and it sneaks back into the queue for a hidden re-test.
- **Accents:** by default "arbol" is accepted for "árbol" but the correct spelling is shown;
  a settings toggle makes accents required. The letter **ñ always has to be right** — it's
  its own letter, not an accent.
- **Learn, Practice, Test:** Learn introduces every word with its picture, pronunciation,
  and a conservative Spanish syllable split. Practice keeps the friendly hints and extra
  tries; Test gives one audio-first attempt with hints hidden. Missed words stay in a
  per-device Trouble Words set until they are spelled cleanly twice.
- **Mastery:** each word earns up to three stars through consecutive first-try spellings.
  Progress, trouble words, points, and streaks remain private to that device.

## iPhone setup (one time)

1. Open the app's URL in Safari.
2. Share button → **Add to Home Screen**. From then on it works with no internet.
3. For the nicest voice: Settings → Accessibility → Spoken Content → Voices → Spanish →
   download **Paulina (Enhanced)** (es-MX), then pick it in the app's settings.

## Local development

```
node dev-server.mjs
```

Then open http://localhost:8317. `dev-server.mjs` and `.claude/` are dev-only;
the deployable app is the static files: `index.html`, `style.css`, `app.js`, `sw.js`,
`manifest.webmanifest`, and the PNG icons.

## Deploying

Any static host works (GitHub Pages, Netlify, Cloudflare Pages). All paths are relative,
so it can live in a subdirectory. After deploying a change, bump the `CACHE` version in
`sw.js` so installed phones pick it up.
