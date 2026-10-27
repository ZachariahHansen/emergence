// Small accessibility helpers shared by the chapters: reduced motion, pausing when a figure is
// off screen or the tab is hidden, a polite live region, slider value text, and a keyboard cursor
// for canvases you can paint or pour on.

export const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

// Call `fn(shown)` whenever `el` scrolls in or out of view or the tab is hidden or shown.
export function onShown(el, fn) {
  let inView = false, last = null;
  const update = () => {
    const shown = inView && document.visibilityState === "visible";
    if (shown !== last) { last = shown; fn(shown); }
  };
  new IntersectionObserver(([e]) => { inView = e.isIntersecting; update(); }).observe(el);
  document.addEventListener("visibilitychange", update);
}

// Run `tick` every animation frame, but only while `el` is on screen and the tab is visible.
// No frames are requested at all otherwise. `onChange(shown)` is called on every change.
export function animate(el, tick, onChange) {
  let raf = 0, shown = false;
  const run = () => { raf = 0; if (!shown) return; tick(); raf = requestAnimationFrame(run); };
  onShown(el, (s) => {
    shown = s;
    if (onChange) onChange(s);
    if (shown && !raf) raf = requestAnimationFrame(run);
    else if (!shown && raf) { cancelAnimationFrame(raf); raf = 0; }
  });
}

// One visually hidden polite live region per page, for short summaries of user actions.
let region = null, timer = 0;
export function announce(msg) {
  if (!region) {
    region = document.createElement("div");
    region.className = "visually-hidden";
    region.setAttribute("aria-live", "polite");
    region.setAttribute("role", "status");
    document.body.appendChild(region);
  }
  clearTimeout(timer);
  // Clear first so repeating the same message is still read out.
  region.textContent = "";
  timer = setTimeout(() => { region.textContent = msg; }, 60);
}

// Keep a range input's aria-valuetext in step with a human-readable value.
export function valueText(input, fn) {
  const set = () => input.setAttribute("aria-valuetext", fn(input.value));
  input.addEventListener("input", set);
  set();
  return set;
}

// Make a canvas focusable and drivable from the keyboard. Arrow keys move a visible cursor
// (Shift moves it further), Enter or Space presses at the cursor, and releasing the key releases.
// Positions are fractions of the canvas, 0..1 from the top left.
//   onMove(x, y, held)  cursor moved
//   onPress(x, y)       Enter/Space went down (key repeats are ignored)
//   onRelease(x, y)     Enter/Space came up, or focus left while held
//   onFocus(x, y) / onBlur()
export function keyCursor(canvas, { step = 1 / 32, onMove, onPress, onRelease, onFocus, onBlur } = {}) {
  let x = 0.5, y = 0.5, held = false;
  canvas.tabIndex = 0;
  const host = canvas.parentElement;
  if (getComputedStyle(host).position === "static") host.style.position = "relative";
  const mark = document.createElement("span");
  mark.className = "kbd-cursor";
  mark.setAttribute("aria-hidden", "true");
  mark.hidden = true;
  host.appendChild(mark);

  const place = () => {
    mark.style.left = canvas.offsetLeft + x * canvas.offsetWidth + "px";
    mark.style.top = canvas.offsetTop + y * canvas.offsetHeight + "px";
  };
  const release = () => { if (held) { held = false; onRelease && onRelease(x, y); } };

  canvas.addEventListener("focus", () => {
    // Show the cursor for keyboard focus only, not after a mouse click.
    mark.hidden = !canvas.matches(":focus-visible");
    place();
    onFocus && onFocus(x, y);
  });
  canvas.addEventListener("blur", () => { mark.hidden = true; release(); onBlur && onBlur(); });
  canvas.addEventListener("pointerdown", () => { mark.hidden = true; });
  addEventListener("resize", place);

  const moves = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
  canvas.addEventListener("keydown", (e) => {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    const m = moves[e.key];
    if (m) {
      e.preventDefault();
      const s = step * (e.shiftKey ? 4 : 1);
      x = Math.min(1 - 1e-6, Math.max(0, x + m[0] * s));
      y = Math.min(1 - 1e-6, Math.max(0, y + m[1] * s));
      mark.hidden = false;
      place();
      onMove && onMove(x, y, held);
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      mark.hidden = false;
      if (e.repeat || held) return;
      held = true;
      onPress && onPress(x, y);
    }
  });
  canvas.addEventListener("keyup", (e) => {
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); release(); }
  });
  return { get x() { return x; }, get y() { return y; } };
}
