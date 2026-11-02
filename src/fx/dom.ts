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

function apply() {
  raf = 0;
  if (!fx.active) return;
  document.querySelectorAll<HTMLElement>("[data-light]").forEach((el) => {
    const r = el.getBoundingClientRect();
    if (!r.width || r.bottom < 0 || r.top > innerHeight) return;
    const dx = Math.max(r.left - px, 0, px - r.right);
    const dy = Math.max(r.top - py, 0, py - r.bottom);
    el.style.setProperty("--lx", `${(px - r.left).toFixed(1)}px`);
    el.style.setProperty("--ly", `${(py - r.top).toFixed(1)}px`);
    el.style.setProperty("--near", Math.exp(-Math.hypot(dx, dy) / 170).toFixed(3));
    const vx = r.left + r.width / 2 - px;
    const vy = r.top + r.height / 2 - py;
    const d = Math.hypot(vx, vy) || 1;
    const reach = Math.min(1, 520 / d);
    el.style.setProperty("--sx", ((vx / d) * reach).toFixed(3));
    el.style.setProperty("--sy", ((vy / d) * reach).toFixed(3));
  });

  const mag = (target?.closest?.("[data-magnetic]") as HTMLElement | null) ?? null;
  if (magnet && magnet !== mag) magnet.style.translate = "";
  if (mag) {
    const r = mag.getBoundingClientRect();
    const dx = px - (r.left + r.width / 2);
    const dy = py - (r.top + r.height / 2);
    mag.style.translate = `${(dx * 0.2).toFixed(1)}px ${(dy * 0.26).toFixed(1)}px`;
  }
  magnet = mag;

  const tilt = fx.full ? ((target?.closest?.("[data-tilt]") as HTMLElement | null) ?? null) : null;
  if (tilted && tilted !== tilt) {
    tilted.style.transform = "";
    tilted.style.removeProperty("--gx");
    tilted.style.removeProperty("--gy");
  }
  if (tilt) {
    const r = tilt.getBoundingClientRect();
    const nx = (px - r.left) / r.width - 0.5;
    const ny = (py - r.top) / r.height - 0.5;
    tilt.style.transform = `perspective(720px) rotateX(${(-ny * 10).toFixed(2)}deg) rotateY(${(nx * 12).toFixed(2)}deg) translateZ(4px)`;
    tilt.style.setProperty("--gx", `${((nx + 0.5) * 100).toFixed(1)}%`);
    tilt.style.setProperty("--gy", `${((ny + 0.5) * 100).toFixed(1)}%`);
  }
  tilted = tilt;
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
  holder.className = `fx-ghost fx-dissolve${fx.rain ? " is-rain" : ""}`;
  Object.assign(holder.style, { left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px` });
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

/**
 * Deleting a note: the umbra — a dark moon with a burning rim — sweeps across the
 * page and swallows it, revealing whatever comes next behind it.
 */
export function eclipseWipe(noteEl: HTMLElement | null, panelEl: HTMLElement | null) {
  if (!noteEl || !panelEl || !fx.active) return;
  const pr = panelEl.getBoundingClientRect();
  const nr = noteEl.getBoundingClientRect();
  if (!pr.width) return;

  const stage = document.createElement("div");
  stage.className = "fx-ghost fx-wipe";
  Object.assign(stage.style, {
    left: `${pr.left}px`,
    top: `${pr.top}px`,
    width: `${pr.width}px`,
    height: `${pr.height}px`,
    borderRadius: getComputedStyle(panelEl).borderTopLeftRadius,
  });
  const page = document.createElement("div");
  page.className = "fx-wipe-page";
  const clone = ghostOf(noteEl);
  Object.assign(clone.style, { position: "absolute", left: `${nr.left - pr.left}px`, top: `${nr.top - pr.top}px`, width: `${nr.width}px`, margin: "0" });
  page.appendChild(clone);
  const moon = document.createElement("div");
  moon.className = "fx-moon";
  stage.append(page, moon);
  document.body.appendChild(stage);

  const R = Math.max(pr.height * 0.62, pr.width * 0.34);
  const cy = pr.height * 0.5;
  const startX = pr.width + R + 10;
  const endX = -R - 10;
  const dur = fx.full ? 1150 : 700;
  const t0 = fx.now();
  moon.style.width = moon.style.height = `${R * 2}px`;
  play("eclipse");
  fx.setDim(0.55);

  const step = () => {
    const k = Math.min(1, (fx.now() - t0) / dur);
    const e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
    const cx = startX + (endX - startX) * e;
    const mask = `radial-gradient(circle ${R}px at ${cx}px ${cy}px, transparent ${R - 1}px, #000 ${R}px), linear-gradient(90deg, #000 ${cx}px, transparent ${cx}px)`;
    page.style.setProperty("mask-image", mask);
    page.style.setProperty("-webkit-mask-image", mask);
    moon.style.transform = `translate(${cx - R}px, ${cy - R}px)`;
    if (k > 0.05 && k < 0.95) fx.rimDust(pr.left + cx, pr.top + cy, R, -1);
    if (k < 1) requestAnimationFrame(step);
    else {
      fx.setDim(0);
      fx.flash(pr.left + 4, pr.top + cy, 140, { alpha: 0.4 });
      stage.remove();
    }
  };
  requestAnimationFrame(step);
}

/**
 * Deleting a note, in the rain: water sheets down the page from the top and washes the
 * words away with it — running ahead in drips, the last of it sliding and blurring as it goes.
 */
export function rainWash(noteEl: HTMLElement | null, panelEl: HTMLElement | null) {
  if (!noteEl || !panelEl || !fx.active) return;
  const pr = panelEl.getBoundingClientRect();
  const nr = noteEl.getBoundingClientRect();
  if (!pr.width) return;

  const stage = document.createElement("div");
  stage.className = "fx-ghost fx-wash";
  Object.assign(stage.style, {
    left: `${pr.left}px`,
    top: `${pr.top}px`,
    width: `${pr.width}px`,
    height: `${pr.height}px`,
    borderRadius: getComputedStyle(panelEl).borderTopLeftRadius,
  });
  const page = document.createElement("div");
  page.className = "fx-wash-page";
  const clone = ghostOf(noteEl);
  Object.assign(clone.style, { position: "absolute", left: `${nr.left - pr.left}px`, top: `${nr.top - pr.top}px`, width: `${nr.width}px`, margin: "0" });
  page.appendChild(clone);
  stage.append(page);
  document.body.appendChild(stage);

  const W = pr.width;
  const H = pr.height;
  const cols = Math.max(12, Math.round(W / 34));
  // Some runs of water race ahead of the rest.
  const lead = Array.from({ length: cols }, () => (Math.random() < 0.45 ? Math.random() : Math.random() * 0.2));
  const wob = Array.from({ length: cols }, () => Math.random() * Math.PI * 2);
  const dur = fx.full ? 1250 : 760;
  const t0 = fx.now();
  play("eclipse");
  fx.setDim(0.3);
  let lastDrip = 0;

  const step = () => {
    const k = Math.min(1, (fx.now() - t0) / dur);
    const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
    const front = -H * 0.25 + H * 1.5 * e;
    const pts: string[] = [];
    for (let i = 0; i <= cols; i++) {
      const x = (i / cols) * W;
      const c = Math.min(cols - 1, i);
      const reach = lead[c] * H * 0.28 * Math.min(1, e * 2.2) + Math.sin(wob[c] + k * 6) * 3;
      // each run is a rounded finger: shallow at its edges, deepest in the middle
      pts.push(`${x.toFixed(1)}px ${(front - 4).toFixed(1)}px`);
      if (i < cols) {
        const mx = x + W / cols / 2;
        pts.push(`${(mx - W / cols / 4).toFixed(1)}px ${(front + reach * 0.75).toFixed(1)}px`);
        pts.push(`${mx.toFixed(1)}px ${(front + reach).toFixed(1)}px`);
        pts.push(`${(mx + W / cols / 4).toFixed(1)}px ${(front + reach * 0.75).toFixed(1)}px`);
      }
    }
    pts.push(`${W}px ${H + 40}px`, `0px ${H + 40}px`);
    const clip = `polygon(${pts.join(", ")})`;
    page.style.clipPath = clip;
    page.style.setProperty("-webkit-clip-path", clip);
    // what's left gets pushed down a little and starts to run
    page.style.transform = `translateY(${(e * 18).toFixed(1)}px)`;
    page.style.filter = `blur(${(e * 1.6).toFixed(2)}px)`;
    // drops shaken loose along the front
    if (k < 0.92 && fx.now() - lastDrip > 45) {
      lastDrip = fx.now();
      const c = (Math.random() * cols) | 0;
      const x = ((c + 0.5) / cols) * W;
      const y = front + lead[c] * H * 0.28 * Math.min(1, e * 2.2);
      if (y > 0 && y < H) fx.burst(pr.left + x, pr.top + y, { count: 3, speed: 50, size: 1.2, life: 0.6, angle: Math.PI / 2, spread: 0.9 });
    }
    if (k < 1) requestAnimationFrame(step);
    else {
      fx.setDim(0);
      stage.remove();
    }
  };
  requestAnimationFrame(step);
}
