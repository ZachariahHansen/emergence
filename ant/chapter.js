import { Ant, parseRule } from "/assets/ant.js";
import { cellAt } from "/assets/sandpile.js";
import { readPalette, onPaletteChange, mix, css } from "/assets/palette.js";

const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
const fmt = (x) => Math.round(x).toLocaleString("en-US");
const $ = (id) => document.getElementById(id);

let pal = readPalette();
const fields = [];
onPaletteChange(() => { pal = readPalette(); for (const f of fields) f.recolour(); });
window.addEventListener("resize", () => { for (const f of fields) f.invalidate(); });

// Slider 0..100 to steps per frame, on a log scale from 1 to `max`.
const perFrame = (el, max) => Math.max(1, Math.round(Math.pow(max, el.value / 100)));

// Colour for each state of a k-colour rule. State 0 is the background; Langton's two-colour
// ant uses the darkest token for "black". Longer rules interpolate along h1 → h3 → accent.
function stateColours(k) {
  if (k <= 4) return [pal.h0, ...[pal.h1, pal.h2, pal.h3].slice(4 - k)];
  const stops = [pal.h1, pal.h2, pal.h3, pal.accent];
  const out = [pal.h0];
  for (let c = 1; c < k; c++) {
    const t = ((c - 1) / (k - 2)) * (stops.length - 1);
    const j = Math.min(stops.length - 2, Math.floor(t));
    out.push(mix(stops[j], stops[j + 1], t - j));
  }
  return out;
}

