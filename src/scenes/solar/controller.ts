import type { FxEngine, FxLevel } from "../../fx/engine";
import type { SceneController } from "../../fx/scene";
import { goldenShift } from "../../fx/color";
import { ACCENTS } from "../../lib/theme";
import { clamp01, rand, smooth, SUNLIGHT, WHITE, type C255 } from "../../fx/util";

/** The moon nudged a hair off the sun and back — [ms, offset in sun radii] keys. A diamond ring, or just a glimmer of Baily's beads. */
type Nudge = { t0: number; dir: { x: number; y: number }; keys: [number, number][]; spin?: number };

/** The moon's radius in sun radii, and how high the mountains on its edge stand (as in the shader). */
const MOON_R = 1.026;
const CRAGS = 0.012;

/** How much of the sun the moon leaves showing, 0..1, with their centers d sun radii apart. */
function uncovered(d: number) {
  const r1 = 1;
  const r2 = MOON_R;
  if (d >= r1 + r2) return 1;
  if (d <= r2 - r1) return 0;
  const acos = (x: number) => Math.acos(Math.min(1, Math.max(-1, x)));
  const a = r1 * r1 * acos((d * d + r1 * r1 - r2 * r2) / (2 * d * r1));
  const b = r2 * r2 * acos((d * d + r2 * r2 - r1 * r1) / (2 * d * r2));
  const c = 0.5 * Math.sqrt(Math.max(0, (-d + r1 + r2) * (d + r1 - r2) * (d - r1 + r2) * (d + r1 + r2)));
  return clamp01(1 - (a + b - c) / Math.PI);
}

/** Smooth steps between [time, value] keys. */
function keyed(keys: [number, number][], t: number) {
  if (t <= keys[0][0]) return keys[0][1];

  for (let i = 1; i < keys.length; i++) {
    const [t1, v1] = keys[i];
    if (t <= t1) {
      const [t0, v0] = keys[i - 1];
      const u = (t - t0) / Math.max(1, t1 - t0);
      return v0 + (v1 - v0) * u * u * (3 - 2 * u);
    }
  }

  return keys[keys.length - 1][1];
}

/** How much nearer (or further) than usual an eclipse looks at a Distance setting `size`:
 *  0.62 (far off) .. 1 (the default, halfway) .. 3.25 (right up close). */
function scaleOf(size: number) {
  const s = Math.min(1, Math.max(0, size));
  return s <= 0.5 ? Math.pow(2, (s - 0.5) * 1.4) : Math.pow(3.25, (s - 0.5) * 2);
}

/** How far past the default it's been brought, 0..1 (the room it may take grows with it). */
function closerOf(size: number) {
  return Math.min(1, Math.max(0, (size - 0.5) * 2));
}

/** The most a sun's size may be (px), let out as it's brought closer than it once could be. */
function mostOf(size: number, px: number) {
  return px * Math.max(1, scaleOf(size) / 1.62);
}

/**
 * The solar eclipse, seen from the ground: where the sun hangs and how it glides there, the
 * moon wandering over it (or nudged off it: Baily's beads, the diamond ring), prominences
 * erupting, the clouds, the Golden look and the corona's colour easing in and out.
 */
export class SolarScene implements SceneController {
  readonly id = "solar" as const;
  readonly floor = 0.5;
  readonly detailOnSmall = true;
  readonly drops = false;
  readonly flashK = 1;

  constructor(private fx: FxEngine) {}

