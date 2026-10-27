# Emergence — a field guide

Interactive essays about simple local rules that build large structure. Live at emergence.zansen.dev.

Plain static HTML, CSS and ES modules. No build step, no dependencies, no tracking.

## Layout

- `index.html`: landing page and chapter list (with an ambient sandpile hero)
- `assets/style.css`: all styles; colour tokens on `:root`, dark mode via `prefers-color-scheme`
- `assets/palette.js`: reads CSS colour tokens so canvases follow the theme
- `assets/sandpile.js`: sandpile model and renderer, shared by the hero and chapter 01
- `assets/boids.js` (02 flock), `assets/grayscott.js` (03 patterns, WebGL2 with CPU fallback),
  `assets/ant.js` (04 ant, DOM-free so it runs under node), `assets/physarum.js` (05 slime)
- `<chapter>/index.html` + `<chapter>/chapter.js`: one folder per chapter
- `vercel.json`: clean URLs (`/sandpile` serves `sandpile/index.html`)

## Adding a chapter

1. Make `<slug>/index.html` by copying `sandpile/index.html`: keep the header, footer, fonts and the
   `figure.sim > .sim-frame` / `.controls` / `.stats` / `figcaption` markup.
2. Put the simulation in `<slug>/chapter.js` (or a reusable model in `assets/`). Read colours with
   `readPalette()`; pause work when the canvas is off screen; respect `prefers-reduced-motion`.
3. In `index.html`, change that chapter's `<li class="soon">` into a link, and update the "Next" link in the
   previous chapter.

Writing style: plain, concrete and honest about caveats. Cite primary sources in the footer.

## Local preview

```
python3 -m http.server 4321
```

## Deploy

`npx vercel --prod` from this folder, or push to GitHub and import the repo in Vercel (framework: Other,
no build command, output directory `.`).
