import { fx } from "./engine";
import { play } from "../lib/sound";

/*
 * The cursor is the sun. Elements marked:
 *   data-light     → catch rim light near the cursor and cast shadows away from it
 *   data-tilt      → tilt in 3D toward the cursor, with a moving glare
 *   data-magnetic  → lean gently toward the cursor
 */

let started = false;
let px = -9999;
let py = -9999;
let target: Element | null = null;
let raf = 0;
let magnet: HTMLElement | null = null;
let tilted: HTMLElement | null = null;

let lit = true;

/** What the cursor's light gives each lit element (each registered in styles/fx.css as not inherited). */
const LIGHT_VARS = ["--lx", "--ly", "--near", "--sx", "--sy"];
/** What each lit element has been given already, so an unchanged value isn't written again. */
let given = new WeakMap<HTMLElement, string[]>();

function apply() {
  raf = 0;
  if (!fx.active) return;
  const lights = document.querySelectorAll<HTMLElement>("[data-light]");
  // With the cursor's light turned off, things stay as they are: no rim light, no moving shadows.
  if (!fx.cursorLight) {
    if (lit) {
      lit = false;
      given = new WeakMap();
      lights.forEach((el) => {
        for (const v of LIGHT_VARS) el.style.removeProperty(v);
      });
    }
  } else lit = true;

  // Everything is measured before anything is written: a measurement taken after a write makes
  // the browser work out the page's styles all over again first — once per element, every move.
  const vh = innerHeight;
  const rects = lit ? Array.from(lights, (el) => el.getBoundingClientRect()) : [];
  const mag = (target?.closest?.("[data-magnetic]") as HTMLElement | null) ?? null;
  const magRect = mag?.getBoundingClientRect();
  const tilt = fx.full ? ((target?.closest?.("[data-tilt]") as HTMLElement | null) ?? null) : null;
  const tiltRect = tilt?.getBoundingClientRect();

  rects.forEach((r, i) => {
    if (!r.width || r.bottom < 0 || r.top > vh) return;
    const dx = Math.max(r.left - px, 0, px - r.right);
    const dy = Math.max(r.top - py, 0, py - r.bottom);
    const vx = r.left + r.width / 2 - px;
    const vy = r.top + r.height / 2 - py;
    const d = Math.hypot(vx, vy) || 1;
    const reach = Math.min(1, 520 / d);
    give(lights[i], [
      `${(px - r.left).toFixed(1)}px`,
      `${(py - r.top).toFixed(1)}px`,
      Math.exp(-Math.hypot(dx, dy) / 170).toFixed(3),
      ((vx / d) * reach).toFixed(3),
      ((vy / d) * reach).toFixed(3),
    ]);
  });

  if (magnet && magnet !== mag) magnet.style.translate = "";
  if (mag && magRect) {
    const dx = px - (magRect.left + magRect.width / 2);
    const dy = py - (magRect.top + magRect.height / 2);
    mag.style.translate = `${(dx * 0.2).toFixed(1)}px ${(dy * 0.26).toFixed(1)}px`;
  }
  magnet = mag;

  if (tilted && tilted !== tilt) {
    tilted.style.transform = "";
    tilted.style.removeProperty("--gx");
    tilted.style.removeProperty("--gy");
  }
  if (tilt && tiltRect) {
    const nx = (px - tiltRect.left) / tiltRect.width - 0.5;
    const ny = (py - tiltRect.top) / tiltRect.height - 0.5;
    tilt.style.transform = `perspective(720px) rotateX(${(-ny * 10).toFixed(2)}deg) rotateY(${(nx * 12).toFixed(2)}deg) translateZ(4px)`;
    tilt.style.setProperty("--gx", `${((nx + 0.5) * 100).toFixed(1)}%`);
    tilt.style.setProperty("--gy", `${((ny + 0.5) * 100).toFixed(1)}%`);
  }
  tilted = tilt;
}

/** Gives a lit element its light: only what's changed since last time. */
function give(el: HTMLElement, values: string[]) {
  const had = given.get(el);
  for (let i = 0; i < LIGHT_VARS.length; i++) if (had?.[i] !== values[i]) el.style.setProperty(LIGHT_VARS[i], values[i]);
  given.set(el, values);
}

/** Re-applies the cursor light (after it's been turned on or off). */
export function refreshPointerLight() {
  if (!raf) raf = requestAnimationFrame(apply);
}