  /** The solar eclipse: where the sun hangs (CSS px). It glides to a new spot when the layout changes. */
  private sun = { x: 0, y: 0, r: 50 };
  private sunPlaced = false;
  /** What the sun's spot depends on: the page's panels, a friend's page, or nothing yet. */
  private sunAnchor: "none" | "panel" | "moon" = "none";
  /** Held somewhere else for now: the intro plays out in the middle of the screen. */
  private sunHold: { x: number; y: number; r: number } | null = null;
  private nudges: Nudge[] = [];
  /** The intro's moon, sliding in over the sun (its offset, in sun radii). */
  private approach: { x: number; y: number } | null = null;
  private solarFade = 1;
  private coronaK = 1;
  private moonNow = { x: 0, y: 0 };
  private lightNow = 0;
  private glareNow = { x: 0, y: -1, v: 0 };
  private eruption: { t0: number; dur: number; angle: number; size: number } | null = null;
  private eruptNow: [number, number, number, number] = [0, 0, 0, 0];
  private nextGlint = 30000;
  private nextErupt = 45000;
  private nextDiamond = 90000;
  /** How strongly the moon wanders (eased down while it's being nudged). */
  private wanderK = 1;
  /** size: the Distance setting, 0 (far off) .. 1 (close), 0.5 by default. */
  private solarOpts: { clouds: boolean; size: number; golden: boolean; tint: [number, number, number] | null } = { clouds: true, size: 0.5, golden: false, tint: null };
  private goldK = 0;
  /** The corona's chosen colour as it is right now (rgb), and how much of it (it eases in and out). */
  private tintNow: [number, number, number, number] = [1, 1, 1, 0];
  /** The Background setting ("dark" frosts the panels, so the sun keeps to the clearer right-hand column). */
  private backdrop = "clear";
  /** Where your writing ends, where the right-hand column starts and where its widgets end (CSS px), measured now and then. */
  private textRight = 0;
  private railLeft = 0;
  private railBottom = 0;
  private layoutAt = -1e9;
  /** Focus mode (the side columns put away), and how wide those columns are: measured with the layout. */
  private focus = false;
  private sideW = 264;
  private railW = 316;
  /** Where the sun hangs in the usual layout, for focus mode to bring closer (and for what screen). */
  private usual: { x: number; y: number; r: number; key: string } | null = null;
  private cloudsK = 1;

  setSolar(o: Partial<{ clouds: boolean; size: number; golden: boolean; tint: [number, number, number] | null }>) {
    const before = this.solarOpts;
    this.solarOpts = { ...this.solarOpts, ...o };
    if (before.golden !== this.solarOpts.golden || before.tint?.join() !== this.solarOpts.tint?.join()) this.fx.barsSoon();
    // Changes only ease in while you're watching; otherwise they're simply in place next time.
    if (!this.fx.started || !this.fx.solar) {
      this.cloudsK = this.solarOpts.clouds ? 1 : 0;
      this.goldK = this.solarOpts.golden ? 1 : 0;
      const t = this.solarOpts.tint;
      this.tintNow = t ? [t[0], t[1], t[2], 1] : [this.tintNow[0], this.tintNow[1], this.tintNow[2], 0];
    }
  }

  setBackdrop(id: string) {
    this.backdrop = id;
  }

  /** How much nearer (or further) than usual the eclipse looks, from the Distance setting: 0.62 (far
   *  off) .. 1 (the default, halfway) .. 3.25 (right up close). */
  get sunScale() {
    return scaleOf(this.solarOpts.size);
  }

  /** Where an eclipse hangs at a given Distance, in the layout as it is now (CSS px) — the
   *  galaxy's own eclipse borrows the solar eclipse's spot, at the usual distance. */
  homeFor(size: number) {
    return this.sunHome(size);
  }

  /** Where the sun is (CSS px), for things that start from it. */
  get sunSpot() {
    return { ...this.sun };
  }

  /** The Golden look turned to the accent's colours: where it's heading, and where it is (it eases). */
  private shiftTo: [number, number] = [0, 1];
  private shiftNow: [number, number] = [0, 1];

  private goldShift(): [number, number] {
    return this.shiftNow;
  }

  /**
   * Where the sun hangs. With room beside your writing (and panels you can see through), right
   * there in the open sky, a little above the middle of the screen. Otherwise over the right-hand
   * column, in the clear sky below its widgets (drifting down as the list grows). On a phone, low
   * on the right; on a friend's page, high over the note. The Distance setting brings it closer
   * or sends it further off — and so does focus mode: with the side columns put away the sky comes
   * closer, the sun staying where it hangs, only bigger.
   */
  private sunHome(size = this.solarOpts.size) {
    const W = this.fx.W;
    const H = this.fx.H;
    const m = Math.min(W, H);
    const near = scaleOf(size);
    const most = (px: number) => mostOf(size, px);
    const fit = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
    if (this.fx.panelCircle) {
      const r = fit(m * 0.08 * near, 30, 130);
      return { x: W / 2, y: Math.max(r * 2.3, H * 0.15), r };
    }
    if (this.fx.small) {
      const r = fit(W * 0.12 * near, 28, most(110));
      return { x: W * 0.62, y: H * 0.56, r };
    }
    const r0 = m * 0.088 * near;
    if (this.fx.panelEl) {
      this.measureLayout();
      const key = `${W}x${H} ${size} ${this.backdrop}`;
      const page = this.fx.pageRect;
      if (!this.focus) {
        const home = this.beside(this.textRight, this.railLeft, this.railBottom, page.x + page.w, r0, size);
        this.usual = { ...home, key };
        return home;
      }
      // Focus mode: where it would hang with the side columns out (as last seen, or as they'd be)…
      const shift = (this.sideW - this.railW) / 2;
      const usual = this.usual?.key === key ? this.usual : this.beside(this.textRight + shift, W - this.railW, this.railBottom || H * 0.3, W - this.railW, r0, size);
      // …only closer: bigger, though never so big that its bright ring reaches your words
      const clear = (usual.x - this.textRight) / 1.55;
      const r = Math.max(usual.r, Math.min(usual.r * 1.38, clear, usual.y / 1.15));
      return { x: usual.x, y: usual.y, r };
    }
    return { x: W * 0.76, y: H * 0.4, r: fit(r0, 32, most(150)) };
  }

