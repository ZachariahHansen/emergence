import { Sandpile, BigPile, makeRenderer, cellAt } from "/assets/sandpile.js";
import { readPalette, onPaletteChange, css } from "/assets/palette.js";
import { reduceMotion, animate, announce, valueText, keyCursor } from "/assets/a11y.js";
const fmt = (x) => x.toLocaleString("en-US");

/* ---------------- Figure 1: pour grains, watch avalanches ---------------- */

{
  const N = 64;
  const canvas = document.getElementById("pour");
  const pile = new Sandpile(N);
  const render = makeRenderer(canvas, pile);
  const $ = (id) => document.getElementById(id);

  const BINS = 18;
  const hist = new Float64Array(BINS);
  let dropped = 0, last = 0, biggest = 0, quiet = 0, avalanches = 0;
  let raining = false, pointerCell = -1, started = false;

  function record(size) {
    dropped++;
    last = size;
    if (size === 0) { quiet++; return; }
    avalanches++;
    if (size > biggest) biggest = size;
    hist[Math.min(BINS - 1, Math.floor(Math.log2(size)))]++;
  }

  function dropRandom(k) {
    for (let i = 0; i < k; i++) record(pile.drop((Math.random() * N * N) | 0));
  }

  function rate() {
    return Math.max(1, Math.round(Math.pow(10, $("rate").value / 50)));
  }

  function stats() {
    let total = 0;
    for (let i = 0; i < pile.h.length; i++) total += pile.h[i];
    $("s-dropped").textContent = fmt(dropped);
    $("s-density").textContent = (total / (N * N)).toFixed(3);
    $("s-last").textContent = fmt(last);
    $("s-biggest").textContent = fmt(biggest);
    $("s-rate").textContent = rate() + "/frame";
  }

  function setRain(on) {
    raining = on;
    $("rain").textContent = on ? "Pause" : "Rain";
    $("rain").classList.toggle("primary", !on);
  }

  $("rain").addEventListener("click", () => setRain(!raining));
  // Skip ahead without the flash: thousands of avalanches would light the whole table.
  $("ff").addEventListener("click", () => { dropRandom(20000); pile.glow.fill(0); drawHist(); stats(); });
  $("reset").addEventListener("click", () => {
    pile.clear(); hist.fill(0);
    dropped = last = biggest = quiet = avalanches = 0;
    drawHist(); stats(); render();
  });
  $("rate").addEventListener("input", stats);
  valueText($("rate"), () => rate() + " grains per frame");

  canvas.addEventListener("pointerdown", (e) => {
    canvas.setPointerCapture(e.pointerId);
    pointerCell = cellAt(canvas, N, e);
    if (pointerCell >= 0) record(pile.drop(pointerCell));
  });
  canvas.addEventListener("pointermove", (e) => {
    if (pointerCell !== -1) pointerCell = cellAt(canvas, N, e);
  });
  const release = () => { pointerCell = -1; };
  canvas.addEventListener("pointerup", release);
  canvas.addEventListener("pointercancel", release);

  // Keyboard: arrows move a cursor, holding Enter or Space pours there like holding the pointer.
  let pourStart = 0, pourBig = 0;
  const kcell = (x, y) => Math.floor(y * N) * N + Math.floor(x * N);
  keyCursor(canvas, {
    step: 1 / N * 2,
    onPress(x, y) {
      pointerCell = kcell(x, y);
      pourStart = dropped; pourBig = biggest;
      record(pile.drop(pointerCell));
    },
    onMove(x, y, held) { if (held) pointerCell = kcell(x, y); },
    onRelease(x, y) {
      pointerCell = -1;
      const n = dropped - pourStart;
      announce(`Poured ${fmt(n)} grain${n === 1 ? "" : "s"} at column ${Math.floor(x * N) + 1}, row ${Math.floor(y * N) + 1}.` +
        (biggest > pourBig ? ` New biggest avalanche: ${fmt(biggest)} topplings.` : ""));
      stats();
    },
  });

  // Log–log histogram of avalanche sizes, normalised by bin width.
  const chart = document.getElementById("hist");
  let pal = readPalette();
  onPaletteChange(() => { pal = readPalette(); drawHist(); });

  function drawHist() {
    const dpr = window.devicePixelRatio || 1;
    const w = chart.clientWidth, h = chart.clientHeight;
    if (chart.width !== w * dpr) { chart.width = w * dpr; chart.height = h * dpr; }
    const ctx = chart.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const L = 44, R = 12, T = 12, B = 34;
    const pw = w - L - R, ph = h - T - B;
    const xMax = 4.5; // log10 of size
    const pts = [];
    let yMax = -Infinity, yMin = Infinity;
    for (let k = 0; k < BINS; k++) {
      if (!hist[k]) continue;
      const width = Math.pow(2, k); // bin covers [2^k, 2^(k+1))
      const y = Math.log10(hist[k] / width);
      const x = Math.log10(Math.pow(2, k) * 1.5);
      pts.push([x, y]);
      yMax = Math.max(yMax, y); yMin = Math.min(yMin, y);
    }
    yMax = Math.ceil(isFinite(yMax) ? yMax : 3);
    yMin = Math.floor(isFinite(yMin) ? Math.min(yMin, yMax - 3) : 0);
    const X = (x) => L + (x / xMax) * pw;
    const Y = (y) => T + (1 - (y - yMin) / (yMax - yMin)) * ph;

    ctx.font = "11px 'IBM Plex Mono', ui-monospace, monospace";
    ctx.strokeStyle = css(pal.rule); ctx.fillStyle = css(pal.muted);
    ctx.lineWidth = 1;
    ctx.textAlign = "center"; ctx.textBaseline = "top";
    for (let d = 0; d <= 4; d++) {
      const x = X(d);
      ctx.beginPath(); ctx.moveTo(x, T); ctx.lineTo(x, T + ph); ctx.stroke();
      ctx.fillText(fmt(Math.pow(10, d)), x, T + ph + 6);
    }
    ctx.textAlign = "right"; ctx.textBaseline = "middle";
    const yStep = yMax - yMin > 6 ? 2 : 1;
    for (let d = yMax; d >= yMin; d -= yStep) {
      const y = Y(d);
      ctx.beginPath(); ctx.moveTo(L, y); ctx.lineTo(L + pw, y); ctx.stroke();
      ctx.fillText("10" + sup(d), L - 6, y);
    }
    ctx.textAlign = "center"; ctx.textBaseline = "bottom";
    ctx.fillText("avalanche size (topplings)", L + pw / 2, h - 1);

    if (!pts.length) {
      ctx.textBaseline = "middle";
      ctx.fillText("no avalanches yet", L + pw / 2, T + ph / 2);
      return;
    }
    ctx.strokeStyle = css(pal.accent); ctx.lineWidth = 1.5;
    ctx.beginPath();
    pts.forEach(([x, y], i) => (i ? ctx.lineTo(X(x), Y(y)) : ctx.moveTo(X(x), Y(y))));
    ctx.stroke();
    ctx.fillStyle = css(pal.accent);
    for (const [x, y] of pts) { ctx.beginPath(); ctx.arc(X(x), Y(y), 3, 0, Math.PI * 2); ctx.fill(); }
  }

  function sup(n) {
    const m = { "-": "⁻", 0: "⁰", 1: "¹", 2: "²", 3: "³", 4: "⁴", 5: "⁵", 6: "⁶", 7: "⁷", 8: "⁸", 9: "⁹" };
    return String(n).split("").map((c) => m[c]).join("");
  }

  let frameNo = 0;
  animate(canvas, () => {
    if (raining) dropRandom(rate());
    if (pointerCell >= 0) for (let i = 0; i < 2; i++) record(pile.drop(pointerCell));
    render(0.9);
    if (++frameNo % 6 === 0) { stats(); drawHist(); }
  }, (shown) => {
    if (shown && !started) { started = true; if (dropped === 0 && !reduceMotion) setRain(true); }
  });

  window.addEventListener("resize", drawHist);
  setRain(false);
  // With reduced motion, open on a pile that has already reached its steady state.
  if (reduceMotion) { dropRandom(20000); pile.glow.fill(0); }
  stats(); drawHist(); render();
}

