import { Flock, Vicsek } from "/assets/boids.js";
import { readPalette, onPaletteChange, css } from "/assets/palette.js";
import { reduceMotion, onShown, valueText, keyCursor } from "/assets/a11y.js";
const $ = (id) => document.getElementById(id);
let pal = readPalette();
const redraws = [];
onPaletteChange(() => { pal = readPalette(); redraws.forEach((f) => f()); });
window.addEventListener("resize", () => redraws.forEach((f) => f()));

// Size a canvas's backing store for crisp lines; returns its CSS size.
function fit(canvas) {
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth, h = canvas.clientHeight;
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
    canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
  }
  return { w, h, dpr };
}

const rgba = (c, a) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;

// Run `tick` each frame only while the element is on screen, the tab is visible and `isOn()` holds.
function loop(el, tick, isOn) {
  let visible = false, raf = 0;
  const run = () => { raf = 0; if (!visible || !isOn()) return; tick(); raf = requestAnimationFrame(run); };
  const kick = () => { if (!raf && visible && isOn()) raf = requestAnimationFrame(run); };
  onShown(el, (shown) => { visible = shown; kick(); });
  return kick;
}

/* ---------------- Figure 1: the flock, with its three rules ---------------- */

{
  const canvas = $("flock");
  const flock = new Flock(300);
  const S = flock.size, p = flock.params;
  let playing = !reduceMotion, showFocus = true;

  const sliders = { sep: "w-sep", ali: "w-ali", coh: "w-coh", radius: "w-rad" };
  function readSliders() {
    for (const [k, id] of Object.entries(sliders)) {
      p[k] = +$(id).value;
      $(id + "-v").textContent = k === "radius" ? p[k] : p[k].toFixed(1);
    }
  }
  for (const id of Object.values(sliders)) $(id).addEventListener("input", () => { readSliders(); if (!playing) draw(); });
  readSliders();

  function setTopo(on) {
    p.topo = on;
    $("topo").textContent = on ? "neighbours: nearest 7" : "neighbours: within radius";
    $("topo").setAttribute("aria-pressed", on);
    $("w-rad").disabled = on;
    $("w-rad").closest("label").style.opacity = on ? 0.45 : 1;
  }
  $("topo").addEventListener("click", () => { setTopo(!p.topo); flock.step(); draw(); stats(); });
  setTopo(false);

  $("focus").addEventListener("change", (e) => { showFocus = e.target.checked; draw(); });
  $("scatter").addEventListener("click", () => { flock.scatter(); flock.step(); draw(); stats(); });
  $("defaults").addEventListener("click", () => {
    $("w-sep").value = 1.5; $("w-ali").value = 1; $("w-coh").value = 1; $("w-rad").value = 50;
    readSliders(); setTopo(false); if (!playing) draw();
  });

  function setPlay(on) {
    playing = on;
    $("play").textContent = on ? "Pause" : "Play";
    $("play").classList.toggle("primary", !on);
    if (on) kick();
  }
  $("play").addEventListener("click", () => setPlay(!playing));

  // Pointer = predator. Mouse hover counts; touch counts while the finger is down.
  const toWorld = (e) => {
    const r = canvas.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * S, y: ((e.clientY - r.top) / r.height) * S };
  };
  let down = false;
  canvas.addEventListener("pointerdown", (e) => { down = true; canvas.setPointerCapture(e.pointerId); flock.predator = toWorld(e); });
  canvas.addEventListener("pointermove", (e) => { if (down || e.pointerType === "mouse") flock.predator = toWorld(e); });
  const up = (e) => { down = false; if (e.pointerType !== "mouse") flock.predator = null; };
  canvas.addEventListener("pointerup", up);
  canvas.addEventListener("pointercancel", up);
  canvas.addEventListener("pointerleave", () => { if (!down) flock.predator = null; });

  // Keyboard: while the flock has focus, the arrow keys move the predator.
  const kbPredator = (x, y) => { flock.predator = { x: x * S, y: y * S }; if (!playing) draw(); };
  keyCursor(canvas, {
    step: 1 / 40,
    onFocus(x, y) { if (canvas.matches(":focus-visible")) kbPredator(x, y); },
    onMove: kbPredator,
    onBlur() { if (!down) { flock.predator = null; if (!playing) draw(); } },
  });

  function stats() {
    $("f-order").textContent = flock.order().toFixed(2);
    $("f-nbrs").textContent = flock.meanNbrs.toFixed(1);
  }

  function draw() {
    const { w, dpr } = fit(canvas);
    const ctx = canvas.getContext("2d");
    const k = (w / S) * dpr;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(k, 0, 0, k, 0, 0);
    const { x, y, vx, vy, tx, ty, TR, t, n } = flock;
    const px = 1 / (k / dpr); // one CSS pixel in world units

    // trails, oldest point first; skip segments that jump across a wrapped edge
    ctx.strokeStyle = rgba(pal.muted, 0.35); ctx.lineWidth = px;
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      let lx = tx[i * TR + ((t + 1) % TR)], ly = ty[i * TR + ((t + 1) % TR)];
      ctx.moveTo(lx, ly);
      for (let s = 2; s <= TR; s++) {
        const q = i * TR + ((t + s) % TR), nx = tx[q], ny = ty[q];
        if (Math.abs(nx - lx) > S / 2 || Math.abs(ny - ly) > S / 2) ctx.moveTo(nx, ny);
        else ctx.lineTo(nx, ny);
        lx = nx; ly = ny;
      }
    }
    ctx.stroke();

    // one boid's neighbourhood
    const nb = new Set(showFocus ? flock.focus : []);
    if (showFocus) {
      const fx = x[0], fy = y[0], R = flock.focusR;
      ctx.fillStyle = rgba(pal.accent, 0.08); ctx.strokeStyle = rgba(pal.accent, 0.6);
      ctx.lineWidth = 1.2 * px;
      ctx.setLineDash(p.topo ? [4 * px, 4 * px] : []);
      for (let ox = -1; ox <= 1; ox++) for (let oy = -1; oy <= 1; oy++) {
        const cx = fx + ox * S, cy = fy + oy * S;
        if (cx + R < 0 || cx - R > S || cy + R < 0 || cy - R > S) continue;
        ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      }
      ctx.setLineDash([]);
      ctx.strokeStyle = rgba(pal.accent, 0.5); ctx.lineWidth = px;
      ctx.beginPath();
      for (const j of nb) {
        let dx = x[j] - fx, dy = y[j] - fy;
        if (dx > S / 2) dx -= S; else if (dx < -S / 2) dx += S;
        if (dy > S / 2) dy -= S; else if (dy < -S / 2) dy += S;
        ctx.moveTo(fx, fy); ctx.lineTo(fx + dx, fy + dy);
      }
      ctx.stroke();
    }

    // boids as small arrowheads pointing along their velocity
    const L = 7 * Math.max(1, px * 0.8), Wd = L * 0.42;
    const tri = (i) => {
      const s = Math.hypot(vx[i], vy[i]) || 1, ux = vx[i] / s, uy = vy[i] / s;
      ctx.moveTo(x[i] + ux * L * 0.6, y[i] + uy * L * 0.6);
      ctx.lineTo(x[i] - ux * L * 0.4 - uy * Wd, y[i] - uy * L * 0.4 + ux * Wd);
      ctx.lineTo(x[i] - ux * L * 0.4 + uy * Wd, y[i] - uy * L * 0.4 - ux * Wd);
      ctx.closePath();
    };
    ctx.fillStyle = css(pal.ink);
    ctx.beginPath();
    for (let i = showFocus ? 1 : 0; i < n; i++) if (!nb.has(i)) tri(i);
    ctx.fill();
    if (showFocus) {
      ctx.fillStyle = css(pal.glow);
      ctx.beginPath(); for (const j of nb) tri(j); ctx.fill();
      ctx.save();
      ctx.translate(x[0], y[0]); ctx.scale(1.6, 1.6); ctx.translate(-x[0], -y[0]);
      ctx.fillStyle = css(pal.accent); ctx.beginPath(); tri(0); ctx.fill();
      ctx.restore();
    }

    if (flock.predator) {
      ctx.strokeStyle = rgba(pal.accent, 0.8); ctx.lineWidth = 1.5 * px;
      ctx.beginPath(); ctx.arc(flock.predator.x, flock.predator.y, 10, 0, Math.PI * 2); ctx.stroke();
    }
  }
  redraws.push(draw);

  let frameNo = 0;
  const kick = loop(canvas, () => {
    flock.step(); draw();
    if (++frameNo % 10 === 0) stats();
  }, () => playing);

  // With reduced motion, show a flock that has already formed instead of noise.
  if (reduceMotion) for (let i = 0; i < 400; i++) flock.step();
  else flock.step();
  setPlay(playing);
  draw(); stats();
}