export function startPointerLight() {
  if (started) return;
  started = true;
  addEventListener(
    "pointermove",
    (e) => {
      if (e.pointerType !== "mouse") return;
      px = e.clientX;
      py = e.clientY;
      target = e.target as Element;
      if (!raf) raf = requestAnimationFrame(apply);
    },
    { passive: true },
  );
  document.addEventListener("pointerleave", () => {
    target = null;
    px = py = -9999;
    if (!raf) raf = requestAnimationFrame(apply);
  });
}

// ── clones: show the old thing leaving while the app has already moved on ──

function ghostOf(el: HTMLElement) {
  const clone = el.cloneNode(true) as HTMLElement;
  const from = el.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>("input, textarea");
  const to = clone.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>("input, textarea");
  from.forEach((input, i) => {
    if (to[i]) to[i].value = input.value;
  });
  clone.removeAttribute("id");
  return clone;
}

/** Dissolves an element into rising embers of light, sweeping left to right. */
export function dissolve(el: HTMLElement | null) {
  if (!el || !fx.active) return;
  const r = el.getBoundingClientRect();
  if (!r.width || !r.height) return;
  const holder = document.createElement("div");
  holder.className = `fx-ghost fx-dissolve is-${fx.scene}`;
  const o = fx.origin;
  Object.assign(holder.style, { left: `${r.left - o.x}px`, top: `${r.top - o.y}px`, width: `${r.width}px`, height: `${r.height}px` });
  const clone = ghostOf(el);
  Object.assign(clone.style, { margin: "0", width: "100%", height: "100%", transform: "none", translate: "none" });
  holder.appendChild(clone);
  document.body.appendChild(holder);
  el.style.visibility = "hidden";
  // The burning edge and the embers share one clock, so they stay in step.
  const dur = 820;
  const t0 = fx.now();
  fx.embers(r, { sweep: (dur / 1000) * 0.92, density: 0.42 });
  const step = () => {
    const k = Math.min(1, (fx.now() - t0) / dur);
    holder.style.setProperty("--sweep", `${(k * 118).toFixed(2)}%`);
    if (k < 1) requestAnimationFrame(step);
    else holder.remove();
  };
  requestAnimationFrame(step);
}

type Pt = { x: number; y: number };

/** Where a page sits, for things laid over it by hand (accounting for a keyboard-shifted layout). */
function overlayBox(el: HTMLElement, r: DOMRect) {
  const o = fx.origin;
  return { left: `${r.left - o.x}px`, top: `${r.top - o.y}px`, width: `${r.width}px`, height: `${r.height}px`, borderRadius: getComputedStyle(el).borderTopLeftRadius };
}

/** The old words, lifted off the page so the page itself can move on underneath. */
function lift(noteEl: HTMLElement, pr: DOMRect, cls: string) {
  const nr = noteEl.getBoundingClientRect();
  const page = document.createElement("div");
  page.className = cls;
  const clone = ghostOf(noteEl);
  Object.assign(clone.style, { position: "absolute", left: `${nr.left - pr.left}px`, top: `${nr.top - pr.top}px`, width: `${nr.width}px`, margin: "0" });
  page.appendChild(clone);
  return page;
}

function setMask(el: HTMLElement, mask: string | null) {
  if (mask) {
    el.style.setProperty("mask-image", mask);
    el.style.setProperty("-webkit-mask-image", mask);
  } else {
    el.style.removeProperty("mask-image");
    el.style.removeProperty("-webkit-mask-image");
  }
}

function setClip(el: HTMLElement, clip: string | null) {
  if (clip) {
    el.style.clipPath = clip;
    el.style.setProperty("-webkit-clip-path", clip);
  } else {
    el.style.removeProperty("clip-path");
    el.style.removeProperty("-webkit-clip-path");
  }
}