/* ---------------- Figure 2: one enormous pile in the middle ---------------- */

{
  const canvas = document.getElementById("big");
  const slider = document.getElementById("big-n");
  const label = document.getElementById("big-n-label");
  const status = document.getElementById("big-status");
  let pile = null, render = null, running = false;

  const grains = () => Math.pow(2, +slider.value);
  const showN = () => { label.textContent = fmt(grains()); };
  slider.addEventListener("input", showN);
  showN();
  valueText(slider, () => fmt(grains()) + " grains");

  function start() {
    pile = new BigPile(grains());
    // (With reduced motion the previous picture stays up until the new one has settled.)
    if (!reduceMotion) render = makeRenderer(canvas, pile);
    status.textContent = "toppling…";
    if (!running) { running = true; requestAnimationFrame(tick); }
  }

  function tick() {
    const done = pile.step(reduceMotion ? 200 : 14);
    // With reduced motion, compute without showing the collapse and draw only the result.
    if (!reduceMotion) render(0.8);
    status.textContent = (done ? "settled after " : "") + fmt(pile.topplings) + " topplings";
    if (done) {
      running = false; pile.glow.fill(0);
      if (reduceMotion) render = makeRenderer(canvas, pile);
      render();
      announce(`${fmt(pile.grains)} grains settled after ${fmt(pile.topplings)} topplings.`);
      return;
    }
    requestAnimationFrame(tick);
  }

  document.getElementById("big-run").addEventListener("click", start);
  // Show a small finished pile on load so the figure is never empty.
  pile = new BigPile(4096);
  while (!pile.step(50));
  pile.glow.fill(0);
  render = makeRenderer(canvas, pile);
  render();
  status.textContent = "4,096 grains, settled after " + fmt(pile.topplings) + " topplings";
}