  /** Where the sun hangs beside your writing, given where it ends and where the right-hand column starts. */
  private beside(textRight: number, railLeft: number, railBottom: number, panelRight: number, r0: number, size = this.solarOpts.size) {
    const closer = closerOf(size);
    const most = (px: number) => mostOf(size, px);
    const W = this.fx.W;
    const H = this.fx.H;
    const fit = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
    const gap = railLeft - textRight;
    if (this.backdrop !== "dark" && gap > Math.min(r0, 70) * 3.2) {
      // It keeps its bright inner ring clear of your words — unless you've asked for it closer,
      // when it may come right up to them (and, brought all the way, past them).
      const room = gap / (3.1 - 2 * closer);
      return { x: textRight + gap / 2, y: H * 0.4, r: fit(Math.min(r0, room), 32, most(170)) };
    }
    const right = W - panelRight;
    if (right > 220) {
      const r = fit(Math.min(r0, right * (0.3 + 0.5 * closer)), 34, most(120));
      return { x: panelRight + right / 2, y: fit(railBottom + r * 2.4, H * 0.42, H * 0.72), r };
    }
    return { x: W * 0.76, y: H * 0.4, r: fit(r0, 32, most(150)) };
  }

  /** Where your writing ends and the right-hand column begins (and its widgets end), every so often. */
  private measureLayout() {
    const t = performance.now();
    if (t - this.layoutAt < 400) return;
    this.layoutAt = t;
    let right = 0;
    for (const el of document.querySelectorAll<HTMLElement>(".canvas .note-title, .canvas .prose")) right = Math.max(right, el.getBoundingClientRect().right);
    // no note open: about where one would be
    const page = this.fx.pageRect;
    this.textRight = right || page.x + page.w / 2 + 330;
    // focus mode, and how wide the side columns are when they're out
    const app = document.querySelector<HTMLElement>(".app");
    this.focus = Boolean(app?.classList.contains("is-focus"));
    if (app && !this.focus) {
      const cs = getComputedStyle(app);
      this.sideW = parseFloat(cs.getPropertyValue("--sidebar-w")) || this.sideW;
      this.railW = parseFloat(cs.getPropertyValue("--rail-w")) || this.railW;
    }
    const rail = document.querySelector<HTMLElement>(".app.has-rail .rail-inner");
    this.railLeft = rail ? rail.getBoundingClientRect().left : this.fx.W;
    const last = rail?.lastElementChild;
    // (in focus mode the column's put away: where its widgets ended is kept for when it's back)
    if (last) this.railBottom = last.getBoundingClientRect().bottom;
    else if (!this.focus) this.railBottom = 0;
  }

  /** Something's moving in the solar sky, so it should be drawn every frame. */
  private get solarBusy() {
    return (
      this.fx.solar &&
      (this.nudges.length > 0 ||
        this.approach !== null ||
        this.eruption !== null ||
        this.solarFade < 0.995 ||
        this.sunHold !== null ||
        (this.cloudsK > 0 && this.cloudsK < 1) ||
        (this.goldK > 0 && this.goldK < 1) ||
        (this.tintNow[3] > 0 && this.tintNow[3] < 1) ||
        this.shiftNow[0] !== this.shiftTo[0] ||
        this.shiftNow[1] !== this.shiftTo[1])
    );
  }

