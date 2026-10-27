// Boids (Reynolds 1987) and the Vicsek model (1995) on a wrap-around square.
// Neighbour searches go through a uniform grid, so a step costs roughly O(n)
// instead of comparing every pair.

// Shortest signed offset from a to b on a ring of length s.
const wrapD = (d, s) => (d > s / 2 ? d - s : d < -s / 2 ? d + s : d);

class Grid {
  constructor(size, cell) { this.resize(size, cell); }

  resize(size, cell) {
    this.size = size;
    this.cols = Math.max(1, Math.floor(size / cell));
    this.cell = size / this.cols;
    this.head = new Int32Array(this.cols * this.cols);
    this.span = new Int32Array(this.cols);
    this.spanY = new Int32Array(this.cols);
  }

  build(x, y, n) {
    if (!this.next || this.next.length < n) this.next = new Int32Array(n);
    const { cols, cell, head, next } = this;
    head.fill(-1);
    for (let i = 0; i < n; i++) {
      const cx = Math.min(cols - 1, (x[i] / cell) | 0);
      const cy = Math.min(cols - 1, (y[i] / cell) | 0);
      const c = cy * cols + cx;
      next[i] = head[c]; head[c] = i;
    }
  }

  // Columns within m cells of c (wrapped, no duplicates). Returns the count.
  around(c, m, out) {
    const { cols } = this;
    if (2 * m + 1 >= cols) { for (let k = 0; k < cols; k++) out[k] = k; return cols; }
    let k = 0;
    for (let o = -m; o <= m; o++) out[k++] = (c + o + cols) % cols;
    return k;
  }

  cellOf(v) { return Math.min(this.cols - 1, (v / this.cell) | 0); }
}

export class Flock {
  constructor(n, size = 600) {
    this.n = n;
    this.size = size;
    this.x = new Float32Array(n); this.y = new Float32Array(n);
    this.vx = new Float32Array(n); this.vy = new Float32Array(n);
    this.nvx = new Float32Array(n); this.nvy = new Float32Array(n);
    this.TR = 7; // trail length
    this.tx = new Float32Array(n * this.TR); this.ty = new Float32Array(n * this.TR);
    this.t = 0;
    this.grid = new Grid(size, 50);
    this.nIdx = new Int32Array(n); this.nD = new Float32Array(n);
    this.params = { sep: 1.5, ali: 1, coh: 1, radius: 50, topo: false, k: 7 };
    this.maxSpeed = 2.4; this.minSpeed = 1.2; this.maxForce = 0.06;
    this.predator = null;   // {x, y} in world units, or null
    this.focus = [];        // neighbour indices of boid 0, for drawing
    this.focusR = 0;        // radius of boid 0's neighbourhood
    this.meanNbrs = 0;
    this.scatter();
  }

  scatter() {
    const { n, size, TR } = this;
    for (let i = 0; i < n; i++) {
      this.x[i] = Math.random() * size; this.y[i] = Math.random() * size;
      const a = Math.random() * Math.PI * 2, s = 1.8;
      this.vx[i] = Math.cos(a) * s; this.vy[i] = Math.sin(a) * s;
      for (let k = 0; k < TR; k++) { this.tx[i * TR + k] = this.x[i]; this.ty[i * TR + k] = this.y[i]; }
    }
  }

  // |mean heading|: 0 when headings cancel out, 1 when all boids point the same way.
  order() {
    let sx = 0, sy = 0;
    for (let i = 0; i < this.n; i++) {
      const s = Math.hypot(this.vx[i], this.vy[i]) || 1;
      sx += this.vx[i] / s; sy += this.vy[i] / s;
    }
    return Math.hypot(sx, sy) / this.n;
  }