// One pixel per square on the field canvas, repainting only squares the ant (or a brush) touched.
// A second, full-resolution canvas on top draws the ant itself and the highway marker.
function makeField(canvas, overlay, ant) {
  const n = ant.n;
  canvas.width = n; canvas.height = n;
  const ctx = canvas.getContext("2d");
  const img = ctx.createImageData(n, n);
  const octx = overlay.getContext("2d");
  let cols = [], mark = null, drawn = -1;

  function recolour() {
    cols = stateColours(ant.k);
    ant.dirtyAll = true;
    drawn = -1;
  }

  function paintCells() {
    const d = img.data, cells = ant.cells;
    if (ant.dirtyAll) {
      for (let i = 0, p = 0; i < cells.length; i++, p += 4) {
        const c = cols[cells[i]];
        d[p] = c[0]; d[p + 1] = c[1]; d[p + 2] = c[2]; d[p + 3] = 255;
      }
      ctx.putImageData(img, 0, 0);
      ant.dirtyAll = false; ant.nDirty = 0;
      return;
    }
    if (!ant.nDirty) return;
    let x0 = n, y0 = n, x1 = -1, y1 = -1;
    for (let j = 0; j < ant.nDirty; j++) {
      const i = ant.dirty[j], p = i << 2, c = cols[cells[i]];
      d[p] = c[0]; d[p + 1] = c[1]; d[p + 2] = c[2];
      const x = i % n, y = (i / n) | 0;
      if (x < x0) x0 = x; if (x > x1) x1 = x;
      if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
    ctx.putImageData(img, 0, 0, x0, y0, x1 - x0 + 1, y1 - y0 + 1);
    ant.nDirty = 0;
  }

  function paintOverlay() {
    const dpr = window.devicePixelRatio || 1;
    const w = overlay.clientWidth, h = overlay.clientHeight;
    if (!w || !h) return;
    if (overlay.width !== Math.round(w * dpr)) {
      overlay.width = Math.round(w * dpr); overlay.height = Math.round(h * dpr);
    }
    octx.setTransform(dpr, 0, 0, dpr, 0, 0);
    octx.clearRect(0, 0, w, h);
    const s = w / n;

    if (mark) {
      const mx = (mark.x + 0.5) * s, my = (mark.y + 0.5) * s, r = Math.max(10, s * 6);
      octx.strokeStyle = css(pal.accent); octx.lineWidth = 1.5;
      octx.beginPath(); octx.arc(mx, my, r, 0, Math.PI * 2); octx.stroke();
      octx.font = "11px 'IBM Plex Mono', ui-monospace, monospace";
      octx.textBaseline = "middle";
      const tw = octx.measureText(mark.label).width;
      let tx = mx + r + 6, ty = my;
      if (tx + tw > w - 4) tx = mx - r - 6 - tw;
      ty = Math.max(10, Math.min(h - 10, ty));
      octx.lineWidth = 3; octx.strokeStyle = css(pal.bg); octx.strokeText(mark.label, tx, ty);
      octx.fillStyle = css(pal.ink); octx.fillText(mark.label, tx, ty);
    }

    const ax = (ant.x + 0.5) * s, ay = (ant.y + 0.5) * s, ar = Math.max(3, s * 0.75);
    octx.beginPath(); octx.arc(ax, ay, ar, 0, Math.PI * 2);
    octx.fillStyle = css(pal.accent); octx.fill();
    octx.lineWidth = 1.5; octx.strokeStyle = css(pal.bg); octx.stroke();
  }

  function draw() {
    paintCells();
    if (drawn !== ant.steps) { paintOverlay(); drawn = ant.steps; }
  }

  recolour();
  const f = {
    draw, recolour,
    invalidate() { drawn = -1; },
    setMark(m) { mark = m; drawn = -1; },
  };
  fields.push(f);
  return f;
}

// Notice when the ant's highway detector switches on, and put a ring where the highway began.
function trackHighway(ant, field, hw) {
  if (ant.highwayFrom >= 0 && hw.onset !== ant.highwayFrom) {
    hw.onset = ant.highwayFrom;
    hw.count++;
    const periods = (ant.steps - ant.highwayFrom) / ant.period;
    field.setMark({
      x: ant.x - ant.ddx * periods, y: ant.y - ant.ddy * periods,
      label: "highway from step " + fmt(hw.onset),
    });
  } else if (ant.highwayFrom < 0) {
    hw.onset = -1;
  }
}

function countNonzero(cells) {
  let c = 0;
  for (let i = 0; i < cells.length; i++) if (cells[i]) c++;
  return c;
}

/* ---------------- Figure 1: one ant on an empty grid ---------------- */

{
  const N = 200;
  const canvas = $("walk");
  const ant = new Ant(N);
  const field = makeField(canvas, $("walk-over"), ant);
  const hw = { onset: -1, count: 0 };
  let playing = false, visible = false, started = false;

  // Start near the top right: from an empty grid this ant's highway heads down and to the left.
  function restart() {
    ant.clear();
    ant.reset(N - 40, 32, 0);
    hw.onset = -1; hw.count = 0;
    field.setMark(null);
  }

  function setPlay(on) {
    playing = on && !ant.halted;
    const b = $("w-play");
    b.textContent = playing ? "Pause" : ant.halted ? "Again" : "Play";
    b.classList.toggle("primary", !playing);
  }

  function advance(k) {
    ant.step(k);
    trackHighway(ant, field, hw);
    if (ant.halted) setPlay(false);
  }

  function stats() {
    $("w-steps").textContent = fmt(ant.steps);
    $("w-black").textContent = fmt(countNonzero(ant.cells));
    $("w-highway").textContent = hw.onset >= 0 ? "from step " + fmt(hw.onset) : "not yet";
    $("w-status").textContent = ant.halted ? "stopped at edge" : playing ? "walking" : "paused";
    $("w-rate").textContent = fmt(perFrame($("w-speed"), 10000)) + "/frame";
  }

  $("w-play").addEventListener("click", () => {
    if (ant.halted) { restart(); setPlay(true); } else setPlay(!playing);
    started = true;
    stats();
  });
  $("w-step").addEventListener("click", () => { setPlay(false); advance(1); started = true; stats(); });
  $("w-ff").addEventListener("click", () => { advance(1000); started = true; stats(); });
  $("w-reset").addEventListener("click", () => { restart(); setPlay(false); stats(); });
  $("w-speed").addEventListener("input", stats);

  let frameNo = 0;
  function frame() {
    if (visible) {
      if (playing) advance(perFrame($("w-speed"), 10000));
      field.draw();
      if (playing && ++frameNo % 6 === 0) stats();
    }
    requestAnimationFrame(frame);
  }

  new IntersectionObserver(([e]) => {
    visible = e.isIntersecting;
    if (visible) field.invalidate();
    if (visible && !started && !reduceMotion) { started = true; setPlay(true); }
  }).observe(canvas);

  restart();
  setPlay(false);
  stats();
  frame();
}

/* ---------------- Figure 2: mess it up ---------------- */

{
  const N = 160, PATCH = 32;
  const canvas = $("mess");
  const ant = new Ant(N);
  const field = makeField(canvas, $("mess-over"), ant);
  const hw = { onset: -1, count: 0 };
  let playing = false, visible = false, started = false, black = true, last = -1;

  function newAnt() {
    ant.reset();
    hw.onset = -1; hw.count = 0;
    field.setMark(null);
  }

  function randomPatch() {
    ant.cells.fill(0);
    const o = (N - PATCH) >> 1;
    for (let y = 0; y < PATCH; y++)
      for (let x = 0; x < PATCH; x++)
        if (Math.random() < 0.5) ant.cells[(o + y) * N + o + x] = 1;
    newAnt();
  }

  function setPlay(on) {
    playing = on && !ant.halted;
    const b = $("m-play");
    b.textContent = playing ? "Pause" : "Play";
    b.classList.toggle("primary", !playing);
  }

  function advance(k) {
    ant.step(k);
    trackHighway(ant, field, hw);
    if (ant.halted) setPlay(false);
  }

  function stats() {
    $("m-steps").textContent = fmt(ant.steps);
    $("m-highway").textContent = hw.onset >= 0 ? "from step " + fmt(hw.onset)
      : hw.count ? "broken" : "not yet";
    $("m-count").textContent = fmt(hw.count);
    $("m-status").textContent = ant.halted ? "stopped at edge" : playing ? "walking" : "paused";
    $("m-rate").textContent = fmt(perFrame($("m-speed"), 10000)) + "/frame";
  }

  // A small plus-shaped brush, interpolated between pointer events so fast strokes have no gaps.
  function dab(i) {
    const x = i % N, y = (i / N) | 0, v = black ? 1 : 0;
    ant.set(i, v);
    if (x > 0) ant.set(i - 1, v);
    if (x < N - 1) ant.set(i + 1, v);
    if (y > 0) ant.set(i - N, v);
    if (y < N - 1) ant.set(i + N, v);
  }
  function stroke(a, b) {
    const ax = a % N, ay = (a / N) | 0, bx = b % N, by = (b / N) | 0;
    const k = Math.max(Math.abs(bx - ax), Math.abs(by - ay), 1);
    for (let t = 0; t <= k; t++) {
      dab(Math.round(ay + ((by - ay) * t) / k) * N + Math.round(ax + ((bx - ax) * t) / k));
    }
  }

  canvas.addEventListener("pointerdown", (e) => {
    canvas.setPointerCapture(e.pointerId);
    last = cellAt(canvas, N, e);
    if (last >= 0) dab(last);
  });
  canvas.addEventListener("pointermove", (e) => {
    if (last === -1) return;
    const c = cellAt(canvas, N, e);
    if (c >= 0) { stroke(last, c); last = c; }
  });
  const release = () => { last = -1; };
  canvas.addEventListener("pointerup", release);
  canvas.addEventListener("pointercancel", release);

  $("m-play").addEventListener("click", () => { setPlay(!playing); started = true; stats(); });
  $("m-brush").addEventListener("click", () => {
    black = !black;
    $("m-brush").textContent = "Brush: " + (black ? "black" : "white");
  });
  $("m-ant").addEventListener("click", () => { newAnt(); started = true; setPlay(true); stats(); });
  $("m-noise").addEventListener("click", () => { randomPatch(); started = true; setPlay(true); stats(); });
  $("m-clear").addEventListener("click", () => { ant.cells.fill(0); newAnt(); setPlay(false); stats(); });
  $("m-speed").addEventListener("input", stats);

  let frameNo = 0;
  function frame() {
    if (visible) {
      if (playing) advance(perFrame($("m-speed"), 10000));
      field.draw();
      if (++frameNo % 6 === 0) stats();
    }
    requestAnimationFrame(frame);
  }

  new IntersectionObserver(([e]) => {
    visible = e.isIntersecting;
    if (visible) field.invalidate();
    if (visible && !started && !reduceMotion) { started = true; setPlay(true); }
  }).observe(canvas);

  randomPatch();
  setPlay(false);
  stats();
  frame();
}

/* ---------------- Figure 3: more colours, more turns ---------------- */

{
  const N = 200;
  const canvas = $("multi");
  const ant = new Ant(N, "LLRR", { period: 0 });
  const field = makeField(canvas, $("multi-over"), ant);
  const input = $("t-rule"), pick = $("t-pick"), note = $("t-note"), legend = $("t-legend");
  let playing = false, visible = false, started = false;

  const NOTES = {
    RL: "Langton's ant. Chaos, then the 104-step highway.",
    RLR: "Grows chaotically. No highway has been seen.",
    LLRR: "Grows, and keeps returning to exact mirror symmetry.",
    LRRRRRLLR: "Fills in a square around itself.",
    RRLLLRLLLRRR: "Grows a solid triangle that crawls across the grid.",
    LLRRRLRLRLLR: "A wide, convoluted highway that repeats every 1,968 steps.",
  };

  function drawLegend() {
    const cols = stateColours(ant.k);
    legend.replaceChildren(...[...ant.rule].map((t, c) => {
      const s = document.createElement("span");
      const i = document.createElement("i");
      i.style.background = css(cols[c]);
      s.append(i, `${c}: ${t === "R" ? "right" : t === "L" ? "left" : t === "U" ? "u-turn" : "straight"}`);
      return s;
    }));
  }

  function apply(text) {
    const rule = parseRule(text);
    if (!rule || rule.length > 16) {
      note.textContent = "A rule is 2 to 16 letters, each R or L (N = straight on, U = u-turn).";
      return false;
    }
    input.value = rule;
    pick.value = NOTES[rule] ? rule : "";
    ant.cells.fill(0);
    ant.setRule(rule);
    ant.reset();
    field.recolour();
    drawLegend();
    note.textContent = NOTES[rule] || "Your own rule. Nobody may have run this one before.";
    return true;
  }

  function setPlay(on) {
    playing = on && !ant.halted;
    const b = $("t-play");
    b.textContent = playing ? "Pause" : ant.halted ? "Again" : "Play";
    b.classList.toggle("primary", !playing);
  }

  function stats() {
    $("t-steps").textContent = fmt(ant.steps);
    $("t-colours").textContent = ant.k;
    $("t-status").textContent = ant.halted ? "stopped at edge" : playing ? "walking" : "paused";
    $("t-rate").textContent = fmt(perFrame($("t-speed"), 50000)) + "/frame";
  }

  pick.addEventListener("change", () => {
    if (pick.value && apply(pick.value)) { started = true; setPlay(true); stats(); }
  });
  $("t-go").addEventListener("click", () => {
    if (apply(input.value)) { started = true; setPlay(true); }
    stats();
  });
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") $("t-go").click(); });
  $("t-play").addEventListener("click", () => {
    const again = ant.halted;
    if (again) apply(ant.rule);
    setPlay(again || !playing);
    started = true;
    stats();
  });
  $("t-speed").addEventListener("input", stats);
  onPaletteChange(drawLegend); // runs after the shared palette refresh above

  let frameNo = 0;
  function frame() {
    if (visible) {
      if (playing) {
        ant.step(perFrame($("t-speed"), 50000));
        if (ant.halted) setPlay(false);
      }
      field.draw();
      if (++frameNo % 6 === 0) stats();
    }
    requestAnimationFrame(frame);
  }

  new IntersectionObserver(([e]) => {
    visible = e.isIntersecting;
    if (visible) field.invalidate();
    if (visible && !started && !reduceMotion) { started = true; setPlay(true); }
  }).observe(canvas);

  apply("LLRR");
  setPlay(false);
  stats();
  frame();
}