/** Something slipping out of sight (hidden away): it dims, blurs and folds into the dark. */
export function vanish(el: HTMLElement | null) {
  if (!el || !fx.active) return;
  const r = el.getBoundingClientRect();
  if (!r.width || !r.height) return;
  const holder = document.createElement("div");
  holder.className = "fx-ghost fx-vanish";
  const o = fx.origin;
  Object.assign(holder.style, { left: `${r.left - o.x}px`, top: `${r.top - o.y}px`, width: `${r.width}px`, height: `${r.height}px` });
  const clone = ghostOf(el);
  Object.assign(clone.style, { margin: "0", width: "100%", height: "100%", transform: "none", translate: "none" });
  holder.appendChild(clone);
  document.body.appendChild(holder);
  const done = () => holder.remove();
  holder
    .animate(
      [
        { opacity: 1, filter: "blur(0px) brightness(1)", transform: "scale(1)" },
        { opacity: 0.75, filter: "blur(0.6px) brightness(0.7)", transform: "scale(0.985)", offset: 0.35 },
        { opacity: 0, filter: "blur(7px) brightness(0.3)", transform: "scale(0.94, 0.3)" },
      ],
      { duration: fx.full ? 560 : 340, easing: "cubic-bezier(0.55, 0, 0.7, 0.2)" },
    )
    .finished.then(done, done);
  // A ring of light closes in on the spot as it goes dark.
  const cx = r.left + Math.min(26, r.width / 2);
  const cy = r.top + Math.min(r.height / 2, 18);
  fx.ring(cx, cy, 22, 3, { dur: 460, alpha: 0.7, width: 1.4 });
  fx.flash(cx, cy, 34, { dur: 380, alpha: 0.35 });
}

/**
 * Deleting a note: the edge of the moon sweeps across the page. Its burning rim eats the old
 * words as it passes, and the next page comes up out of the shadow just behind it. Nothing
 * else changes — the glass and the sky stay exactly as they were the whole time.
 */
export function eclipseWipe(noteEl: HTMLElement | null, panelEl: HTMLElement | null) {
  if (!noteEl || !panelEl || !fx.active) return;
  const pr = panelEl.getBoundingClientRect();
  if (!pr.width) return;
  const scroller = panelEl.querySelector<HTMLElement>(".canvas-scroll");
  const sr = scroller?.getBoundingClientRect();

  const stage = document.createElement("div");
  stage.className = "fx-ghost fx-wipe";
  Object.assign(stage.style, overlayBox(panelEl, pr));
  const page = lift(noteEl, pr, "fx-wipe-page");
  const moon = document.createElement("div");
  moon.className = "fx-moon";
  stage.append(page, moon);
  document.body.appendChild(stage);

  const W = pr.width;
  const H = pr.height;
  // A big moon: its rim crosses the page as a gentle curve.
  const R = Math.max(H * 0.8, W * 0.5);
  const G = 170; // how far its glow reaches beyond the rim
  const cy = H * 0.5;
  const startX = W + R - 6; // the rim is already on the page in the very first frame
  // Once the rim has cleared the page's top and bottom corners, the whole page has been swept.
  const endX = Math.sqrt(Math.max(0, R * R - (H / 2) * (H / 2))) - 14;
  const soft = 22;
  const dur = fx.full ? 950 : 620;
  const t0 = fx.now();
  // Only the leading edge exists: the rim, the light ahead of it and the shadow behind it.
  // (Its far side is never on the page.)
  const D = (R + G) * 2;
  Object.assign(moon.style, {
    width: `${D}px`,
    height: `${D}px`,
    background: `radial-gradient(circle ${R + G}px at 50% 50%,
      transparent ${R - 210}px,
      rgb(2 2 5 / 0.36) ${R - 110}px,
      rgb(2 2 5 / 0.7) ${R - 18}px,
      color-mix(in oklch, var(--accent) 34%, rgb(2 2 5 / 0.6)) ${R - 4}px,
      color-mix(in oklch, var(--accent) 50%, white) ${R - 0.8}px,
      color-mix(in oklch, var(--accent) 50%, white) ${R + 0.6}px,
      color-mix(in oklch, var(--accent) 52%, transparent) ${R + 4}px,
      color-mix(in oklch, var(--accent) 20%, transparent) ${R + 40}px,
      color-mix(in oklch, var(--accent) 7%, transparent) ${R + 100}px,
      transparent ${R + G}px)`,
  });
  // The arc of the rim that's actually over the page.
  const reach = Math.asin(Math.min(1, H / 2 / R));
  // Where the next page is, relative to the panel (it sits below the top bar).
  const dx = sr ? pr.left - sr.left : 0;
  const dy = sr ? pr.top - sr.top : 0;
  play("eclipse");

  const place = (cx: number) => {
    // The old words: only where the moon hasn't reached yet.
    setMask(page, `radial-gradient(circle ${R}px at ${cx}px ${cy}px, transparent ${R - soft}px, #000 ${R}px), linear-gradient(90deg, #000 ${cx - soft}px, transparent ${cx}px)`);
    // The next page: only where it has.
    if (scroller)
      setMask(
        scroller,
        `radial-gradient(circle ${R}px at ${cx + dx}px ${cy + dy}px, #000 ${R - soft - 70}px, transparent ${R - 10}px), linear-gradient(90deg, transparent ${cx + dx}px, #000 ${cx + dx + soft}px)`,
      );
    moon.style.transform = `translate3d(${cx - R - G}px, ${cy - R - G}px, 0)`;
  };
  place(startX);

  const step = () => {
    const k = Math.min(1, (fx.now() - t0) / dur);
    const e = (1 - Math.cos(Math.PI * k)) / 2;
    const cx = startX + (endX - startX) * e;
    place(cx);
    if (k > 0.04 && k < 0.96) fx.rimDust(pr.left + cx, pr.top + cy, R, -1, Math.PI - reach, Math.PI + reach);
    if (k < 1) requestAnimationFrame(step);
    else {
      if (scroller) setMask(scroller, null);
      fx.flash(pr.left + 4, pr.top + cy, 140, { alpha: 0.3 });
      stage.remove();
    }
  };
  requestAnimationFrame(step);
}