/* ---------------- Figure 2: Vicsek particles and the order parameter ---------------- */

{
  const field = $("vicsek"), chart = $("order");
  const model = new Vicsek(500, 14, 0.15);
  const S = model.size;
  const H = 600; // frames of history
  const hist = new Float32Array(H), etaHist = new Float32Array(H);
  let head = 0, filled = 0, playing = !reduceMotion;

  const slider = $("eta");
  const readEta = () => { model.eta = +slider.value; $("eta-v").textContent = model.eta.toFixed(2); };
  slider.addEventListener("input", readEta);
  readEta();
  valueText(slider, (v) => `${(+v).toFixed(2)}: random turns of up to ${Math.round((v / (2 * Math.PI)) * 180)} degrees either way`);

  function setPlay(on) {
    playing = on;
    $("v-play").textContent = on ? "Pause" : "Play";
    $("v-play").classList.toggle("primary", !on);
    if (on) kick();
  }
  $("v-play").addEventListener("click", () => setPlay(!playing));
  $("v-scatter").addEventListener("click", () => { model.scatter(); record(); drawAll(); });

  function record() {
    hist[head] = model.order(); etaHist[head] = model.eta;
    head = (head + 1) % H; filled = Math.min(H, filled + 1);
  }

  function drawField() {
    const { w, dpr } = fit(field);
    const ctx = field.getContext("2d");
    const k = (w / S) * dpr;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, field.width, field.height);
    ctx.setTransform(k, 0, 0, k, 0, 0);
    const L = 0.32, { x, y, th, n } = model;
    ctx.strokeStyle = css(pal.ink); ctx.lineWidth = 1.4 / (k / dpr); ctx.lineCap = "round";
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      const c = Math.cos(th[i]) * L, s = Math.sin(th[i]) * L;
      ctx.moveTo(x[i] - c, y[i] - s); ctx.lineTo(x[i] + c, y[i] + s);
    }
    ctx.stroke();
    ctx.fillStyle = css(pal.accent);
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      const hx = x[i] + Math.cos(th[i]) * L, hy = y[i] + Math.sin(th[i]) * L;
      ctx.moveTo(hx, hy); ctx.arc(hx, hy, 0.07, 0, Math.PI * 2);
    }
    ctx.fill();
  }

  function drawChart() {
    const { w, h, dpr } = fit(chart);
    const ctx = chart.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const Lm = 36, R = 10, T = 10, B = 22;
    const pw = w - Lm - R, ph = h - T - B;
    const X = (i) => Lm + (i / (H - 1)) * pw;
    const Y = (v) => T + (1 - v) * ph;

    ctx.font = "11px 'IBM Plex Mono', ui-monospace, monospace";
    ctx.strokeStyle = css(pal.rule); ctx.fillStyle = css(pal.muted); ctx.lineWidth = 1;
    ctx.textAlign = "right"; ctx.textBaseline = "middle";
    for (const v of [0, 0.5, 1]) {
      ctx.beginPath(); ctx.moveTo(Lm, Y(v)); ctx.lineTo(Lm + pw, Y(v)); ctx.stroke();
      ctx.fillText(v.toFixed(1), Lm - 6, Y(v));
    }
    ctx.textAlign = "center"; ctx.textBaseline = "bottom";
    ctx.fillText("last " + H + " steps → now", Lm + pw / 2, h - 1);

    const start = filled < H ? 0 : head, off = H - filled;
    const line = (arr, scale) => {
      ctx.beginPath();
      for (let s = 0; s < filled; s++) {
        const v = arr[(start + s) % H] / scale;
        s ? ctx.lineTo(X(off + s), Y(v)) : ctx.moveTo(X(off + s), Y(v));
      }
      ctx.stroke();
    };
    ctx.strokeStyle = rgba(pal.muted, 0.7); ctx.lineWidth = 1; ctx.setLineDash([3, 3]);
    line(etaHist, 2 * Math.PI);
    ctx.setLineDash([]);
    ctx.strokeStyle = css(pal.accent); ctx.lineWidth = 1.6;
    line(hist, 1);
  }

  function drawAll() {
    drawField(); drawChart();
    $("v-order").textContent = filled ? hist[(head - 1 + H) % H].toFixed(2) : "—";
  }
  redraws.push(drawAll);

  const kick = loop(field, () => {
    model.step(); model.step(); record(); drawAll();
  }, () => playing);

  record();
  // With reduced motion, open on particles that have already lined up, with a history to match.
  if (reduceMotion) for (let i = 0; i < 300; i++) { model.step(); model.step(); record(); }
  setPlay(playing);
  drawAll();
}