  private stepSolar(now: number, dt: number, idle: boolean) {
    this.solarFade += (1 - this.solarFade) * Math.min(1, dt * 1.6);
    this.cloudsK += ((this.solarOpts.clouds ? 1 : 0) - this.cloudsK) * Math.min(1, dt * 1.8);
    if (Math.abs(this.cloudsK - (this.solarOpts.clouds ? 1 : 0)) < 0.002) this.cloudsK = this.solarOpts.clouds ? 1 : 0;
    // switching looks is a slow change of light, not a cut
    const goldTo = this.solarOpts.golden ? 1 : 0;
    this.goldK += (goldTo - this.goldK) * Math.min(1, dt * 1.4);
    if (Math.abs(this.goldK - goldTo) < 0.002) this.goldK = goldTo;
    // a new accent turns the Golden look round to its colours (the short way round)
    {
      const [ta, ts] = this.shiftTo;
      const sn = this.shiftNow;
      let da = ta - sn[0];
      da = Math.atan2(Math.sin(da), Math.cos(da));
      const kk = Math.min(1, dt * 2.2);
      sn[0] += da * kk;
      sn[1] += (ts - sn[1]) * kk;
      if (Math.abs(da) < 1e-3 && Math.abs(ts - sn[1]) < 1e-3) this.shiftNow = [ta, ts];
    }
    // and a new corona colour washes in the same way
    const tt = this.solarOpts.tint;
    const tk = Math.min(1, dt * 1.6);
    const tn = this.tintNow;
    const tTo: [number, number, number, number] = tt ? [tt[0], tt[1], tt[2], 1] : [tn[0], tn[1], tn[2], 0];
    for (let i = 0; i < 4; i++) tn[i] += (tTo[i] - tn[i]) * tk;
    if (Math.abs(tn[3] - tTo[3]) < 0.002) tn[3] = tTo[3];
    const to = this.sunHold ?? this.sunHome();
    // The first time there's a page to hang it by, it goes straight there; after that it glides.
    const anchor = this.fx.panelCircle ? "moon" : this.fx.panelEl ? "panel" : "none";
    if (anchor !== this.sunAnchor) {
      if (this.sunAnchor === "none" && !this.sunHold) this.sunPlaced = false;
      this.sunAnchor = anchor;
    }
    if (!this.sunPlaced) {
      this.sun = { ...to };
      this.sunPlaced = true;
    } else {
      const k = Math.min(1, dt * 2.2);
      this.sun.x += (to.x - this.sun.x) * k;
      this.sun.y += (to.y - this.sun.y) * k;
      this.sun.r += (to.r - this.sun.r) * k;
    }

    // The moon: nudged a hair off the sun now and then — or, in the intro, sliding in over it.
    let ox = 0;
    let oy = 0;
    this.nudges = this.nudges.filter((n) => {
      const t = now - n.t0;
      const end = n.keys[n.keys.length - 1][0];
      if (t >= end) return false;
      // its edge creeps unevenly, so the beads along it flicker
      const v = Math.max(0, keyed(n.keys, t) + Math.sin(t * 0.047 + n.t0) * 0.0009 + Math.sin(t * 0.031) * 0.0006);
      // and it may slide along the sun's edge as it goes, so the beads light up one after another
      const turn = (n.spin ?? 0) * (t / end - 0.5);
      const c = Math.cos(turn);
      const sn = Math.sin(turn);
      ox -= (n.dir.x * c - n.dir.y * sn) * v;
      oy -= (n.dir.x * sn + n.dir.y * c) * v;
      return true;
    });
    if (this.approach) {
      ox += this.approach.x;
      oy += this.approach.y;
    } else {
      // It never sits quite still: it wanders a hair to and fro over the sun, so the pink rim of
      // fire slides slowly round its edge. (Less so while it's being nudged.)
      this.wanderK += ((this.nudges.length ? 0.25 : 1) - this.wanderK) * Math.min(1, dt * 2);
      const lt = this.fx.time;
      ox += (0.0068 * Math.sin(lt * 0.13) + 0.0028 * Math.sin(lt * 0.41 + 1.3)) * this.wanderK;
      oy += (0.0068 * Math.cos(lt * 0.097) + 0.0028 * Math.cos(lt * 0.37 + 0.4)) * this.wanderK;
    }
    this.moonNow = { x: ox, y: oy };
    const d = Math.hypot(ox, oy);
    this.lightNow = uncovered(d);
    // The glare: from the moment the deepest valleys along the moon's edge let the sun through.
    const g = smooth(0.003, 0.042, d - (MOON_R - 1 - CRAGS));
    this.glareNow = d > 1e-6 ? { x: -ox / d, y: -oy / d, v: Math.pow(g, 1.5) * (1 + Math.min(1.2, this.lightNow * 10)) } : { x: 0, y: -1, v: 0 };
    // The corona can only be seen at totality: the least bit of sunlight drowns it out.
    const coronaTo = 1 - smooth(0.0015, 0.03, this.lightNow);
    this.coronaK += (coronaTo - this.coronaK) * Math.min(1, dt * (coronaTo > this.coronaK ? 1.5 : 9));

    const e = this.eruption;
    const ep = e ? (now - e.t0) / e.dur : 1;
    if (e && ep >= 1) this.eruption = null;
    this.eruptNow = e && ep < 1 ? [e.angle, Math.max(0, ep), e.size, 1] : [0, 0, 0, 0];

    // Now and then: a glimmer of Baily's beads (gentle enough to come while you write, too —
    // just less often); a prominence erupting, with a great bubble of corona bursting out behind
    // it; and, once you've left it alone for a while, the full diamond ring.
    if (this.fx.full && !document.hidden && !this.sunHold) {
      if (now > this.nextGlint) {
        this.glint();
        this.nextGlint = now + rand(16000, 36000) * (this.fx.calm ? 2 : idle ? 0.7 : 1);
      }
      if (!this.fx.calm && now > this.nextErupt) {
        this.erupt();
        this.nextErupt = now + rand(28000, 60000) * (idle ? 0.6 : 1);
      }
      if (idle && !this.fx.calm && now > this.nextDiamond) {
        this.solarDiamond(0.8);
        this.nextDiamond = now + rand(70000, 140000);
      }
    }
  }

