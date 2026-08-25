# Palabritas 🦜

A tiny offline-capable web app for practicing weekly Spanish spelling words.
Built for an 8-year-old: hear the word in a Latin American Spanish voice, type it,
get letter-by-letter feedback, and celebrate with confetti.

Everything is stored **on the device** (localStorage) — no accounts, no servers, no data collection.

## How it works

- **Add the week's words:** tap *New word list*, tap the words box, and use the iPhone
  keyboard's **Scan Text** button to point the camera at the printed list (or just type).
  Review the parsed word chips, remove any strays, save.
- **Practice:** words come in random order. The app speaks each word (repeat 🔊 / slow 🐢).
  She types it — wrong answers show which letters were right (green), which have an accent
  problem (yellow), and which are wrong (red), without revealing the answer. After the
  first miss she gets 2 more tries (configurable), then the word is revealed, she copies it
  once, and it sneaks back into the queue for a hidden re-test.
- **Accents:** by default "arbol" is accepted for "árbol" but the correct spelling is shown;
  a settings toggle makes accents required. The letter **ñ always has to be right** — it's
  its own letter, not an accent.

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
