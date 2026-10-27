import { createGrayScott, mapParams } from "/assets/grayscott.js";
import { readPalette, onPaletteChange, css } from "/assets/palette.js";

const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
const fmt = (x) => x.toLocaleString("en-US");
const $ = (id) => document.getElementById(id);

// Feed and kill rates for a few well-known Gray–Scott regimes (diffusion ratio 2:1).
const PRESETS = [
  { name: "Mitosis", F: 0.0367, k: 0.0649 },
  { name: "Maze", F: 0.029, k: 0.057 },
  { name: "Coral", F: 0.0545, k: 0.062 },
  { name: "Worms", F: 0.058, k: 0.065 },
  { name: "Waves", F: 0.018, k: 0.051 },
];

// Figure 2's window on parameter space: F from f0 (bottom) to f1 (top), k from k0 (left) to k1 (right).
const MAP = { f0: 0, f1: 0.08, k0: 0.04, k1: 0.07 };

const paramListeners = [];

function pointerPos(canvas, e) {
  const r = canvas.getBoundingClientRect();
  return [
    Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)),
    Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)),
  ];
}

/* ---------------- Figure 1: the live dish ---------------- */

const dish = (() => {
  const sim = createGrayScott($("rd"), { n: 256, cpuN: 128 });
  const canvas = sim.canvas;
  const gpu = sim.kind === "webgl";
  const STEPS = gpu ? 16 : 8;            // simulation steps per animation frame
  const PRERUN = gpu ? 3000 : 1200;      // steps computed at once when motion is reduced
  const feed = $("feed"), kill = $("kill");
  let running = false, visible = false, started = false, painting = false, preset = PRESETS[0];

  // Preset buttons.
  const box = $("presets");
  for (const p of PRESETS) {
    const b = document.createElement("button");
    b.textContent = p.name;
    b.setAttribute("aria-pressed", "false");
    b.addEventListener("click", () => { setParams(p.F, p.k); reset(); });
    p.button = b;
    box.appendChild(b);
  }

  function setParams(F, k) {
    sim.F = F; sim.k = k;
    feed.value = F; kill.value = k;
    preset = PRESETS.find((p) => Math.abs(p.F - F) < 5e-5 && Math.abs(p.k - k) < 5e-5) || null;
    for (const p of PRESETS) p.button.setAttribute("aria-pressed", String(p === preset));
    for (const fn of paramListeners) fn(F, k);
    stats();
  }

  function stats() {
    $("s-feed").textContent = sim.F.toFixed(4);
    $("s-kill").textContent = sim.k.toFixed(4);
    $("s-name").textContent = preset ? preset.name.toLowerCase() : "custom";
    $("s-steps").textContent = fmt(sim.steps);
    $("s-engine").textContent = gpu ? "GPU " + sim.n + "²" : "CPU " + sim.n + "²";
  }

  function settle() {
    if (!running) { sim.step(PRERUN); }
    sim.draw(); stats();
  }

  function reset() {
    sim.seed({ count: 10, size: 0.05 });
    if (reduceMotion && !running) settle();
    else { sim.draw(); stats(); }
    if (!reduceMotion) { started = true; setRun(true); }
  }

  function setRun(on) {
    running = on;
    $("rd-run").textContent = on ? "Pause" : "Run";
    $("rd-run").classList.toggle("primary", !on);
  }

  $("rd-run").addEventListener("click", () => { started = true; setRun(!running); });
  $("rd-reset").addEventListener("click", reset);
  $("rd-clear").addEventListener("click", () => { sim.seed("clear"); sim.draw(); stats(); });
  feed.addEventListener("input", () => setParams(+feed.value, sim.k));
  kill.addEventListener("input", () => setParams(sim.F, +kill.value));

  // Painting: while the pointer is down, the brush keeps topping up V under it.
  function paint(e) {
    sim.brush(...pointerPos(canvas, e), 0.025);
    if (!running) { sim.step(1); sim.draw(); }
  }
  canvas.addEventListener("pointerdown", (e) => {
    canvas.setPointerCapture(e.pointerId);
    painting = true;
    paint(e);
  });
  canvas.addEventListener("pointermove", (e) => { if (painting) paint(e); });
  const release = () => { painting = false; sim.brush(null); };
  canvas.addEventListener("pointerup", release);
  canvas.addEventListener("pointercancel", release);

  sim.onrestore = () => { reset(); };
  onPaletteChange(() => requestAnimationFrame(() => sim.draw()));

  let frameNo = 0;
  function frame() {
    if (visible && running && !sim.lost) {
      sim.step(STEPS);
      sim.draw();
      if (++frameNo % 10 === 0) stats();
    }
    requestAnimationFrame(frame);
  }

  new IntersectionObserver(([e]) => {
    visible = e.isIntersecting;
    if (visible && !started && !reduceMotion) { started = true; setRun(true); }
  }).observe(canvas);

  setRun(false);
  setParams(preset.F, preset.k);
  sim.seed({ count: 10, size: 0.05 });
  if (reduceMotion) settle(); else { sim.draw(); stats(); }
  frame();

  return {
    load(F, k) {
      setParams(+F.toFixed(4), +k.toFixed(4));
      reset();
    },
  };
})();