  // Fill nIdx/nD with boid i's neighbours (squared distances). Returns the count.
  neighbours(i) {
    const { x, y, size, grid, nIdx, nD, params } = this;
    const { head, next, cols, span, spanY } = grid;
    const xi = x[i], yi = y[i];
    const cx = grid.cellOf(xi), cy = grid.cellOf(yi);

    if (!params.topo) {
      const R2 = params.radius * params.radius;
      const m = Math.ceil(params.radius / grid.cell);
      const nx = grid.around(cx, m, span), ny = grid.around(cy, m, spanY);
      let c = 0;
      for (let a = 0; a < ny; a++) {
        const row = spanY[a] * cols;
        for (let b = 0; b < nx; b++) {
          for (let j = head[row + span[b]]; j !== -1; j = next[j]) {
            if (j === i) continue;
            const dx = wrapD(x[j] - xi, size), dy = wrapD(y[j] - yi, size);
            const d2 = dx * dx + dy * dy;
            if (d2 < R2) { nIdx[c] = j; nD[c] = d2; c++; }
          }
        }
      }
      return c;
    }

    // Topological: the k nearest, found by scanning rings of cells outward.
    // After ring r, every boid closer than r cells has been seen.
    const k = Math.min(params.k, this.n - 1);
    const rmax = cols >> 1, even = (cols & 1) === 0;
    let c = 0;
    const visit = (ox, oy) => {
      const cell = ((cy + oy + cols) % cols) * cols + ((cx + ox + cols) % cols);
      for (let j = head[cell]; j !== -1; j = next[j]) {
        if (j === i) continue;
        const dx = wrapD(x[j] - xi, size), dy = wrapD(y[j] - yi, size);
        const d2 = dx * dx + dy * dy;
        if (c === k && d2 >= nD[k - 1]) continue;
        let p = c < k ? c++ : k - 1; // insertion sort into the best-k list
        while (p > 0 && nD[p - 1] > d2) { nD[p] = nD[p - 1]; nIdx[p] = nIdx[p - 1]; p--; }
        nD[p] = d2; nIdx[p] = j;
      }
    };
    for (let r = 0; r <= rmax; r++) {
      if (r === 0) visit(0, 0);
      else {
        for (let oy = -r; oy <= r; oy++) {
          if (even && oy === rmax) continue; // same row as -rmax
          const edge = oy === -r || oy === r;
          for (let ox = -r; ox <= r; ox += edge ? 1 : 2 * r) {
            if (even && ox === rmax) continue;
            visit(ox, oy);
          }
        }
      }
      const reach = r * grid.cell;
      if (c === k && nD[k - 1] <= reach * reach) break;
    }
    return c;
  }

  step() {
    const { n, x, y, vx, vy, nvx, nvy, size, nIdx, nD, params, maxSpeed, maxForce } = this;
    const cell = params.topo ? 30 : Math.max(15, params.radius);
    if (Math.max(1, Math.floor(size / cell)) !== this.grid.cols) this.grid.resize(size, cell);
    this.grid.build(x, y, n);
    const sepR = Math.min(20, params.topo ? 20 : params.radius);
    const sepR2 = sepR * sepR;
    const pred = this.predator, fleeR = 90;
    let total = 0;

    // Reynolds-style steering: turn toward a desired velocity, with limited force.
    let fx = 0, fy = 0;
    const steer = (ax, ay, w, vxi, vyi) => {
      const l = Math.hypot(ax, ay);
      if (!l || !w) return;
      let sx = (ax / l) * maxSpeed - vxi, sy = (ay / l) * maxSpeed - vyi;
      const f = Math.hypot(sx, sy);
      if (f > maxForce) { sx *= maxForce / f; sy *= maxForce / f; }
      fx += sx * w; fy += sy * w;
    };

    for (let i = 0; i < n; i++) {
      const c = this.neighbours(i);
      total += c;
      if (i === 0) {
        this.focus = Array.from(nIdx.subarray(0, c));
        this.focusR = params.topo ? (c ? Math.sqrt(nD[c - 1]) : 0) : params.radius;
      }
      const xi = x[i], yi = y[i], vxi = vx[i], vyi = vy[i];
      let sx = 0, sy = 0, ax = 0, ay = 0, cx = 0, cy = 0;
      for (let a = 0; a < c; a++) {
        const j = nIdx[a], d2 = nD[a];
        const dx = wrapD(x[j] - xi, size), dy = wrapD(y[j] - yi, size);
        cx += dx; cy += dy;
        ax += vx[j]; ay += vy[j];
        if (d2 < sepR2 && d2 > 1e-6) { sx -= dx / d2; sy -= dy / d2; }
      }
      fx = 0; fy = 0;
      if (c) {
        steer(sx, sy, params.sep, vxi, vyi);
        steer(ax / c, ay / c, params.ali, vxi, vyi);
        steer(cx / c, cy / c, params.coh, vxi, vyi);
      }
      if (pred) {
        const dx = wrapD(xi - pred.x, size), dy = wrapD(yi - pred.y, size);
        if (dx * dx + dy * dy < fleeR * fleeR) steer(dx, dy, 5, vxi, vyi);
      }
      fx += (Math.random() - 0.5) * 0.02; fy += (Math.random() - 0.5) * 0.02;
      nvx[i] = vxi + fx; nvy[i] = vyi + fy;
    }
    this.meanNbrs = total / n;

    this.t = (this.t + 1) % this.TR;
    const TR = this.TR, t = this.t;
    for (let i = 0; i < n; i++) {
      let ux = nvx[i], uy = nvy[i];
      const s = Math.hypot(ux, uy);
      if (s > maxSpeed) { ux *= maxSpeed / s; uy *= maxSpeed / s; }
      else if (s < this.minSpeed) {
        if (s < 1e-6) { const a = Math.random() * 6.283; ux = Math.cos(a); uy = Math.sin(a); }
        else { ux *= this.minSpeed / s; uy *= this.minSpeed / s; }
      }
      vx[i] = ux; vy[i] = uy;
      x[i] = (x[i] + ux + size) % size; y[i] = (y[i] + uy + size) % size;
      this.tx[i * TR + t] = x[i]; this.ty[i * TR + t] = y[i];
    }
  }
}

