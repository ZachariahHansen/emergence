// Agent-based Physarum transport network (after Jeff Jones, Artificial Life 16(2), 2010).
// Each agent senses the trail map at three points ahead (left, forward, right), turns toward
// the strongest, steps forward and deposits trail. The trail map then diffuses (3×3 mean) and decays.
// This version leaves out Jones's rule that two agents may not occupy the same square, and adds an
// optional `wobble` (not in Jones): a small random heading jitter, in degrees, after the turn rule.
// With wobble around 20–25° the network settles into a lasting mesh instead of coarsening into a few cords.

import { readPalette, onPaletteChange, mix } from "./palette.js";

const TAU = Math.PI * 2;
const DEG = Math.PI / 180;

export class Physarum {
  constructor(w, h, maxAgents, { wrap = true } = {}) {
    this.w = w; this.h = h;
    this.wrap = wrap;
    this.max = maxAgents;
    this.count = maxAgents;
    this.x = new Float32Array(maxAgents);
    this.y = new Float32Array(maxAgents);
    this.a = new Float32Array(maxAgents);
    this.trail = new Float32Array(w * h);
    this.tmp = new Float32Array(w * h);
    this.mean = 0;
    this.steps = 0;
    // Neighbour lookups for the diffusion pass: wrap around, or clamp at the walls.
    const nb = (n, d) => Int32Array.from({ length: n }, (_, i) =>
      wrap ? (i + d + n) % n : Math.min(n - 1, Math.max(0, i + d)));
    this.xm = nb(w, -1); this.xp = nb(w, 1);
    this.ym = nb(h, -1); this.yp = nb(h, 1);
    // Defaults from Jones (2010): sensor angle 22.5°, turn 45°, sensor offset 9, step 1, deposit 5.
    this.params = { sensorAngle: 22.5, sensorDist: 9, turnAngle: 45, decay: 0.1, wobble: 0, step: 1, deposit: 5 };
    this.seed();
  }

  seed() {
    const { w, h, x, y, a } = this;
    for (let i = 0; i < this.max; i++) {
      x[i] = Math.random() * w; y[i] = Math.random() * h; a[i] = Math.random() * TAU;
    }
    this.trail.fill(0);
    this.mean = 0;
    this.steps = 0;
  }

  // Add `amount` of trail to every square within radius r of (cx, cy), in grid units.
  addDisc(cx, cy, r, amount) {
    const { w, h, trail } = this;
    const r2 = r * r;
    for (let dy = -r; dy <= r; dy++) {
      const yy = Math.round(cy + dy);
      if (yy < 0 || yy >= h) continue;
      for (let dx = -r; dx <= r; dx++) {
        if (dx * dx + dy * dy > r2) continue;
        const xx = Math.round(cx + dx);
        if (xx < 0 || xx >= w) continue;
        trail[yy * w + xx] += amount;
      }
    }
  }

  step() {
    this.moveAgents();
    this.diffuse();
    this.steps++;
  }

  moveAgents() {
    const { w, h, x, y, a, trail, wrap, count } = this;
    const p = this.params;
    const sa = p.sensorAngle * DEG, ra = p.turnAngle * DEG;
    const sd = p.sensorDist, ss = p.step, dep = p.deposit;
    const wob = (p.wobble || 0) * DEG * 2;

    const at = (fx, fy) => {
      let ix = Math.floor(fx), iy = Math.floor(fy);
      if (wrap) {
        if (ix < 0) ix += w; else if (ix >= w) ix -= w;
        if (iy < 0) iy += h; else if (iy >= h) iy -= h;
      } else {
        if (ix < 0) ix = 0; else if (ix >= w) ix = w - 1;
        if (iy < 0) iy = 0; else if (iy >= h) iy = h - 1;
      }
      return trail[iy * w + ix];
    };

    for (let i = 0; i < count; i++) {
      const px = x[i], py = y[i];
      let hd = a[i];

      // Sense
      const f = at(px + Math.cos(hd) * sd, py + Math.sin(hd) * sd);
      const fl = at(px + Math.cos(hd - sa) * sd, py + Math.sin(hd - sa) * sd);
      const fr = at(px + Math.cos(hd + sa) * sd, py + Math.sin(hd + sa) * sd);

      // Rotate
      if (f > fl && f > fr) { /* keep going straight */ }
      else if (f < fl && f < fr) hd += Math.random() < 0.5 ? -ra : ra;
      else if (fl < fr) hd += ra;
      else if (fr < fl) hd -= ra;
      if (wob) hd += (Math.random() - 0.5) * wob;

      // Move
      let nx = px + Math.cos(hd) * ss, ny = py + Math.sin(hd) * ss;
      if (wrap) {
        if (nx < 0) nx += w; else if (nx >= w) nx -= w;
        if (ny < 0) ny += h; else if (ny >= h) ny -= h;
      } else if (nx < 0 || nx >= w || ny < 0 || ny >= h) {
        // Hit a wall: stay put and pick a new random heading.
        nx = px; ny = py; hd = Math.random() * TAU;
      }
      x[i] = nx; y[i] = ny; a[i] = hd;

      // Deposit
      trail[(ny | 0) * w + (nx | 0)] += dep;
    }
  }