/* ---------------- Figure 2: a map of parameter space ---------------- */

{
  const sim = createGrayScott($("map"), { n: 320, cpuN: 144, map: MAP, diff: 0.5 });
  const canvas = sim.canvas;
  const gpu = sim.kind === "webgl";
  const CAP = 10000;                                  // stop here; the map has mostly settled
  const STEPS = reduceMotion ? (gpu ? 200 : 20) : (gpu ? 24 : 6);
  const mark = $("map-mark"), dots = $("map-dots"), status = $("m-status");
  let visible = false, done = false;

  const place = (el, F, k) => {
    const x = (k - MAP.k0) / (MAP.k1 - MAP.k0), y = (MAP.f1 - F) / (MAP.f1 - MAP.f0);
    el.hidden = x < 0 || x > 1 || y < 0 || y > 1;
    el.style.left = x * 100 + "%";
    el.style.top = y * 100 + "%";
  };

  for (const p of PRESETS) {
    const d = document.createElement("span");
    d.className = "map-dot";
    d.title = p.name;
    d.textContent = p.name[0];
    place(d, p.F, p.k);
    dots.appendChild(d);
  }
  paramListeners.push((F, k) => place(mark, F, k));
  place(mark, PRESETS[0].F, PRESETS[0].k);

  const read = (e) => mapParams(MAP, ...pointerPos(canvas, e));
  const show = ({ F, k }) => `F ${F.toFixed(4)} · k ${k.toFixed(4)}`;

  canvas.addEventListener("pointermove", (e) => { $("m-here").textContent = show(read(e)); });
  canvas.addEventListener("pointerleave", () => { $("m-here").textContent = "—"; });
  canvas.addEventListener("click", (e) => {
    const p = read(e);
    dish.load(p.F, p.k);
    $("m-loaded").textContent = show(p);
  });

  function regrow() {
    sim.seed({ count: 420, size: 0.014 });
    done = false;
    sim.draw();
  }
  $("map-regrow").addEventListener("click", regrow);
  sim.onrestore = regrow;
  onPaletteChange(() => requestAnimationFrame(() => sim.draw()));

  function frame() {
    if (visible && !done && !sim.lost) {
      sim.step(Math.min(STEPS, CAP - sim.steps));
      done = sim.steps >= CAP;
      // With reduced motion, show only the finished map rather than the growth.
      if (!reduceMotion || done) sim.draw();
      status.textContent = done ? "settled" : (reduceMotion ? "computing " : "growing ") +
        Math.round((100 * sim.steps) / CAP) + "%";
    }
    requestAnimationFrame(frame);
  }

  new IntersectionObserver(([e]) => { visible = e.isIntersecting; }).observe(canvas);
  regrow();
  frame();
}

/* ---------------- Figure 3: one dimension, two speeds ---------------- */