  /**
   * A glimmer: the moon's edge drifts a hair off the sun and slides along it, so Baily's beads
   * light up one after another — a shimmer of light running round the rim — and go out again.
   */
  glint() {
    if (!this.fx.solar || !this.fx.active) return;
    const a = rand(0, Math.PI * 2);
    this.nudges.push({
      t0: this.fx.clock,
      dir: { x: Math.cos(a), y: Math.sin(a) },
      spin: rand(0.5, 0.9) * (Math.random() < 0.5 ? -1 : 1),
      keys: [
        [0, 0],
        [600, 0.02],
        [1400, 0.0266],
        [2600, 0.0268],
        [3500, 0.012],
        [4000, 0],
      ],
    });
  }

  /** A prominence lifts off the sun's edge and erupts into space, slowly. */
  erupt() {
    if (!this.fx.solar || !this.fx.full) return;
    this.eruption = { t0: this.fx.clock, dur: rand(10000, 14000), angle: rand(0, Math.PI * 2), size: rand(0.85, 1.4) };
  }

  /**
   * New note, under the solar eclipse: the moon slips a hair off the sun. Baily's beads flicker
   * along its edge — then the sunlight bursts out at one point, the diamond ring. It lights the
   * clouds, flares across the lens, and fades as the moon slides back over.
   */
  private solarDiamond(strength = 1) {
    const s = this.sun;
    // It breaks out on the side facing the middle of the screen, more or less — or, in the Golden
    // look, right where the sun is already blazing (up and to the left).
    const a = this.solarOpts.golden ? Math.atan2(-0.571, -0.821) : Math.atan2(this.fx.H * 0.45 - s.y, this.fx.W * 0.5 - s.x) + rand(-0.55, 0.55);
    const dir = { x: Math.cos(a), y: Math.sin(a) };
    const peak = 0.034 + 0.026 * strength;
    const burst = 520;
    this.nudges = [
      {
        t0: this.fx.clock,
        dir,
        keys: [
          [0, 0],
          [160, 0.021],
          [400, 0.027],
          [burst, peak],
          [burst + 260, peak],
          [burst + 1250, 0.03],
          [burst + 1900, 0.022],
          [burst + 2500, 0],
        ],
      },
    ];
    this.lensFlare({ x: s.x + dir.x * s.r, y: s.y + dir.y * s.r }, burst - 40, strength);
  }

