import type { FxEngine, FxLevel } from "../../fx/engine";
import type { SceneController } from "../../fx/scene";
import type { SkySceneFrame } from "../../fx/sky";
import { clamp01, easeInOut, rand, smooth, SUNLIGHT, WHITE } from "../../fx/util";
import { SKY_PALETTES, paletteVector, type SkyPaletteId } from "./palettes";

export type SkyOptions = {
  /** One of the palettes, or "auto": whichever suits the time of day. */
  colours: SkyPaletteId | "auto";
  /** How cloudy, 0..1. */
  clouds: number;
  /** The wind, 0 (barely moving) .. 0.5 (the usual) .. 1 (racing). */
  wind: number;
};

/** How fast each layer drifts in the usual wind (screen heights a second): the towers, the cumulus, the wisps, the far bank. */
const DRIFT = [0.006, 0.011, 0.004, 0.0025] as const;

/** The palette that suits the hour (local time): dawn, day, golden hour, sunset, twilight. */
export function paletteForHour(h: number): SkyPaletteId {
  if (h >= 5 && h < 6.75) return "pastel";
  if (h >= 6.75 && h < 16.5) return "azure";
  if (h >= 16.5 && h < 18.25) return "golden";
  if (h >= 18.25 && h < 19.5) return "sunset";
  return "twilight";
}

/** The wind setting as a speed: 0.12× (barely) .. 1× (the usual, halfway) .. 4× (racing). */
function windSpeed(w: number) {
  const v = clamp01(w);
  return v <= 0.5 ? 0.12 + 0.88 * (v / 0.5) : Math.pow(4, (v - 0.5) * 2);
}

/**
 * The Sky: the clouds riding the wind, each layer at its own depth (the towers nearest, the
 * wisps far up); the colours easing from one sky to the next (or following the time of day);
 * the cursor a breath of wind, pushing the clouds near it along, the nearer ones shifting as it
 * moves (depth); a new page a burst of sunlight, a gust through the sky and the clouds parting
 * round the page; now and then a contrail drawn across it; and arriving rises up through cloud.
 */
export class SkyScene implements SceneController {
  readonly id = "sky" as const;
  readonly floor = 0.5;
  readonly detailOnSmall = false;
  readonly drops = false;
  /** (on a bright day a flash of light needn't be as strong) */
  readonly flashK = 0.75;

  constructor(private fx: FxEngine) {}

  private opts: SkyOptions = { colours: "azure", clouds: 0.55, wind: 0.5 };
  /** The colours right now, and where they're heading. */
  private pal: number[] = paletteVector(SKY_PALETTES.azure);
  private palTo: number[] = [...this.pal];
  private palMoving = false;
  /** When "auto" last looked at the clock (ms, real time). */
  private clockAt = -1e9;
  private drift: [number, number, number, number] = [0, 0, 0, 0];
  private cover = 0.55;
  private par: [number, number] = [0, 0];
  /** The cursor: where it was a moment ago (CSS px), how fast it's going (px/s), and how far it's pushing the clouds (screen heights). */
  private lastMouse = { x: -1, y: -1 };
  private vel = { x: 0, y: 0 };
  private push = { x: 0, y: 0 };
  /** A new page: when it came (fx clock, ms; <0: none), and where (CSS px). */
  private burstAt = -1e9;
  private partAt = { x: 0, y: 0 };
  private burstNow = 0;
  private partNow = 0;
  private gustNow = 0;
  /** A gust of wind by itself (a page blown away), when it came (fx clock, ms). */
  private gustAt = -1e9;
  private fade = 1;
  /** Rising up through cloud: when it began (fx clock), how long the mist holds before it opens, how long it takes to open (ms). */
  private arrival: { t0: number; hold: number; open: number } | null = null;
  private introNow: [number, number, number] = [0, 0, 0];
  private rise = 0;
  /** A contrail: where it starts (screen heights, y up), its heading, its speed; when it began (fx clock, ms). */
  private trail: { x: number; y: number; a: number; v: number; t0: number } | null = null;
  private nextTrail = 60000;

