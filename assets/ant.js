// Langton's ant and its multi-colour generalisations (turmites).
// A rule string gives one turn per colour: "RL" is Langton's ant. On a square of colour c the ant
// turns by rule[c] (R = right, L = left, N = no turn, U = u-turn), advances that square to colour
// c + 1 (wrapping to 0), and steps forward one square. The grid is finite and the ant stops
// cleanly if its next step would take it off the edge. No DOM here, so it also runs under node.

export const DX = [0, 1, 0, -1];
export const DY = [-1, 0, 1, 0]; // directions: 0 up, 1 right, 2 down, 3 left

const TURN = { R: 1, L: 3, U: 2, N: 0 };

export function parseRule(s) {
  const r = String(s).toUpperCase().replace(/[^RLUN]/g, "");
  return r.length >= 2 ? r : null;
}

export class Ant {
  constructor(n, rule = "RL", { period = 104 } = {}) {
    this.n = n;
    this.cells = new Uint8Array(n * n);
    this.dirty = new Int32Array(1 << 16); // squares changed since the last render
    this.nDirty = 0;
    this.dirtyAll = true;
    this.period = period; // the highway period to watch for (0 = don't watch)
    this.hx = new Int32Array(period || 1);
    this.hy = new Int32Array(period || 1);
    this.hd = new Uint8Array(period || 1);
    this.setRule(rule);
    this.reset();
  }

  setRule(rule) {
    this.rule = rule;
    this.k = rule.length;
    this.turn = Uint8Array.from(rule, (c) => TURN[c]);
  }

  reset(x = this.n >> 1, y = this.n >> 1, dir = 0) {
    this.x = x; this.y = y; this.dir = dir;
    this.steps = 0;
    this.halted = false;
    this.run = 0;            // consecutive steps that repeat the step `period` earlier, shifted
    this.ddx = 0; this.ddy = 0;
    this.highwayFrom = -1;   // step at which the current highway began, or -1
    this.firstHighway = -1;  // first highway seen in this run
    this.dirtyAll = true;
  }

  clear() {
    this.cells.fill(0);
    this.reset();
  }

  // Set square i to colour c from outside the walk (painting), marking it for redraw.
  set(i, c) {
    if (this.cells[i] === c) return;
    this.cells[i] = c;
    if (this.nDirty < this.dirty.length) this.dirty[this.nDirty++] = i; else this.dirtyAll = true;
  }

  // Advance up to `count` steps. Returns the number actually taken.
  step(count) {
    if (this.halted) return 0;
    const { n, cells, turn, k, dirty, period, hx, hy, hd } = this;
    let { x, y, dir, nDirty, run, ddx, ddy } = this;
    let taken = 0;
    for (; taken < count; taken++) {
      if (period) {
        // Ring buffer of the last `period` positions. A highway shows up as the ant repeating
        // what it did `period` steps ago, in the same direction, shifted by a fixed amount.
        const slot = this.steps % period;
        if (this.steps >= period) {
          const dx = x - hx[slot], dy = y - hy[slot];
          if (hd[slot] === dir && (dx || dy) && (run === 0 || (dx === ddx && dy === ddy))) {
            if (run === 0) { ddx = dx; ddy = dy; }
            run++;
            if (run === period * 4 && this.highwayFrom < 0) {
              this.highwayFrom = this.steps - run - period + 1;
              if (this.firstHighway < 0) this.firstHighway = this.highwayFrom;
            }
          } else {
            run = 0;
            this.highwayFrom = -1;
          }
        }
        hx[slot] = x; hy[slot] = y; hd[slot] = dir;
      }
      const i = y * n + x;
      const c = cells[i];
      dir = (dir + turn[c]) & 3;
      cells[i] = c + 1 === k ? 0 : c + 1;
      if (nDirty < dirty.length) dirty[nDirty++] = i; else this.dirtyAll = true;
      this.steps++;
      const nx = x + DX[dir], ny = y + DY[dir];
      if (nx < 0 || ny < 0 || nx >= n || ny >= n) { this.halted = true; taken++; break; }
      x = nx; y = ny;
    }
    this.x = x; this.y = y; this.dir = dir;
    this.nDirty = nDirty; this.run = run; this.ddx = ddx; this.ddy = ddy;
    return taken;
  }
}
