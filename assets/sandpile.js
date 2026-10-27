// Abelian sandpile (Bak–Tang–Wiesenfeld). Cells hold grains; four or more topple,
// sending one grain to each neighbour. Grains pushed past the edge are lost.

import { readPalette, onPaletteChange, mix } from "./palette.js";

export class Sandpile {
  constructor(n, rows = n) {
    this.n = n;        // columns
    this.rows = rows;
    const size = n * rows;
    this.h = new Int32Array(size);
    this.glow = new Float32Array(size);
    this.queued = new Uint8Array(size);
    this.stack = new Int32Array(size);
  }

  clear() {
    this.h.fill(0);
    this.glow.fill(0);
  }

  // Add one grain at index i and relax fully. Returns the number of topplings.
  drop(i) {
    const { n, rows, h, glow, queued, stack } = this;
    h[i]++;
    if (h[i] < 4) return 0;
    let top = 0, size = 0;
    stack[top++] = i; queued[i] = 1;
    while (top > 0) {
      const c = stack[--top];
      queued[c] = 0;
      if (h[c] < 4) continue;
      const q = h[c] >> 2;
      h[c] -= q << 2;
      size += q;
      glow[c] = 1;
      const x = c % n, y = (c / n) | 0;
      if (x > 0)     push(c - 1);
      if (x < n - 1) push(c + 1);
      if (y > 0)     push(c - n);
      if (y < rows - 1) push(c + n);
      function push(j) {
        h[j] += q;
        if (h[j] >= 4 && !queued[j]) { queued[j] = 1; stack[top++] = j; }
      }
    }
    return size;
  }
}

// Paint heights (and fading avalanche glow) into a canvas one pixel per cell.
// `dim` (0..1) fades the heights toward the background so only avalanches stand out.
export function makeRenderer(canvas, pile, { dim = 0 } = {}) {
  const w = pile.n, hgt = pile.rows ?? pile.n;
  canvas.width = w; canvas.height = hgt;
  const ctx = canvas.getContext("2d");
  const img = ctx.createImageData(w, hgt);
  let pal = readPalette();
  onPaletteChange(() => { pal = readPalette(); });

  return function render(decay = 0.9) {
    const { h, glow } = pile;
    const d = img.data;
    const base = [pal.h0, pal.h1, pal.h2, pal.h3].map((c) => mix(c, pal.h0, dim));
    for (let i = 0, p = 0; i < h.length; i++, p += 4) {
      const c = base[h[i] > 3 ? 3 : h[i]];
      const g = glow[i];
      if (g > 0.02) {
        const m = mix(c, pal.glow, Math.min(1, g * (0.85 + dim)));
        d[p] = m[0]; d[p + 1] = m[1]; d[p + 2] = m[2];
        glow[i] = g * decay;
      } else {
        d[p] = c[0]; d[p + 1] = c[1]; d[p + 2] = c[2];
        glow[i] = 0;
      }
      d[p + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
  };
}

// Map a pointer event to a cell index on an n×n canvas.
export function cellAt(canvas, n, ev) {
  const r = canvas.getBoundingClientRect();
  const x = Math.floor(((ev.clientX - r.left) / r.width) * n);
  const y = Math.floor(((ev.clientY - r.top) / r.height) * n);
  if (x < 0 || y < 0 || x >= n || y >= n) return -1;
  return y * n + x;
}

// Relax a pile that starts with `grains` at the centre, a few sweeps per frame.
// The abelian property means the order of topplings never changes the result,
// so a sweep that topples every unstable cell at once is as valid as one at a time.
export class BigPile {
  constructor(grains) {
    this.grains = grains;
    // The final pile is roughly a disc of area grains / 2.125.
    const r = Math.sqrt(grains / 2.125 / Math.PI);
    this.n = Math.max(31, (Math.ceil(r * 1.12) * 2 + 9) | 1);
    const n = this.n;
    this.h = new Int32Array(n * n);
    this.glow = new Float32Array(n * n);
    const c = (n >> 1) * n + (n >> 1);
    this.h[c] = grains;
    this.lo = n >> 1; this.hi = n >> 1; // bounding box of active region
    this.done = false;
    this.topplings = 0;
  }

  step(budgetMs) {
    const { n, h, glow } = this;
    const t0 = performance.now();
    while (!this.done && performance.now() - t0 < budgetMs) {
      for (let s = 0; s < 8; s++) {
        let any = false;
        let lo = this.lo, hi = this.hi;
        for (let y = lo; y <= hi; y++) {
          const row = y * n;
          for (let x = lo; x <= hi; x++) {
            const i = row + x;
            const v = h[i];
            if (v < 4) continue;
            const q = v >> 2;
            h[i] = v - (q << 2);
            h[i - 1] += q; h[i + 1] += q; h[i - n] += q; h[i + n] += q;
            this.topplings += q;
            glow[i] = 1;
            any = true;
            if (x - 1 < this.lo) this.lo = x - 1;
            if (x + 1 > this.hi) this.hi = x + 1;
            if (y - 1 < this.lo) this.lo = y - 1;
            if (y + 1 > this.hi) this.hi = y + 1;
          }
        }
        if (this.lo < 1) this.lo = 1;
        if (this.hi > n - 2) this.hi = n - 2;
        if (!any) { this.done = true; break; }
      }
    }
    return this.done;
  }
}