  setSky(o: Partial<SkyOptions>) {
    const before = this.opts.colours;
    this.opts = { ...this.opts, ...o };
    this.palTo = paletteVector(SKY_PALETTES[this.chosenPalette()]);
    if (before !== this.opts.colours) this.fx.barsSoon();
    // Changes only ease in while you're watching; otherwise they're simply in place next time.
    if (!this.fx.started || this.fx.scene !== "sky") {
      this.pal = [...this.palTo];
      this.cover = this.opts.clouds;
    } else this.palMoving = true;
  }

  /** The palette to show: the one chosen, or the hour's. */
  private chosenPalette(): SkyPaletteId {
    if (this.opts.colours !== "auto") return this.opts.colours;
    const d = new Date();
    return paletteForHour(d.getHours() + d.getMinutes() / 60);
  }

  /** Where the sun is (CSS px), for things that start from it. */
  get sunSpot() {
    const fx = this.fx;
    return { x: this.pal[27] * fx.W, y: (1 - this.pal[28]) * fx.H };
  }

  /** Arriving: rising up through the clouds — the mist streams down past, holds a moment, then opens out. */
  arrive(o: { hold?: number; open?: number } = {}) {
    if (!this.fx.active || this.fx.reducedMotion) return;
    this.arrival = { t0: this.fx.clock, hold: o.hold ?? 380, open: o.open ?? 1900 };
    this.rise = 0;
    this.stepArrival(this.fx.clock, 0);
  }

  /** Whether the mist is still up (or opening). */
  get arriving() {
    return this.arrival !== null;
  }

  /** Cuts the arrival short: the mist opens at once. */
  skipArrival() {
    if (!this.arrival) return;
    const a = this.arrival;
    const t = this.fx.clock - a.t0;
    if (t < a.hold) this.arrival = { ...a, t0: this.fx.clock - a.hold };
  }

  private stepArrival(now: number, dt: number) {
    const a = this.arrival;
    if (!a) {
      this.introNow = [0, 0, 0];
      return;
    }
    const t = now - a.t0;
    const k = clamp01((t - a.hold) / a.open);
    // the mist rushes down past as we rise, slowing as we break out above it
    this.rise += dt * (1.5 - 1.1 * easeInOut(k));
    const open = -0.3 + 1.9 * easeInOut(k);
    this.introNow = [1, open, this.rise];
    // breaking through: the sun bursts out
    if (k > 0.35 && this.burstAt < a.t0) this.sunburst(0.8, false);
    if (k >= 1) {
      this.arrival = null;
      this.introNow = [0, 0, 0];
    }
  }

  /** A burst of sunlight: the rays flare out across the sky. (`part`: the clouds part round the page too.) */
  private sunburst(strength = 1, part = true) {
    const fx = this.fx;
    this.burstAt = fx.clock;
    this.burstK = strength;
    this.partK = part ? strength : 0;
    const p = fx.panel;
    this.partAt = p.w > 0 ? { x: p.x + p.w / 2, y: p.y + Math.min(p.h * 0.4, 320) } : { x: fx.W / 2, y: fx.H * 0.45 };
  }
  private burstK = 1;
  private partK = 1;

  /** A gust of wind sweeps through the sky (the clouds race along for a moment). */
  windGust() {
    this.gustAt = this.fx.clock;
  }

  /** A contrail starts across the upper sky, from one side or the other. */
  contrail() {
    const fx = this.fx;
    const aspect = fx.W / Math.max(1, fx.H);
    const fromLeft = Math.random() < 0.5;
    const y = rand(0.62, 0.9);
    const a = (fromLeft ? 0 : Math.PI) + rand(-0.22, 0.22) * (fromLeft ? 1 : -1) + (y > 0.78 ? -0.06 : 0.08) * (fromLeft ? 1 : -1);
    this.trail = { x: fromLeft ? -0.05 : aspect + 0.05, y, a, v: rand(0.018, 0.026), t0: fx.clock };
  }

