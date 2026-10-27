// Gray–Scott reaction–diffusion (Pearson 1993). Two chemicals, U and V, on a grid:
//   U + 2V -> 3V      (V makes more of itself by eating U)
//   U is fed in at rate F; V is removed at rate F + k.
// Runs on the GPU (WebGL2, float textures, ping-pong framebuffers) when it can,
// and falls back to a smaller CPU grid when it can't.
//
// The textures store (1 - u, v) rather than (u, v). Both are near zero most of the
// time, which keeps precision on devices that only render to half floats.

import { readPalette, onPaletteChange, mix } from "./palette.js";

const DU = 1.0, DV = 0.5; // diffusion per step on the 3×3 kernel below; DU / DV = 2

// Where a point of the parameter map sits: k grows left to right, F grows bottom to top.
// x, y are 0..1 from the top-left corner.
export function mapParams(map, x, y) {
  return { F: map.f1 + (map.f0 - map.f1) * y, k: map.k0 + (map.k1 - map.k0) * x };
}

let support; // cached result of the WebGL probe
function gpuFormat() {
  if (support !== undefined) return support;
  support = null;
  try {
    const gl = document.createElement("canvas").getContext("webgl2");
    if (!gl) return support;
    let fmt = null;
    if (gl.getExtension("EXT_color_buffer_float")) fmt = gl.RGBA32F;
    else if (gl.getExtension("EXT_color_buffer_half_float")) fmt = gl.RGBA16F;
    if (fmt && renderable(gl, fmt)) support = fmt;
    gl.getExtension("WEBGL_lose_context")?.loseContext();
  } catch { support = null; }
  return support;
}

function renderable(gl, fmt) {
  const t = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, t);
  gl.texImage2D(gl.TEXTURE_2D, 0, fmt, 4, 4, 0, gl.RGBA, gl.FLOAT, null);
  const fb = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
  const ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
  gl.deleteFramebuffer(fb); gl.deleteTexture(t);
  return ok;
}

// Seed: a few squares of V (with a little noise) in a sea of pure U.
function seedData(n, { count = 8, size = 0.04, rand = Math.random } = {}) {
  const d = new Float32Array(n * n * 4);
  const r = Math.max(2, Math.round(size * n / 2));
  for (let b = 0; b < count; b++) {
    const cx = (rand() * n) | 0, cy = (rand() * n) | 0;
    for (let y = cy - r; y < cy + r; y++) {
      for (let x = cx - r; x < cx + r; x++) {
        if (x < 0 || y < 0 || x >= n || y >= n) continue;
        const p = (y * n + x) * 4;
        d[p] = 0.5; d[p + 1] = 0.25 + 0.05 * rand();
      }
    }
  }
  return d;
}

// opts: n (GPU grid), cpuN (fallback grid), map ({f0, f1, k0, k1} makes F and k vary
// across the grid, with walls instead of wrap-around), diff (diffusion scale).
export function createGrayScott(canvas, { n = 256, cpuN = 128, map = null, diff = 1 } = {}) {
  const fmt = gpuFormat();
  let sim = fmt ? gpuSim(canvas, n, fmt, map, diff) : null;
  if (!sim) {
    // A canvas that has handed out a WebGL context can't give a 2D one, so swap in a fresh copy.
    if (fmt) { const fresh = canvas.cloneNode(); canvas.replaceWith(fresh); canvas = fresh; }
    sim = cpuSim(canvas, cpuN, map, diff);
  }
  sim.canvas = canvas;
  return sim;
}

/* ---------------- GPU ---------------- */

const VERT = `#version 300 es
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

const STEP = `#version 300 es
precision highp float;
precision highp int;
uniform highp sampler2D S;
uniform vec2 fk;
uniform vec4 range;   // map: F at top, F at bottom, k at left, k at right
uniform int mapMode;
uniform vec2 diff;
uniform vec3 brush;   // x, y in cells from top-left, radius (0 = off)
uniform float seed;
out vec4 o;

ivec2 N;
vec2 at(ivec2 c) {
  c = mapMode == 1 ? clamp(c, ivec2(0), N - 1) : (c + N) % N;
  return texelFetch(S, c, 0).rg;
}
float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233)) + seed) * 43758.5453); }