// Vicsek et al. (1995): constant speed, each particle adopts the average heading of
// everything within radius 1 (itself included), plus a random kick in [-eta/2, eta/2].
export class Vicsek {
  constructor(n = 400, size = 20, speed = 0.15) {
    this.n = n; this.size = size; this.speed = speed; this.eta = 0.5;
    this.x = new Float32Array(n); this.y = new Float32Array(n);
    this.th = new Float32Array(n); this.nth = new Float32Array(n);
    this.grid = new Grid(size, 1);
    this.span = new Int32Array(this.grid.cols); this.spanY = new Int32Array(this.grid.cols);
    this.scatter();
  }

  scatter() {
    for (let i = 0; i < this.n; i++) {
      this.x[i] = Math.random() * this.size; this.y[i] = Math.random() * this.size;
      this.th[i] = Math.random() * Math.PI * 2;
    }
  }

  order() {
    let sx = 0, sy = 0;
    for (let i = 0; i < this.n; i++) { sx += Math.cos(this.th[i]); sy += Math.sin(this.th[i]); }
    return Math.hypot(sx, sy) / this.n;
  }

  step() {
    const { n, x, y, th, nth, size, grid, span, spanY, speed, eta } = this;
    grid.build(x, y, n);
    const { head, next, cols } = grid;
    for (let i = 0; i < n; i++) {
      const xi = x[i], yi = y[i];
      const nx = grid.around(grid.cellOf(xi), 1, span), ny = grid.around(grid.cellOf(yi), 1, spanY);
      let sx = 0, sy = 0;
      for (let a = 0; a < ny; a++) {
        const row = spanY[a] * cols;
        for (let b = 0; b < nx; b++) {
          for (let j = head[row + span[b]]; j !== -1; j = next[j]) {
            const dx = wrapD(x[j] - xi, size), dy = wrapD(y[j] - yi, size);
            if (dx * dx + dy * dy <= 1) { sx += Math.cos(th[j]); sy += Math.sin(th[j]); }
          }
        }
      }
      nth[i] = Math.atan2(sy, sx) + eta * (Math.random() - 0.5);
    }
    for (let i = 0; i < n; i++) {
      th[i] = nth[i];
      x[i] = (x[i] + Math.cos(th[i]) * speed + size) % size;
      y[i] = (y[i] + Math.sin(th[i]) * speed + size) % size;
    }
  }
}