/**
 * Deleting a note, on paper: the words let go of the page — their ink bleeds and softens and
 * sinks away into the water, a cloud or two of it opening out where they were — and the next
 * page is there underneath, clean.
 */
export function inkWash(noteEl: HTMLElement | null, panelEl: HTMLElement | null) {
  if (!noteEl || !panelEl || !fx.active) return;
  const pr = panelEl.getBoundingClientRect();
  if (!pr.width) return;
  const scroller = panelEl.querySelector<HTMLElement>(".canvas-scroll");
  const stage = document.createElement("div");
  stage.className = "fx-ghost fx-inkout";
  Object.assign(stage.style, overlayBox(panelEl, pr));
  const page = lift(noteEl, pr, "fx-inkout-page");
  stage.append(page);
  document.body.appendChild(stage);
  play("eclipse");
  const dur = fx.full ? 950 : 600;
  const done = () => stage.remove();
  page
    .animate(
      [
        { opacity: 1, filter: "blur(0px) contrast(1)", transform: "none" },
        { opacity: 0.9, filter: "blur(1.2px) contrast(1.15)", transform: "translateY(3px)", offset: 0.25 },
        { opacity: 0, filter: "blur(11px) contrast(0.6)", transform: "translateY(16px) scale(1.012)" },
      ],
      { duration: dur, easing: "cubic-bezier(0.45, 0, 0.6, 1)" },
    )
    .finished.then(done, done);
  // the next page comes up clean beneath it
  scroller?.animate([{ opacity: 0 }, { opacity: 1 }], { duration: dur * 0.75, delay: dur * 0.3, easing: "cubic-bezier(0.25, 0.6, 0.3, 1)", fill: "backwards" });
  // where the words were, their ink lets go into the water
  const nr = noteEl.getBoundingClientRect();
  const top = Math.max(pr.top + 60, nr.top + 40);
  const bottom = Math.min(pr.bottom - 60, nr.bottom - 40, top + pr.height * 0.6);
  for (let i = 0; i < 2; i++) {
    const x = pr.left + pr.width * (0.3 + 0.4 * Math.random());
    const y = top + (bottom - top) * (0.2 + 0.6 * Math.random());
    window.setTimeout(() => fx.inkBloom(x, y, { size: 0.04, amount: 1.2, push: 0.1, splash: i === 0 }), i * 180);
  }
  fx.inkLinger(1200);
}

/**
 * Deleting a note, in the rain: water sheets down the page from the top and washes the
 * words away with it — running ahead in drips, the last of it sliding and blurring as it
 * goes — and the next page is there behind it, rinsed clean.
 */