void main() {
  N = textureSize(S, 0);
  ivec2 c = ivec2(gl_FragCoord.xy);
  vec2 s = at(c);
  vec2 L = 0.2 * (at(c + ivec2(1, 0)) + at(c - ivec2(1, 0)) + at(c + ivec2(0, 1)) + at(c - ivec2(0, 1)))
         + 0.05 * (at(c + ivec2(1, 1)) + at(c - ivec2(1, 1)) + at(c + ivec2(1, -1)) + at(c - ivec2(1, -1)))
         - s;
  float F = fk.x, K = fk.y;
  if (mapMode == 1) {
    vec2 t = (vec2(c) + 0.5) / vec2(N);
    F = mix(range.x, range.y, t.y);
    K = mix(range.z, range.w, t.x);
  }
  float u = 1.0 - s.x, v = s.y;
  float r = u * v * v;
  float du = diff.x * -L.x - r + F * (1.0 - u);
  float dv = diff.y * L.y + r - (F + K) * v;
  u = clamp(u + du, 0.0, 1.0);
  v = clamp(v + dv, 0.0, 1.0);
  if (brush.z > 0.0) {
    vec2 d = vec2(c) + 0.5 - brush.xy;
    if (mapMode == 0) d -= vec2(N) * round(d / vec2(N));
    if (dot(d, d) < brush.z * brush.z) { u = 0.5; v = 0.25 + 0.05 * hash(vec2(c)); }
  }
  o = vec4(1.0 - u, v, dv, 1.0);
}`;

const SHOW = `#version 300 es
precision highp float;
precision highp int;
uniform highp sampler2D S;
uniform vec2 view;
uniform int mapMode;
uniform vec3 c0, c1, c2, c3, glow;
out vec4 o;

ivec2 N;
vec3 at(ivec2 c) {
  c = mapMode == 1 ? clamp(c, ivec2(0), N - 1) : (c + N) % N;
  return texelFetch(S, c, 0).rgb;
}

