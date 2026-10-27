import { Physarum, makeTrailRenderer, gridAt, budget } from "/assets/physarum.js";
import { css } from "/assets/palette.js";
import { reduceMotion, animate, announce, valueText, keyCursor } from "/assets/a11y.js";

// <output> is an implicit live region; the sliders already expose their values, so keep it quiet.
for (const o of document.querySelectorAll(".sim output")) o.setAttribute("aria-live", "off");
const fmt = (x) => x.toLocaleString("en-US");
const $ = (id) => document.getElementById(id);

// Watch how long a step takes and shed agents until it fits the frame budget.
function makeGovernor(sim, { targetMs = 10, minAgents = 4000 } = {}) {
  let avg = 0, n = 0;
  return function timed(fn) {
    const t0 = performance.now();
    fn();
    const dt = performance.now() - t0;
    avg = n === 0 ? dt : avg * 0.9 + dt * 0.1;
    if (++n >= 30 && avg > targetMs && sim.count > minAgents) {
      sim.count = Math.max(minAgents, Math.round(sim.count * 0.75));
      n = 0;
    }
  };
}

// Run a few hundred steps without animating, for readers who prefer reduced motion.
function prewarm(sim, steps, extra, done) {
  function chunk() {
    const t0 = performance.now();
    while (sim.steps < steps && performance.now() - t0 < 30) { extra && extra(); sim.step(); }
    if (sim.steps < steps) setTimeout(chunk, 0); else done();
  }
  chunk();
}

/* ---------------- Figure 2: the live network ---------------- */

{
  const canvas = $("net");
  const [N, agents] = budget(1);
  const sim = new Physarum(N, N, agents);
  const render = makeTrailRenderer(canvas, sim);
  const timed = makeGovernor(sim);
  const p = sim.params;
  let running = false, started = false, pointer = null;

  const PRESETS = {
    // wobble is our addition (random heading jitter); "jones" is the paper's values without it.
    cells:  { sensorAngle: 22.5, sensorDist: 9,  turnAngle: 45, decay: 0.30, wobble: 25 },
    fine:   { sensorAngle: 45,   sensorDist: 4,  turnAngle: 45, decay: 0.30, wobble: 25 },
    coarse: { sensorAngle: 30,   sensorDist: 24, turnAngle: 30, decay: 0.10, wobble: 15 },
    jones:  { sensorAngle: 22.5, sensorDist: 9,  turnAngle: 45, decay: 0.10, wobble: 0 },
  };

  const sliders = {
    sensorAngle: ["sa", (v) => v + "°", (v) => +v, (v) => v + " degrees"],
    sensorDist:  ["sd", (v) => v + " px", (v) => +v, (v) => v + " pixels"],
    turnAngle:   ["ra", (v) => v + "°", (v) => +v, (v) => v + " degrees"],
    decay:       ["decay", (v) => v.toFixed(2), (v) => v / 100, null],
    wobble:      ["wob", (v) => v + "°", (v) => +v, (v) => v + " degrees"],
  };
  const spoken = {};
  for (const [k, [id, , , say]] of Object.entries(sliders)) if (say) spoken[k] = valueText($(id), say);

  function syncSliders() {
    for (const [k, [id, show]] of Object.entries(sliders)) {
      $(id).value = k === "decay" ? Math.round(p[k] * 100) : p[k];
      $(id + "-v").textContent = show(p[k]);
      if (spoken[k]) spoken[k]();
    }
  }
  for (const [k, [id, show, read]] of Object.entries(sliders)) {
    $(id).addEventListener("input", () => {
      p[k] = read($(id).value);
      $(id + "-v").textContent = show(p[k]);
      markPreset(null);
    });
  }

  function markPreset(name) {
    for (const b of document.querySelectorAll("#fig-net [data-preset]")) {
      b.setAttribute("aria-pressed", String(b.dataset.preset === name));
    }
  }
  for (const b of document.querySelectorAll("#fig-net [data-preset]")) {
    b.addEventListener("click", () => {
      Object.assign(p, PRESETS[b.dataset.preset]);
      syncSliders(); markPreset(b.dataset.preset);
      sim.seed();
      if (!running) render();
    });
  }

  function stats() {
    $("n-agents").textContent = fmt(sim.count);
    $("n-grid").textContent = N + " × " + N;
    $("n-steps").textContent = fmt(sim.steps);
  }

  function setRunning(on) {
    running = on;
    $("net-run").textContent = on ? "Pause" : "Run";
    $("net-run").classList.toggle("primary", !on);
  }
  $("net-run").addEventListener("click", () => setRunning(!running));
  $("net-reseed").addEventListener("click", () => { sim.seed(); render(); stats(); });

  canvas.addEventListener("pointerdown", (e) => {
    canvas.setPointerCapture(e.pointerId);
    pointer = gridAt(canvas, sim, e);
  });
  canvas.addEventListener("pointermove", (e) => { if (pointer) pointer = gridAt(canvas, sim, e); });
  const release = () => { pointer = null; };
  canvas.addEventListener("pointerup", release);
  canvas.addEventListener("pointercancel", release);
  // Keyboard: arrows move a cursor; hold Enter or Space to pour attractant there.
  keyCursor(canvas, {
    onPress(x, y) { pointer = [x * sim.w, y * sim.h]; },
    onMove(x, y, held) { if (held) pointer = [x * sim.w, y * sim.h]; },
    onRelease: release,
  });

  const feed = () => {
    if (pointer) sim.addDisc(pointer[0], pointer[1], Math.max(3, N / 50), Math.max(40, sim.mean * 6));
  };

  let frameNo = 0;
  animate(canvas, () => {
    if (running) {
      timed(() => { feed(); sim.step(); });
      render();
      if (++frameNo % 10 === 0) stats();
    } else if (pointer) {
      // Paused: still show where attractant is being laid.
      feed(); sim.diffuse(); render();
    }
  }, (shown) => {
    if (shown && !started && !reduceMotion) { started = true; setRunning(true); }
  });

  addEventListener("resize", () => { if (!running) render(); });
  Object.assign(p, PRESETS.cells);
  syncSliders(); markPreset("cells");
  setRunning(false);
  stats(); render();
  // A head start so the first thing a reader sees is a network forming, not static.
  prewarm(sim, reduceMotion ? 300 : 80, null, () => { render(); stats(); });
}