  supported() {
    const sky = this.fx.sky;
    return !sky || sky.supports("sky");
  }

  enter(instant: boolean) {
    const fx = this.fx;
    this.fade = instant ? 1 : 0.6;
    this.palTo = paletteVector(SKY_PALETTES[this.chosenPalette()]);
    this.pal = [...this.palTo];
    this.palMoving = false;
    this.cover = this.opts.clouds;
    this.burstAt = -1e9;
    this.gustAt = -1e9;
    this.trail = null;
    this.nextTrail = fx.clock + rand(40000, 80000);
    this.lastMouse = { x: -1, y: -1 };
    this.push = { x: 0, y: 0 };
    this.vel = { x: 0, y: 0 };
  }

  leave() {
    this.arrival = null;
    this.introNow = [0, 0, 0];
    this.trail = null;
  }

  clear() {
    this.arrival = null;
    this.introNow = [0, 0, 0];
    this.burstAt = -1e9;
  }

  skyScale() {
    // The clouds are lit at half resolution anyway; the sky itself is a soft gradient.
    return Math.min(devicePixelRatio || 1, this.fx.small ? 1.25 : 1.5) * (this.fx.effective === "subtle" ? 0.7 : 1);
  }

  timeRate(lvl: FxLevel) {
    // the clouds keep changing shape as you write, a little slower
    return (0.5 + 0.5 * Math.min(1, this.fx.energy)) * (lvl === "subtle" ? 0.6 : 1);
  }

  step(now: number, dt: number) {
    const fx = this.fx;
    this.fade += (1 - this.fade) * Math.min(1, dt * 1.8);
    if (this.fade > 0.999) this.fade = 1;

    // the colours: "auto" checks the clock now and then; any change eases over a few seconds
    if (this.opts.colours === "auto" && performance.now() - this.clockAt > 30000) {
      this.clockAt = performance.now();
      const to = paletteVector(SKY_PALETTES[this.chosenPalette()]);
      if (to.some((v, i) => v !== this.palTo[i])) {
        this.palTo = to;
        this.palMoving = true;
        fx.barsSoon();
      }
    }
    if (this.palMoving) {
      const kk = Math.min(1, dt * 1.1);
      let still = true;
      for (let i = 0; i < this.pal.length; i++) {
        this.pal[i] += (this.palTo[i] - this.pal[i]) * kk;
        if (Math.abs(this.palTo[i] - this.pal[i]) > 0.0015) still = false;
      }
      if (still) {
        this.pal = [...this.palTo];
        this.palMoving = false;
      }
    }
    this.cover += (this.opts.clouds - this.cover) * Math.min(1, dt * 1.5);
    if (Math.abs(this.cover - this.opts.clouds) < 0.001) this.cover = this.opts.clouds;

    // a new page: the burst of sunlight, the clouds parting round the page, a gust through the sky
    const bt = (now - this.burstAt) / 1000;
    const pulse = bt < 0 ? 0 : bt < 0.35 ? smooth(0, 0.35, bt) : Math.exp(-(bt - 0.35) / 1.4);
    this.burstNow = pulse * this.burstK;
    this.partNow = (bt < 0 ? 0 : bt < 0.5 ? smooth(0, 0.5, bt) : Math.exp(-(bt - 0.5) / 2.2)) * this.partK;
    const gust = (t: number) => (t < 0 ? 0 : t < 0.4 ? smooth(0, 0.4, t) : Math.exp(-(t - 0.4) / 1.8));
    this.gustNow = Math.max(gust(bt), gust((now - this.gustAt) / 1000));

    // the wind carries every layer along, each at its own pace (nearer is quicker), a little
    // gentler while you write — and a gust sweeps them all along for a moment
    const rate = (0.55 + 0.45 * Math.min(1, fx.energy)) * windSpeed(this.opts.wind) * (1 + 4 * this.gustNow);
    for (let i = 0; i < 4; i++) this.drift[i] -= dt * DRIFT[i] * rate;

    // the cursor: a breath of wind (as fast as it moves), and depth as it wanders
    const m = fx.mouse;
    const live = fx.cursorK;
    if (this.lastMouse.x >= 0 && dt > 0) {
      const vx = (m.x - this.lastMouse.x) / dt;
      const vy = (m.y - this.lastMouse.y) / dt;
      const k = Math.min(1, dt * 6);
      this.vel.x += (vx - this.vel.x) * k;
      this.vel.y += (vy - this.vel.y) * k;
    }
    this.lastMouse = { x: m.x, y: m.y };
    const H = Math.max(1, fx.H);
    let px = (this.vel.x / H) * 0.05 * live;
    let py = (-this.vel.y / H) * 0.05 * live;
    const pm = Math.hypot(px, py);
    if (pm > 0.05) {
      px *= 0.05 / pm;
      py *= 0.05 / pm;
    }
    const pk = Math.min(1, dt * 3);
    this.push.x += (px - this.push.x) * pk;
    this.push.y += (py - this.push.y) * pk;
    const W = Math.max(1, fx.W);
    const tx = -(fx.smouse.x / W - 0.5) * live;
    const ty = (fx.smouse.y / H - 0.5) * live;
    const ak = Math.min(1, dt * 2);
    this.par[0] += (tx - this.par[0]) * ak;
    this.par[1] += (ty - this.par[1]) * ak;

    this.stepArrival(now, dt);

    // now and then, a contrail across the upper sky (it takes a minute or two to cross and fade)
    if (this.trail && (now - this.trail.t0) / 1000 > 140) this.trail = null;
    if (!this.trail && fx.full && !fx.calm && !document.hidden && now > this.nextTrail) {
      this.contrail();
      this.nextTrail = now + rand(90000, 180000);
    }
  }