void main() {
  N = textureSize(S, 0);
  vec2 p = vec2(gl_FragCoord.x, view.y - gl_FragCoord.y) / view * vec2(N) - 0.5;
  ivec2 i = ivec2(floor(p));
  vec2 f = fract(p);
  vec3 s = mix(mix(at(i), at(i + ivec2(1, 0)), f.x), mix(at(i + ivec2(0, 1)), at(i + ivec2(1, 1)), f.x), f.y);
  float t = clamp(s.g / 0.4, 0.0, 1.0) * 3.0;
  vec3 col = t < 1.0 ? mix(c0, c1, t) : t < 2.0 ? mix(c1, c2, t - 1.0) : mix(c2, c3, t - 2.0);
  col = mix(col, glow, 0.75 * smoothstep(2e-4, 2e-3, s.b));
  o = vec4(col, 1.0);
}`;

function gpuSim(canvas, n, fmt, map, diff) {
  const gl = canvas.getContext("webgl2", { antialias: false, depth: false, stencil: false, alpha: false });
  if (!gl) return null;

  let pal = readPalette();
  onPaletteChange(() => { pal = readPalette(); });

  const enable = () => gl.getExtension(fmt === gl.RGBA32F ? "EXT_color_buffer_float" : "EXT_color_buffer_half_float");
  enable();

  let step, show, tex, fbs, src = 0, lost = false;
  let brush = null, pending = null;

  function compile(fs) {
    const p = gl.createProgram();
    for (const [type, code] of [[gl.VERTEX_SHADER, VERT], [gl.FRAGMENT_SHADER, fs]]) {
      const s = gl.createShader(type);
      gl.shaderSource(s, code);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS) && !gl.isContextLost()) {
        throw new Error(gl.getShaderInfoLog(s));
      }
      gl.attachShader(p, s);
    }
    gl.linkProgram(p);
    // Uniform locations, looked up on first use (null if the compiler dropped one).
    const cache = {};
    const loc = new Proxy(cache, {
      get: (c, name) => (name in c ? c[name] : (c[name] = gl.getUniformLocation(p, name))),
    });
    return { p, loc };
  }

  function init(data) {
    step = compile(STEP);
    show = compile(SHOW);
    tex = []; fbs = [];
    for (let i = 0; i < 2; i++) {
      const t = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texImage2D(gl.TEXTURE_2D, 0, fmt, n, n, 0, gl.RGBA, gl.FLOAT, data);
      const fb = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
      tex.push(t); fbs.push(fb);
    }
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error("float framebuffer incomplete");
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    src = 0;
  }

  try { init(seedData(n)); } catch { return null; }

  const api = {
    kind: "webgl", n, F: 0.0367, k: 0.0649, steps: 0, onrestore: null,
    get lost() { return lost; },

    seed(opts) {
      api.steps = 0;
      if (lost) { pending = opts || {}; return; }
      const d = opts === "clear" ? new Float32Array(n * n * 4) : seedData(n, opts);
      for (const t of tex) {
        gl.bindTexture(gl.TEXTURE_2D, t);
        gl.texImage2D(gl.TEXTURE_2D, 0, fmt, n, n, 0, gl.RGBA, gl.FLOAT, d);
      }
    },

    // x, y: 0..1 from top-left; r: radius as a fraction of the width. null turns it off.
    brush(x, y, r = 0.02) { brush = x == null ? null : [x * n, y * n, Math.max(1.5, r * n)]; },

    step(count) {
      if (lost) return;
      const { p, loc } = step;
      gl.useProgram(p);
      gl.viewport(0, 0, n, n);
      gl.uniform2f(loc.fk, api.F, api.k);
      gl.uniform2f(loc.diff, DU * diff, DV * diff);
      gl.uniform1i(loc.mapMode, map ? 1 : 0);
      if (map) gl.uniform4f(loc.range, map.f1, map.f0, map.k0, map.k1);
      gl.uniform3f(loc.brush, ...(brush || [0, 0, 0]));
      gl.uniform1f(loc.seed, Math.random() * 100);
      gl.activeTexture(gl.TEXTURE0);
      gl.uniform1i(loc.S, 0);
      for (let i = 0; i < count; i++) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, fbs[1 - src]);
        gl.bindTexture(gl.TEXTURE_2D, tex[src]);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        src = 1 - src;
      }
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      api.steps += count;
    },

    draw() {
      if (lost) return;
      const dpr = window.devicePixelRatio || 1;
      const w = Math.max(1, Math.min(n * 3, Math.round(canvas.clientWidth * dpr)));
      if (canvas.width !== w) { canvas.width = w; canvas.height = w; }
      const { p, loc } = show;
      gl.useProgram(p);
      gl.viewport(0, 0, w, w);
      gl.uniform2f(loc.view, w, w);
      gl.uniform1i(loc.mapMode, map ? 1 : 0);
      for (const name of ["c0", "c1", "c2", "c3", "glow"]) {
        const c = pal[{ c0: "h0", c1: "h1", c2: "h2", c3: "h3", glow: "glow" }[name]];
        gl.uniform3f(loc[name], c[0] / 255, c[1] / 255, c[2] / 255);
      }
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, tex[src]);
      gl.uniform1i(loc.S, 0);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    },
  };

  canvas.addEventListener("webglcontextlost", (e) => { e.preventDefault(); lost = true; });
  canvas.addEventListener("webglcontextrestored", () => {
    lost = false;
    try {
      enable();
      init(seedData(n, pending || {}));
      pending = null;
      api.steps = 0;
      api.onrestore?.();
    } catch { lost = true; }
  });

  return api;
}

/* ---------------- CPU fallback ---------------- */

function cpuSim(canvas, n, map, diff) {
  canvas.width = n; canvas.height = n;
  const ctx = canvas.getContext("2d");
  const img = ctx.createImageData(n, n);
  let u = new Float32Array(n * n), v = new Float32Array(n * n);
  let u2 = new Float32Array(n * n), v2 = new Float32Array(n * n);
  const dv = new Float32Array(n * n);
  let brush = null;

  // Colour lookup over v in 0..0.4, rebuilt when the theme changes.
  const LUT = 256;
  let lut, glow;
  function palette() {
    const pal = readPalette();
    const stops = [pal.h0, pal.h1, pal.h2, pal.h3];
    lut = new Uint8ClampedArray(LUT * 3);
    for (let i = 0; i < LUT; i++) {
      const t = (i / (LUT - 1)) * 3, s = Math.min(2, Math.floor(t));
      const c = mix(stops[s], stops[s + 1], t - s);
      lut.set(c, i * 3);
    }
    glow = pal.glow;
  }
  palette();
  onPaletteChange(palette);

  const api = {
    kind: "cpu", n, F: 0.0367, k: 0.0649, steps: 0, lost: false, onrestore: null,

    seed(opts) {
      api.steps = 0;
      u.fill(1); v.fill(0); dv.fill(0);
      if (opts === "clear") return;
      const d = seedData(n, opts);
      for (let i = 0; i < n * n; i++) { u[i] = 1 - d[i * 4]; v[i] = d[i * 4 + 1]; }
    },

    brush(x, y, r = 0.02) { brush = x == null ? null : [x * n, y * n, Math.max(1.5, r * n)]; },

    step(count) {
      const Du = DU * diff, Dv = DV * diff;
      const wrap = !map;
      for (let s = 0; s < count; s++) {
        for (let y = 0; y < n; y++) {
          const ym = wrap ? (y - 1 + n) % n : Math.max(0, y - 1);
          const yp = wrap ? (y + 1) % n : Math.min(n - 1, y + 1);
          const rc = y * n, rm = ym * n, rp = yp * n;
          const F = map ? map.f1 + (map.f0 - map.f1) * ((y + 0.5) / n) : api.F;
          for (let x = 0; x < n; x++) {
            const xm = wrap ? (x - 1 + n) % n : Math.max(0, x - 1);
            const xp = wrap ? (x + 1) % n : Math.min(n - 1, x + 1);
            const i = rc + x;
            const K = map ? map.k0 + (map.k1 - map.k0) * ((x + 0.5) / n) : api.k;
            const ui = u[i], vi = v[i];
            const lu = 0.2 * (u[rc + xm] + u[rc + xp] + u[rm + x] + u[rp + x])
                     + 0.05 * (u[rm + xm] + u[rm + xp] + u[rp + xm] + u[rp + xp]) - ui;
            const lv = 0.2 * (v[rc + xm] + v[rc + xp] + v[rm + x] + v[rp + x])
                     + 0.05 * (v[rm + xm] + v[rm + xp] + v[rp + xm] + v[rp + xp]) - vi;
            const r = ui * vi * vi;
            const d = Dv * lv + r - (F + K) * vi;
            u2[i] = Math.min(1, Math.max(0, ui + Du * lu - r + F * (1 - ui)));
            v2[i] = Math.min(1, Math.max(0, vi + d));
            dv[i] = d;
          }
        }
        [u, u2] = [u2, u]; [v, v2] = [v2, v];
        if (brush) stamp();
      }
      api.steps += count;
    },

    draw() {
      const d = img.data;
      for (let i = 0, p = 0; i < n * n; i++, p += 4) {
        const t = Math.min(LUT - 1, Math.max(0, (v[i] / 0.4) * (LUT - 1))) | 0;
        let r = lut[t * 3], g = lut[t * 3 + 1], b = lut[t * 3 + 2];
        const e = dv[i];
        if (e > 2e-4) {
          const x = Math.min(1, (e - 2e-4) / 1.8e-3), m = 0.75 * x * x * (3 - 2 * x);
          r += (glow[0] - r) * m; g += (glow[1] - g) * m; b += (glow[2] - b) * m;
        }
        d[p] = r; d[p + 1] = g; d[p + 2] = b; d[p + 3] = 255;
      }
      ctx.putImageData(img, 0, 0);
    },
  };

  function stamp() {
    const [bx, by, br] = brush;
    for (let y = Math.floor(by - br); y <= by + br; y++) {
      for (let x = Math.floor(bx - br); x <= bx + br; x++) {
        const dx = x + 0.5 - bx, dy = y + 0.5 - by;
        if (dx * dx + dy * dy >= br * br) continue;
        let xx = x, yy = y;
        if (map) { if (x < 0 || y < 0 || x >= n || y >= n) continue; }
        else { xx = (x + n) % n; yy = (y + n) % n; }
        const i = yy * n + xx;
        u[i] = 0.5; v[i] = 0.25 + 0.05 * Math.random();
      }
    }
  }

  api.seed();
  return api;
}