  // 3×3 mean filter, then multiply by (1 − decay). Also tracks the mean trail for rendering.
  diffuse() {
    const { w, h, xm, xp, ym, yp } = this;
    const src = this.trail, dst = this.tmp;
    const k = (1 - this.params.decay) / 9;
    let total = 0;
    for (let y = 0; y < h; y++) {
      const r0 = ym[y] * w, r1 = y * w, r2 = yp[y] * w;
      for (let x = 0; x < w; x++) {
        const a = xm[x], b = xp[x];
        const v = (src[r0 + a] + src[r0 + x] + src[r0 + b] +
                   src[r1 + a] + src[r1 + x] + src[r1 + b] +
                   src[r2 + a] + src[r2 + x] + src[r2 + b]) * k;
        dst[r1 + x] = v;
        total += v;
      }
    }
    this.trail = dst; this.tmp = src;
    this.mean = total / (w * h);
  }
}

// Draw the trail map into `canvas` at its displayed size. Trail is scaled by its mean so the picture
// stays readable whatever the parameters, then coloured h0 → h1 → h2 → h3 from the palette.
// `overlay(ctx, scale)` can draw on top in canvas pixels (scale = canvas pixels per grid square).
export function makeTrailRenderer(canvas, sim, { overlay = null } = {}) {
  const { w, h } = sim;
  const grid = document.createElement("canvas");
  grid.width = w; grid.height = h;
  const gctx = grid.getContext("2d");
  const img = gctx.createImageData(w, h);
  const ctx = canvas.getContext("2d");
  const lut = new Uint8Array(256 * 3);
  let pal;

  function buildLut() {
    pal = readPalette();
    const stops = [[0, pal.h0], [0.3, pal.h1], [0.65, pal.h2], [1, pal.h3]];
    for (let i = 0; i < 256; i++) {
      const t = Math.pow(i / 255, 0.7);
      let s = 0;
      while (s < stops.length - 2 && t > stops[s + 1][0]) s++;
      const [t0, c0] = stops[s], [t1, c1] = stops[s + 1];
      const c = mix(c0, c1, (t - t0) / (t1 - t0));
      lut[i * 3] = c[0]; lut[i * 3 + 1] = c[1]; lut[i * 3 + 2] = c[2];
    }
  }
  buildLut();
  onPaletteChange(buildLut);

  return function render() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const cw = Math.max(1, Math.round(canvas.clientWidth * dpr));
    const ch = Math.max(1, Math.round(canvas.clientHeight * dpr));
    if (canvas.width !== cw || canvas.height !== ch) { canvas.width = cw; canvas.height = ch; }

    const t = sim.trail, d = img.data;
    const s = 255 / (sim.mean * 5 + 1e-6);
    for (let i = 0, p = 0; i < t.length; i++, p += 4) {
      let v = (t[i] * s) | 0;
      if (v > 255) v = 255;
      const q = v * 3;
      d[p] = lut[q]; d[p + 1] = lut[q + 1]; d[p + 2] = lut[q + 2]; d[p + 3] = 255;
    }
    gctx.putImageData(img, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(grid, 0, 0, cw, ch);
    if (overlay) overlay(ctx, cw / w, pal);
  };
}

// Pointer position in grid units (may fall outside the grid).
export function gridAt(canvas, sim, ev) {
  const r = canvas.getBoundingClientRect();
  return [((ev.clientX - r.left) / r.width) * sim.w, ((ev.clientY - r.top) / r.height) * sim.h];
}

// A rough device budget: [grid size, agent count] for a figure of a given weight (1 = main figure).
export function budget(weight = 1) {
  const small = Math.min(screen.width, screen.height) < 700 || (navigator.hardwareConcurrency || 4) <= 4;
  const n = Math.round((small ? 200 : 300) * Math.sqrt(weight));
  const agents = Math.round(n * n * (small ? 0.15 : 0.2));
  return [n, agents];
}