export function rainWash(noteEl: HTMLElement | null, panelEl: HTMLElement | null) {
  if (!noteEl || !panelEl || !fx.active) return;
  const pr = panelEl.getBoundingClientRect();
  if (!pr.width) return;
  const scroller = panelEl.querySelector<HTMLElement>(".canvas-scroll");
  const sr = scroller?.getBoundingClientRect();

  const stage = document.createElement("div");
  stage.className = "fx-ghost fx-wash";
  Object.assign(stage.style, overlayBox(panelEl, pr));
  const page = lift(noteEl, pr, "fx-wash-page");
  const W = pr.width;
  const H = pr.height;
  // The leading edge of the water, catching the light.
  const svgNS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(svgNS, "svg");
  svg.setAttribute("class", "fx-wash-edge");
  svg.setAttribute("width", String(W));
  svg.setAttribute("height", String(H));
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  const glow = document.createElementNS(svgNS, "path");
  glow.setAttribute("class", "glow");
  const line = document.createElementNS(svgNS, "path");
  line.setAttribute("class", "line");
  svg.append(glow, line);
  stage.append(page, svg);
  document.body.appendChild(stage);

  // The water's leading edge: a gently wavering line, with drips running ahead of it — narrow
  // fingers with round heads, some racing far ahead, some barely started.
  const n = Math.max(5, Math.round(W / 105));
  const drips = Array.from({ length: n }, (_, i) => ({
    x: ((i + 0.5 + (Math.random() - 0.5) * 0.7) / n) * W,
    w: 6 + Math.random() * 9,
    lead: Math.random() < 0.55 ? 0.35 + Math.random() * 0.65 : 0.06 + Math.random() * 0.25,
  }));
  const ph1 = Math.random() * Math.PI * 2;
  const ph2 = Math.random() * Math.PI * 2;
  const dur = fx.full ? 1250 : 760;
  const t0 = fx.now();
  const dx = sr ? pr.left - sr.left : 0;
  const dy = sr ? pr.top - sr.top : 0;
  play("eclipse");
  let lastDrip = 0;

  const level = (e: number) => -H * 0.22 + H * 1.5 * e;
  const reachOf = (e: number) => H * 0.26 * Math.min(1, e * 2);
  const front = (k: number, e: number): Pt[] => {
    const y0 = level(e);
    const reach = reachOf(e);
    const pts: Pt[] = [];
    for (let x = 0; ; x = Math.min(W, x + 3)) {
      let y = y0 + Math.sin(x * 0.011 + ph1 + k * 3) * 5 + Math.sin(x * 0.027 + ph2 - k * 4) * 2.4;
      for (const d of drips) {
        const u = (x - d.x) / d.w;
        if (u > -1 && u < 1) y = Math.max(y, y0 + d.lead * reach * Math.sqrt(1 - u * u));
      }
      pts.push({ x, y });
      if (x >= W) break;
    }
    return pts;
  };
  const poly = (pts: Pt[], ox: number, oy: number) => pts.map((p) => `${(p.x + ox).toFixed(1)}px ${(p.y + oy).toFixed(1)}px`).join(", ");

  const place = (k: number, e: number) => {
    const pts = front(k, e);
    // What's left of the old page is below the water…
    setClip(page, `polygon(${poly(pts, 0, 0)}, ${W}px ${H + 60}px, 0px ${H + 60}px)`);
    // …and the clean page is above it.
    if (scroller) setClip(scroller, `polygon(${-20 + dx}px ${-60 + dy}px, ${W + 20 + dx}px ${-60 + dy}px, ${poly([...pts].reverse(), dx, dy)})`);
    const d = `M${pts.map((p) => `${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(" L")}`;
    glow.setAttribute("d", d);
    line.setAttribute("d", d);
    // what's left gets pushed down a little and starts to run
    page.style.transform = `translateY(${(e * 18).toFixed(1)}px)`;
    page.style.filter = e > 0.02 ? `blur(${(e * 1.6).toFixed(2)}px)` : "";
    return pts;
  };
  place(0, 0);

  const step = () => {
    const k = Math.min(1, (fx.now() - t0) / dur);
    const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
    place(k, e);
    // drops shaken loose from the heads of the drips
    if (k < 0.92 && fx.now() - lastDrip > 55) {
      lastDrip = fx.now();
      const d = drips[(Math.random() * drips.length) | 0];
      const y = level(e) + d.lead * reachOf(e);
      if (y > 0 && y < H) fx.burst(pr.left + d.x, pr.top + y, { count: 3, speed: 50, size: 1.2, life: 0.6, angle: Math.PI / 2, spread: 0.9 });
    }
    if (k < 1) requestAnimationFrame(step);
    else {
      if (scroller) setClip(scroller, null);
      stage.remove();
    }
  };
  requestAnimationFrame(step);
}