{
  // A minimal activator–inhibitor pair (after Gierer & Meinhardt):
  //   a' = a²/h − a + Da·∇²a        the activator makes itself, and the inhibitor
  //   h' = μ(a² − h) + Dh·∇²h       the activator makes the inhibitor
  // The flat state a = h = 1 is stable on its own. It only breaks when Dh is about
  // 12 times Da or more (for μ = 2).
  const N = 160, MU = 2, DA = 1, PER_FRAME = 0.12;
  const canvas = $("line");
  const slider = $("ratio");
  let a = new Float64Array(N), h = new Float64Array(N);
  let a2 = new Float64Array(N), h2 = new Float64Array(N);
  let running = false, visible = false, started = false;
  let pal = readPalette();

  const ratio = () => +slider.value;

  function stir() {
    for (let i = 0; i < N; i++) { a[i] = 1 + 0.05 * (Math.random() - 0.5); h[i] = 1; }
  }

  function advance(T) {
    const Dh = ratio() * DA, dt = Math.min(0.2, 0.4 / Dh), steps = Math.ceil(T / dt);
    // A whisper of noise, as in any real system, so an unstable flat state can't hide.
    for (let i = 0; i < N; i++) a[i] += 1e-4 * (Math.random() - 0.5);
    for (let s = 0; s < steps; s++) {
      for (let i = 0; i < N; i++) {
        const l = i ? i - 1 : 0, r = i < N - 1 ? i + 1 : N - 1; // sealed ends
        const p = a[i] * a[i];
        a2[i] = a[i] + dt * (DA * (a[l] + a[r] - 2 * a[i]) + p / Math.max(h[i], 1e-3) - a[i]);
        h2[i] = h[i] + dt * (Dh * (h[l] + h[r] - 2 * h[i]) + MU * (p - h[i]));
      }
      [a, a2] = [a2, a]; [h, h2] = [h2, h];
    }
  }

  function peaks() {
    let n = 0;
    for (let i = 1; i < N - 1; i++) if (a[i] > 1.3 && a[i] > a[i - 1] && a[i] >= a[i + 1]) n++;
    return n;
  }

  function draw() {
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth, ht = canvas.clientHeight;
    if (canvas.width !== Math.round(w * dpr)) { canvas.width = Math.round(w * dpr); canvas.height = Math.round(ht * dpr); }
    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, ht);

    const L = 8, R = 8, T = 26, B = 10, YMAX = 3;
    const pw = w - L - R, ph = ht - T - B;
    const X = (i) => L + (i / (N - 1)) * pw;
    const Y = (v) => T + (1 - Math.min(v, YMAX) / YMAX) * ph;

    ctx.strokeStyle = css(pal.rule); ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(L, Y(1)); ctx.lineTo(L + pw, Y(1)); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(L, Y(0)); ctx.lineTo(L + pw, Y(0)); ctx.stroke();

    const line = (arr, color, width, dash) => {
      ctx.strokeStyle = color; ctx.lineWidth = width; ctx.setLineDash(dash);
      ctx.beginPath();
      for (let i = 0; i < N; i++) (i ? ctx.lineTo(X(i), Y(arr[i])) : ctx.moveTo(X(i), Y(arr[i])));
      ctx.stroke();
      ctx.setLineDash([]);
    };
    line(h, css(pal.muted), 1.5, [4, 3]);
    line(a, css(pal.accent), 2, []);

    ctx.font = "11px 'IBM Plex Mono', ui-monospace, monospace";
    ctx.textBaseline = "middle"; ctx.textAlign = "left";
    ctx.fillStyle = css(pal.accent); ctx.fillText("— activator", L, 10);
    ctx.fillStyle = css(pal.muted); ctx.fillText("- - inhibitor", L + 104, 10);
  }

  function stats() {
    const n = peaks();
    $("l-ratio").textContent = ratio() + "×";
    $("l-peaks").textContent = n ? fmt(n) : "none";
  }

  function settle() { advance(150); draw(); stats(); }

  function setRun(on) {
    running = on;
    $("line-run").textContent = on ? "Pause" : "Run";
    $("line-run").classList.toggle("primary", !on);
  }

  slider.addEventListener("input", () => { if (reduceMotion && !running) settle(); else stats(); });
  $("line-run").addEventListener("click", () => { started = true; setRun(!running); });
  $("line-stir").addEventListener("click", () => {
    stir();
    if (reduceMotion && !running) settle(); else { draw(); stats(); }
  });
  onPaletteChange(() => { pal = readPalette(); draw(); });
  window.addEventListener("resize", draw);

  let frameNo = 0;
  function frame() {
    if (visible && running) {
      advance(PER_FRAME);
      draw();
      if (++frameNo % 6 === 0) stats();
    }
    requestAnimationFrame(frame);
  }

  new IntersectionObserver(([e]) => {
    visible = e.isIntersecting;
    if (visible && !started && !reduceMotion) { started = true; setRun(true); }
  }).observe(canvas);

  setRun(false);
  stir();
  if (reduceMotion) settle(); else { draw(); stats(); }
  frame();
}