  /**
   * The sunlight flaring in the lens, over everything: a wash of warm light, and ghosts marching
   * across the screen from the point where it broke out (by default, wherever it's breaking out now).
   */
  lensFlare(at?: { x: number; y: number }, delay = 0, strength = 1) {
    if (!this.fx.full) return;
    const s = this.sun;
    const x = at?.x ?? s.x + this.glareNow.x * s.r;
    const y = at?.y ?? s.y + this.glareNow.y * s.r;
    this.fx.flash(x, y, Math.max(this.fx.W, this.fx.H) * 0.75, { dur: 1600, alpha: 0.13 * strength, color: SUNLIGHT, delay });
    this.fx.flash(x, y, s.r * 1.4, { dur: 700, alpha: 0.75, color: WHITE, delay });
    const cx = this.fx.W / 2;
    const cy = this.fx.H / 2;
    const ghosts: [number, number, boolean, C255, number][] = [
      [0.32, 16, true, SUNLIGHT, 0.26],
      [0.58, 44, false, this.fx.accentHot, 0.14],
      [0.84, 8, false, WHITE, 0.36],
      [1.16, 26, true, this.fx.accent, 0.22],
      [1.46, 72, false, SUNLIGHT, 0.09],
      [1.74, 12, true, WHITE, 0.3],
    ];
    const t0 = this.fx.clock + delay;
    ghosts.forEach(([k, r, hex, color, alpha], i) =>
      this.fx.ghosts.push({ x: x + (cx - x) * k * 2, y: y + (cy - y) * k * 2, r, hex, color, alpha: alpha * strength, t0: t0 + i * 45, dur: 1400 }),
    );
    this.fx.overDirty = true;
  }

  /**
   * The solar intro: the moon slides in over the sun in the middle of the screen. `spot` holds
   * the sun there (null lets it glide home); `moon` is the moon's offset in sun radii (null once
   * it's home). `fromBlack` fades the sky up from dark.
   */
  holdSun(spot: { x: number; y: number; r: number } | null, o: { fromBlack?: boolean } = {}) {
    this.sunHold = spot;
    if (spot) {
      this.sun = { ...spot };
      this.sunPlaced = true;
    }
    if (o.fromBlack) this.solarFade = 0;
  }

  setApproach(moon: { x: number; y: number } | null) {
    this.approach = moon;
  }

  supported() {
    const sky = this.fx.sky;
    return !sky || sky.solarReady();
  }

  enter(instant: boolean) {
    const fx = this.fx;
    this.solarFade = instant ? 1 : 0.55;
    this.nudges = [];
    this.eruption = null;
    this.coronaK = 1;
    this.nextGlint = fx.clock + rand(12000, 25000);
    this.nextErupt = fx.clock + rand(20000, 40000);
    this.nextDiamond = fx.clock + rand(50000, 90000);
    // Straight to its spot (so a view transition's snapshot already has it there).
    this.sunPlaced = fx.started;
    if (fx.started) this.sun = this.sunHome();
  }

  leave() {}

  skyScale() {
    // The clouds are drawn small anyway; the moon wants a crisp edge.
    return Math.min(devicePixelRatio || 1, this.fx.small ? 1.25 : 1.35) * (this.fx.effective === "subtle" ? 0.7 : 1);
  }

  timeRate(lvl: FxLevel) {
    // the clouds under the eclipse drift on while you write, a little slower
    return (0.45 + 0.55 * Math.min(1, this.fx.energy)) * (lvl === "subtle" ? 0.6 : 1);
  }

  step(now: number, dt: number, idle: boolean) {
    this.stepSolar(now, dt, idle);
  }

  busy() {
    return this.solarBusy;
  }

  mustRender() {
    return false;
  }

  drawsSky() {
    return true;
  }

  behind() {
    this.fx.clearBehind();
  }

  /** Its part of the sky's frame. */
  frame() {
    const fx = this.fx;
    const { x: ox, y: oy } = fx.origin;
    return {
      sun: { x: this.sun.x - ox, y: this.sun.y - oy, r: this.sun.r },
      moon: this.moonNow,
      light: this.lightNow,
      glare: this.glareNow,
      corona: this.coronaK,
      erupt: this.eruptNow,
      fade: this.solarFade,
      clouds: this.cloudsK,
      gold: this.goldK,
      tint: this.tintNow,
      goldShift: this.goldShift(),
    };
  }

  newNote() {
    this.solarDiamond();
    return true;
  }

  /** A new accent turns the Golden look round to its colours. */
  accent(color: string) {
    const g = goldenShift(color, ACCENTS.corona.color);
    this.shiftTo = [g.angle, g.sat];
    if (!this.fx.started) this.shiftNow = [g.angle, g.sat];
  }
}