  /** Something's changing quickly: draw (and light the clouds) every frame. */
  private get lively() {
    return this.palMoving || this.arrival !== null || this.burstNow > 0.002 || this.partNow > 0.002 || this.gustNow > 0.01 || Math.hypot(this.push.x, this.push.y) > 0.0008 || this.fade < 1;
  }

  busy() {
    return this.lively || Math.abs(this.cover - this.opts.clouds) > 0.001;
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
  frame(): SkySceneFrame {
    const fx = this.fx;
    const { x: ox, y: oy } = fx.origin;
    const t = this.trail;
    const rays = 1 + this.burstNow * 0.9;
    return {
      palette: this.pal,
      drift: this.drift,
      cover: this.cover,
      par: this.par,
      gust: [fx.smouse.x - ox, fx.smouse.y - oy, this.push.x, this.push.y],
      part: [this.partAt.x - ox, this.partAt.y - oy, 0.42, this.partNow * 0.85],
      rays,
      burst: this.burstNow,
      fade: this.fade,
      intro: this.introNow,
      trail: t ? [t.x, t.y, t.a, t.v] : [0, 0, 0, 0.02],
      trailAge: t ? Math.max(0.001, (fx.clock - t.t0) / 1000) : 0,
      lively: this.lively,
    };
  }

  /**
   * New note, in the sky: the sun bursts out — its rays flaring across the sky, a warm wash of
   * light — the clouds part round the page, and a gust of wind sweeps through.
   */
  newNote() {
    const fx = this.fx;
    this.sunburst(1, true);
    if (!fx.full) return true;
    const sun = this.sunSpot;
    fx.flash(sun.x, sun.y, Math.max(fx.W, fx.H) * 0.7, { dur: 1500, alpha: 0.16, color: SUNLIGHT });
    fx.flash(sun.x, sun.y, 120, { dur: 650, alpha: 0.5, color: WHITE });
    return true;
  }
}
