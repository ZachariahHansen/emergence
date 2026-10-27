// Read colour tokens from CSS so simulations follow the page's light/dark theme.

const probe = document.createElement("canvas").getContext("2d", { willReadFrequently: true });

export function toRGB(color) {
  probe.clearRect(0, 0, 1, 1);
  probe.fillStyle = "#000";
  probe.fillStyle = color;
  probe.fillRect(0, 0, 1, 1);
  const d = probe.getImageData(0, 0, 1, 1).data;
  return [d[0], d[1], d[2]];
}

export function token(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

export function readPalette() {
  const names = ["h0", "h1", "h2", "h3", "glow", "ink", "muted", "rule", "accent", "bg", "surface"];
  const out = {};
  for (const k of names) out[k] = toRGB(token("--" + k));
  return out;
}

export function onPaletteChange(fn) {
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", fn);
}

export function mix(a, b, t) {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

export const css = (rgb) => `rgb(${rgb[0] | 0},${rgb[1] | 0},${rgb[2] | 0})`;