/* ---------------- Figure 3: food sources, linked ---------------- */

{
  const canvas = $("tokyo");
  const [N, agents] = budget(0.55);
  const sim = new Physarum(N, N, agents, { wrap: false });
  const timed = makeGovernor(sim, { targetMs: 8, minAgents: 3000 });
  Object.assign(sim.params, { sensorAngle: 22.5, sensorDist: 9, turnAngle: 45, decay: 0.2, wobble: 20 });

  // An illustrative scatter of "towns" around one big hub, with open water to the south-east.
  // Coordinates are fractions of the dish. This is not a map of anywhere.
  const LAYOUT = [
    [0.50, 0.55, true],
    [0.38, 0.47], [0.30, 0.36], [0.45, 0.30], [0.60, 0.38], [0.72, 0.27],
    [0.22, 0.55], [0.15, 0.30], [0.33, 0.18], [0.58, 0.15], [0.82, 0.42],
    [0.28, 0.72], [0.40, 0.84], [0.66, 0.62], [0.12, 0.80],
  ];
  let food = [];
  const resetFood = () => { food = LAYOUT.map(([x, y, hub]) => ({ x, y, hub: !!hub })); };
  resetFood();

  const strength = () => +$("food-k").value;

  const render = makeTrailRenderer(canvas, sim, {
    overlay(ctx, s, pal) {
      const unit = s * sim.w; // canvas pixels across the dish
      for (const f of food) {
        const r = Math.max(4, unit * (f.hub ? 0.022 : 0.014));
        ctx.beginPath();
        ctx.arc(f.x * unit, f.y * unit, r, 0, Math.PI * 2);
        ctx.fillStyle = css(pal.accent);
        ctx.fill();
        ctx.lineWidth = Math.max(1, unit / 300);
        ctx.strokeStyle = css(pal.bg);
        ctx.stroke();
      }
    },
  });

  let running = false, started = false;
  let drag = null; // { f, moved, x0, y0 }

  function stats() {
    $("t-food").textContent = food.length;
    $("t-agents").textContent = fmt(sim.count);
    $("t-steps").textContent = fmt(sim.steps);
  }

  function setRunning(on) {
    running = on;
    $("t-run").textContent = on ? "Pause" : "Run";
    $("t-run").classList.toggle("primary", !on);
  }
  $("t-run").addEventListener("click", () => setRunning(!running));
  $("t-restart").addEventListener("click", () => { sim.seed(); render(); stats(); });
  $("t-layout").addEventListener("click", () => { resetFood(); sim.seed(); render(); stats(); });
  $("t-clear").addEventListener("click", () => { food = []; render(); stats(); });
  $("food-k").addEventListener("input", () => { $("food-k-v").textContent = strength() + "×"; });
  valueText($("food-k"), (v) => v + " times the mean trail");
  $("food-k-v").textContent = strength() + "×";

  function frac(e) {
    const r = canvas.getBoundingClientRect();
    return [(e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height, r.width];
  }
  function hit(x, y, width) {
    const tol = Math.max(0.035, 18 / width); // at least ~18 CSS px for fingers
    let best = null, bd = tol * tol;
    for (const f of food) {
      const d = (f.x - x) ** 2 + (f.y - y) ** 2;
      if (d < bd) { bd = d; best = f; }
    }
    return best;
  }

  canvas.addEventListener("pointerdown", (e) => {
    canvas.setPointerCapture(e.pointerId);
    const [x, y, width] = frac(e);
    let f = hit(x, y, width), added = false;
    if (!f) { f = { x, y, hub: false }; food.push(f); added = true; }
    drag = { f, added, moved: false, x0: e.clientX, y0: e.clientY };
    render(); stats();
  });
  canvas.addEventListener("pointermove", (e) => {
    if (!drag) return;
    if (Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0) > 4) drag.moved = true;
    const [x, y] = frac(e);
    drag.f.x = Math.min(0.98, Math.max(0.02, x));
    drag.f.y = Math.min(0.98, Math.max(0.02, y));
    if (!running) render();
  });
  canvas.addEventListener("pointerup", () => {
    // A tap on an existing source (no drag) removes it.
    if (drag && !drag.moved && !drag.added) food = food.filter((f) => f !== drag.f);
    drag = null;
    render(); stats();
  });
  canvas.addEventListener("pointercancel", () => { drag = null; });

  // Keyboard: arrows move a cursor; Enter or Space adds food there, or removes the source under it.
  keyCursor(canvas, {
    step: 1 / 40,
    onPress(x, y) {
      const f = hit(x, y, canvas.clientWidth);
      if (f) food = food.filter((g) => g !== f);
      else food.push({ x: Math.min(0.98, Math.max(0.02, x)), y: Math.min(0.98, Math.max(0.02, y)), hub: false });
      render(); stats();
      announce((f ? "Removed a food source. " : "Added a food source. ") + food.length + " food sources.");
    },
  });

  // Each source keeps leaking attractant into the trail map, scaled to the current mean trail.
  function feed() {
    const amt = Math.max(20, sim.mean * strength());
    const r = Math.max(2, Math.round(sim.w * 0.012));
    for (const f of food) sim.addDisc(f.x * sim.w, f.y * sim.h, f.hub ? r + 1 : r, amt);
  }

  let frameNo = 0;
  animate(canvas, () => {
    if (running) {
      timed(() => { feed(); sim.step(); });
      render();
      if (++frameNo % 10 === 0) stats();
    }
  }, (shown) => {
    if (shown && !started && !reduceMotion) { started = true; setRunning(true); }
  });

  addEventListener("resize", () => { if (!running) render(); });
  setRunning(false);
  stats(); render();
  prewarm(sim, reduceMotion ? 400 : 100, feed, () => { render(); stats(); });
}
