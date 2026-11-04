import type { FxEngine, FxLevel } from "../../fx/engine";
import type { SceneController } from "../../fx/scene";
import type { InkStep } from "../../fx/sky";
import { rand } from "../../fx/util";
import { CLEARED, FALL, REVEAL, SKIP_MS, arrivalLook, dropInk } from "./arrival";
import { INK_BLOOMS } from "./shaders";
import { FLUID_BLOOMS } from "./fluid";
import { newBloom, newDrop, type InkBloom, type InkColours } from "./blooms";

/**
 * Ink: the water's current and the clouds blooming in it (where, how often, how big), the
 * simulation's steps (twenty a second, run by the renderer), the cursor stirring the water,
 * ripples, the drop arriving, and the moments when ink may show behind the note (a new page,
 * a deleted one, the launch's welcome).
 */
export class InkScene implements SceneController {
  readonly id = "ink" as const;
  readonly floor = 0.35;
  readonly detailOnSmall = false;
  readonly drops = false;
  /** (on paper a flash of light becomes a wash of ink, which needs far less of it) */
  readonly flashK = 0.32;

  constructor(private fx: FxEngine) {}

  /** The current's own clock (s), and the time not yet simulated (the simulation steps 20 times a second). */
  private inkT = 40;
  private inkAcc = 0;
  private inkBlooms: InkBloom[] = [];
  private inkNext = 0;
  /** Steps still to run quickly, to start with ink already in the water. */
  private inkWarm = 0;
  private inkReset = false;
  private inkSteps: InkStep[] = [];
  private inkMix = 1;
  /** The cursor's motion, smoothed (screen heights per second). */
  private stirV = { x: 0, y: 0 };
  private stirAt = { x: 0, y: 0 };
  /** How firmly the note's area is kept clear, and how much ink shows behind it (both dip while a drop arrives). */
  private inkClear = 1;
  private inkBehind = 0.16;
  private inkRipples: { x: number; y: number; t0: number; strength: number }[] = [];
  /** The drop arriving: when it started, where it lands, and what to tell whoever asked. */
  private arrival: {
    t0: number;
    at: { x: number; y: number };
    landed: boolean;
    revealed: boolean;
    out: number;
    on: { land?: () => void; reveal?: () => void; done?: () => void };
  } | null = null;
  private intro: [number, number, number, number] = [0, 0, 0, 0];
  /** The ink couldn't be drawn here: plain paper (CSS) instead. */
  private inkStatic = false;
  /** The ink is in real water here (drops plunge in from the surface), else the lighter fluid-style ink. */
  private fluid = false;
  /** Charcoal and indigo, or the accent's ink among them too (real water only). */
  private colours: InkColours = "sumi";
  /** When a finished paragraph last let a drop fall (effects clock, ms), and on which side of the words. */
  private lastDrip = -1e9;
  private dripLeft = false;
  /** Until when (effects clock, ms) ink may stay in the middle of the screen — the launch's welcome. */
  private inkHoldUntil = 0;

  /** Clean water, with ink already drifting in it by the time anyone sees it. */
  private startInk() {
    this.inkBlooms = [];
    this.inkRipples = [];
    this.inkAcc = 0;
    this.inkNext = this.inkT + 0.3;
    this.inkReset = true;
    this.inkClear = 1;
    this.inkBehind = 0.16;
    this.arrival = null;
    this.intro = [0, 0, 0, 0];
    // the cursor's stir starts from where it is (not from a leap across the screen)
    this.stirAt = { ...this.fx.mouse };
    this.stirV = { x: 0, y: 0 };
    this.inkStatic = !this.fx.sky || !this.fx.sky.inkReady();
    this.fluid = !this.inkStatic && Boolean(this.fx.sky?.inkFluid);
    // (the page's styles keep their paper to the words' column when the water can show around them)
    document.documentElement.toggleAttribute("data-ink-water", this.fluid);
    const aspect = this.fx.W / Math.max(1, this.fx.H);
    const panel = this.inkPanel();
    const rect = { x0: panel[0], y0: panel[1], x1: panel[2], y1: panel[3] };
    if (this.fluid) {
      // a few drops already fallen (and falling), so the water has its ink when it's first seen
      this.inkWarm = 140;
      const column = this.columnRect();
      for (let i = 0; i < 5; i++) this.inkBlooms.push(newDrop(Math.random, this.inkT + 0.5 + i * 2.6, aspect, column, this.inkScale, this.colours));
      this.inkBlooms.push(newBloom(Math.random, this.inkT + 1, aspect, rect, false, this.inkScale, this.colours));
      this.inkNext = this.inkT + 14.5;
      return;
    }
    this.inkWarm = 170;
    // a handful already under way, along the bottom and the sides
    for (let i = 0; i < 4; i++) this.inkBlooms.push(newBloom(Math.random, this.inkT + i * 1.6, aspect, rect, false, this.inkScale));
  }

  /** The words' column (screen heights, y up): in real water, ink is seen softly behind it. */
  private columnRect() {
    const c = this.column();
    if (c[2] <= 0) return null;
    const H = Math.max(1, this.fx.H);
    return { x0: c[0] / H, y0: 1 - (c[1] + c[3]) / H, x1: (c[0] + c[2]) / H, y1: 1 - c[1] / H };
  }

  /** The words' column (CSS px: x, y, w, h): the middle of the note, as wide as its writing. */
  private column(): [number, number, number, number] {
    const p = this.fx.panel;
    if (p.circle || p.w <= 0 || p.y > this.fx.H) return [0, 0, 0, 0];
    const half = Math.min(p.w / 2 - 6, 336);
    return [p.x + p.w / 2 - half, p.y, half * 2, p.h];
  }

  /**
   * The part of the screen kept clear of ink (behind the note), in screen heights (y up). On a
   * phone the note is the whole screen, so the clear part is its middle: ink keeps to the sides
   * and gathers below.
   */
  private inkPanel(): [number, number, number, number] {
    const H = Math.max(1, this.fx.H);
    let { x, y, w, h } = this.fx.panel;
    // on a phone (or a note filling the screen) all of it is writing: the ink keeps to a thin
    // margin down the sides and gathers along the bottom
    const full = this.fx.small || w > this.fx.W * 0.86;
    if (full) {
      x = this.fx.W * 0.07;
      w = this.fx.W * 0.86;
      y = this.fx.H * 0.1;
      h = this.fx.H * 0.74;
    }
    if (y > this.fx.H) return [-9, -9, -8.9, -8.9];
    // and on a big screen it may pool a little way up along the bottom edge, under the note
    const pool = full ? 0 : Math.min(0.07, 54 / H);
    return [x / H, Math.max(1 - (y + h) / H, pool), (x + w) / H, 1 - y / H];
  }

  /** How big the clouds are, for the screen's shape: smaller on a tall, narrow one. */
  private get inkScale() {
    const aspect = this.fx.W / Math.max(1, this.fx.H);
    return Math.min(1, Math.max(0.55, 0.55 + (0.45 * (aspect - 0.45)) / 0.85));
  }

  private stepInk(now: number, dt: number) {
    // (real water that couldn't carry on — its textures couldn't be made at a new size — gives way
    // to the lighter ink, with clean water)
    if (this.fluid && !this.fx.sky?.inkFluid) {
      this.fluid = false;
      this.inkBlooms = [];
      this.inkReset = true;
      document.documentElement.removeAttribute("data-ink-water");
    }
    const aspect = this.fx.W / Math.max(1, this.fx.H);
    const panel = this.inkPanel();
    const rect = { x0: panel[0], y0: panel[1], x1: panel[2], y1: panel[3] };
    const steps: InkStep[] = [];
    const column = this.fluid ? this.columnRect() : null;
    const slots = this.fluid ? FLUID_BLOOMS : INK_BLOOMS;
    const add = (sdt: number) => {
      // new clouds come along every few seconds (a little less often while you write)
      while (this.inkT >= this.inkNext) {
        if (this.fluid) {
          // in real water: a drop plunging in from the surface — now and then two together, or a
          // cloud blooming low or at a side instead
          const pick = Math.random();
          if (pick < 0.16) this.inkBlooms.push(newBloom(Math.random, this.inkNext, aspect, rect, false, this.inkScale, this.colours));
          else {
            const d = newDrop(Math.random, this.inkNext, aspect, column, this.inkScale, this.colours);
            this.inkBlooms.push(d);
            if (pick > 0.8) {
              const twin = newDrop(Math.random, this.inkNext + rand(0.5, 1.4), aspect, column, this.inkScale, this.colours);
              twin.x = Math.min(aspect - 0.04, Math.max(0.04, d.x + rand(-0.09, 0.09)));
              this.inkBlooms.push(twin);
            }
          }
          this.inkNext += rand(4.2, 7.5) * (this.fx.calm ? 1.35 : 1);
          continue;
        }
        this.inkBlooms.push(newBloom(Math.random, this.inkNext, aspect, rect, false, this.inkScale));
        // and the bottom gets an extra one now and then
        if (Math.random() < 0.3) {
          const b = newBloom(Math.random, this.inkNext + rand(0.6, 2.2), aspect, rect, false, this.inkScale);
          b.y = rand(0.01, this.fx.small ? 0.08 : 0.12);
          this.inkBlooms.push(b);
        }
        this.inkNext += rand(4.5, 8.5) * (this.fx.calm ? 1.3 : 1);
      }
      const A = new Float32Array(slots * 4);
      const B = new Float32Array(slots * 4);
      const live = this.inkBlooms.filter((b) => this.inkT >= b.t0 && this.inkT - b.t0 < 14).slice(-slots);
      for (let i = 0; i < slots; i++) {
        const b = live[i];
        if (b) {
          A.set([b.x, b.y, b.r, this.inkT - b.t0], i * 4);
          B.set([b.amount, b.indigo, b.push, b.seed], i * 4);
        } else A.set([0, 0, 0.05, -1], i * 4);
      }
      steps.push({ t: this.inkT, dt: sdt, A, B });
      this.inkT += sdt;
    };
    // to begin with: a quick run (in bigger steps), so there's already ink in the water
    let n = 0;
    while (this.inkWarm > 0 && n < (this.fluid ? 20 : 30)) {
      add(this.fluid ? 0.1 : 0.15);
      this.inkWarm--;
      n++;
    }
    // then twenty steps a second
    const STEP = 0.05;
    this.inkAcc += dt;
    let k = 0;
    while (this.inkAcc >= STEP && k < 3) {
      add(STEP);
      this.inkAcc -= STEP;
      k++;
    }
    if (this.inkAcc > STEP * 3) this.inkAcc = 0;
    this.inkMix = Math.min(1, Math.max(0, this.inkAcc / STEP));
    this.inkSteps = steps;
    this.inkBlooms = this.inkBlooms.filter((b) => this.inkT - b.t0 < 14);

    // the cursor stirs the water as it moves (a mouse; a finger is for scrolling)
    const H = Math.max(1, this.fx.H);
    const vx = (this.fx.mouse.x - this.stirAt.x) / Math.max(dt, 1e-3) / H;
    const vy = -(this.fx.mouse.y - this.stirAt.y) / Math.max(dt, 1e-3) / H;
    this.stirAt = { ...this.fx.mouse };
    const cap = (v: number) => Math.max(-1.2, Math.min(1.2, v));
    const kk = Math.min(1, dt * 9);
    this.stirV.x += (cap(vx) - this.stirV.x) * kk;
    this.stirV.y += (cap(vy) - this.stirV.y) * kk;

    // ripples run out and die away
    this.inkRipples = this.inkRipples.filter((r) => now - r.t0 < 3200);

    // the area behind the note clears again after a drop, and its ink goes back to a whisper
    if (!this.arrival && now > this.inkHoldUntil) {
      this.inkClear += (1 - this.inkClear) * Math.min(1, dt * 0.45);
      this.inkBehind += (0.16 - this.inkBehind) * Math.min(1, dt * 0.45);
    }
    this.stepArrival(now);
  }

  /** The drop arriving, frame by frame. */
  private stepArrival(now: number) {
    const a = this.arrival;
    if (!a) {
      this.intro = [0, 0, 0, 0];
      return;
    }
    // the water's first quick steps (a burst of work) happen in the dark, before the drop falls
    if (this.inkWarm > 0 && !a.landed && !a.out) a.t0 = now;
    const t = (now - a.t0) / 1000;
    if (t >= FALL && !a.landed) this.landDrop(a, now);
    if (a.landed && !a.revealed && t >= REVEAL) {
      a.revealed = true;
      a.on.reveal?.();
    }
    const out = a.out > 0 ? Math.min(1, (now - a.out) / SKIP_MS) : 0;
    this.intro = arrivalLook(t, out);
    if (this.intro[0] <= 0.001 && (t > CLEARED || out >= 1)) {
      this.arrival = null;
      this.intro = [0, 0, 0, 0];
      a.on.done?.();
    }
  }

  /** The drop lands: a cloud of ink blooms out from it, and a ripple runs out across the water. */
  private landDrop(a: NonNullable<InkScene["arrival"]>, now: number) {
    a.landed = true;
    const H = Math.max(1, this.fx.H);
    this.inkBlooms.push(...dropInk(a.at.x / H, 1 - a.at.y / H, this.inkT, Math.random, this.inkScale));
    this.inkRipples.push({ x: a.at.x, y: a.at.y, t0: now, strength: 1.5 });
    a.on.land?.();
  }

  /**
   * Ink arriving: the screen is dark, a single drop falls to the middle, and as it lands a ripple
   * runs out, the ink blooms and curls away from it, and the paper opens out of the dark around
   * it. `land` and `reveal` are told when it lands and when the page can start coming back.
   */
  inkArrive(on: { land?: () => void; reveal?: () => void; done?: () => void } = {}) {
    if (!this.fx.inkScene || this.inkStatic || !this.fx.active) return false;
    const at = { x: this.fx.W / 2, y: this.fx.H / 2 };
    this.arrival = { t0: this.fx.clock, at, landed: false, revealed: false, out: 0, on };
    // the ink from the drop is allowed in the middle for a while, then cleared away as the note returns
    this.inkClear = 0.06;
    this.inkBehind = 1;
    this.stepArrival(this.fx.clock);
    return true;
  }

  /** Skips to the end of the arrival (a tap, a click or a key): the drop lands at once. */
  inkSkip() {
    const a = this.arrival;
    if (!a || a.out) return;
    a.out = this.fx.clock;
    if (!a.landed) this.landDrop(a, this.fx.clock);
    if (!a.revealed) {
      a.revealed = true;
      a.on.reveal?.();
    }
  }

  /** Whether a drop is arriving right now. */
  get arriving() {
    return Boolean(this.arrival);
  }

  /** Drops the arrival at once (the scene is changing again): its `done` is still told. */
  private endArrival() {
    const a = this.arrival;
    if (!a) return;
    this.arrival = null;
    this.intro = [0, 0, 0, 0];
    a.on.done?.();
  }

  /**
   * The launch's welcome on paper: a slow cloud of ink opening out under the name (at x, y, CSS
   * px), allowed to linger in the middle of the screen for `hold` ms before the page clears it.
   */
  inkWelcome(x: number, y: number, hold = 2600) {
    if (!this.fx.inkScene || this.inkStatic || !this.fx.active) return false;
    const H = Math.max(1, this.fx.H);
    this.inkHoldUntil = this.fx.clock + hold;
    this.inkClear = 0.05;
    this.inkBehind = 1;
    const s = this.inkScale;
    this.inkBlooms.push({ x: x / H, y: 1 - y / H, r: 0.06 * s, t0: this.inkT + 0.05, amount: 2.3, indigo: 0.12, push: 0.085 * s, seed: Math.random() * 100 });
    this.inkBlooms.push({ x: x / H - 0.05 * s, y: 1 - y / H - 0.012, r: 0.035 * s, t0: this.inkT + 0.55, amount: 1.5, indigo: 0.6, push: 0.05 * s, seed: Math.random() * 100 });
    this.inkBlooms.push({ x: x / H + 0.06 * s, y: 1 - y / H + 0.008, r: 0.03 * s, t0: this.inkT + 0.85, amount: 1.3, indigo: 0.25, push: 0.045 * s, seed: Math.random() * 100 });
    return true;
  }

  /**
   * For a moment, ink may show behind the note (a new page's drop, a deleted page's words letting
   * go): it shows more strongly there, and is cleared more gently, for `ms` — then as usual.
   */
  inkLinger(ms: number, behind = 0.6) {
    if (!this.fx.inkScene) return;
    this.inkHoldUntil = Math.max(this.inkHoldUntil, this.fx.clock + ms);
    this.inkBehind = Math.max(this.inkBehind, behind);
    this.inkClear = Math.min(this.inkClear, 0.3);
  }

  /** A ripple running out across the water (and the paper). */
  inkRipple(x: number, y: number, strength = 1) {
    if (!this.fx.inkScene) return;
    this.inkRipples.push({ x, y, t0: this.fx.clock, strength });
    if (this.inkRipples.length > 3) this.inkRipples.shift();
  }

  /** A fresh cloud of ink blooming at a point on the screen (CSS px). */
  inkBloom(x: number, y: number, o: { size?: number; amount?: number; indigo?: number; push?: number; splash?: boolean } = {}) {
    if (!this.fx.inkScene || this.inkStatic) return;
    const H = Math.max(1, this.fx.H);
    this.inkBlooms.push({
      x: x / H,
      y: 1 - y / H,
      r: o.size ?? 0.06,
      t0: this.inkT,
      amount: o.amount ?? 2,
      indigo: o.indigo ?? (Math.random() < 0.4 ? rand(0.3, 0.7) : rand(0, 0.1)),
      push: o.push ?? 0.11,
      // (past 1000: a drop's splash — it opens out in curling fingers)
      seed: Math.random() * 100 + (o.splash ? 1000 : 0),
    });
  }

  private inkFrame() {
    const H = Math.max(1, this.fx.H);
    const now = this.fx.clock;
    return {
      steps: this.inkSteps,
      mix: this.inkMix,
      reset: this.inkReset,
      aspect: this.fx.W / H,
      panel: this.inkPanel(),
      clear: this.inkClear,
      stir: [this.fx.mouse.x / H, 1 - this.fx.mouse.y / H, this.stirV.x * 0.4 * this.fx.cursorK * (this.fx.small ? 0 : 1), this.stirV.y * 0.4 * this.fx.cursorK * (this.fx.small ? 0 : 1)] as [number, number, number, number],
      flow: this.fx.effective === "subtle" ? 0.7 : 1,
      // (on a phone the words fill the screen: the ink shows a little more strongly behind them)
      behind: this.fluid && this.fx.small ? Math.max(this.inkBehind, 0.3) : this.inkBehind,
      ripples: this.inkRipples.slice(-3).map((r) => [r.x, r.y, (now - r.t0) / 1000, r.strength] as [number, number, number, number]),
      intro: this.intro,
      drop: this.arrival ? this.arrival.at : { x: this.fx.W / 2, y: this.fx.H / 2 },
      fade: 1,
      column: this.fluid ? this.column() : ([0, 0, 0, 0] as [number, number, number, number]),
      light: this.fx.effective === "subtle" ? 0.6 : 1,
    };
  }

  /** Ink's own settings: its colours (in real water). */
  setInk(o: { colours?: InkColours }) {
    if (o.colours) this.colours = o.colours;
  }

  /**
   * A paragraph finished (Enter, the caret at x, y CSS px): in real water, a drop of ink lets go
   * from the surface beside your words (one side, then the other) — no more than one every few
   * seconds.
   */
  paragraph(x: number, _y: number) {
    if (!this.fx.inkScene || !this.fluid || this.inkStatic || this.arrival || !this.fx.full) return false;
    const now = this.fx.clock;
    if (now - this.lastDrip < 3800) return false;
    this.lastDrip = now;
    const H = Math.max(1, this.fx.H);
    const aspect = this.fx.W / H;
    const col = this.columnRect();
    const d = newDrop(Math.random, this.inkT + 0.05, aspect, null, this.inkScale * 0.85, this.colours);
    if (col) {
      this.dripLeft = !this.dripLeft;
      let left = this.dripLeft;
      // (to the side there's room for)
      if ((left ? col.x0 : aspect - col.x1) < 0.06) left = !left;
      const room = left ? col.x0 : aspect - col.x1;
      if (room > 0.06) d.x = left ? Math.max(0.035, col.x0 - rand(0.03, Math.min(0.12, room - 0.02))) : Math.min(aspect - 0.035, col.x1 + rand(0.03, Math.min(0.12, room - 0.02)));
      else d.x = x / H;
    }
    d.amount *= 0.8;
    this.inkBlooms.push(d);
    return true;
  }

  /**
   * New note, on paper: a drop of ink lands on the fresh page and blooms out under it as the page
   * develops, a ripple running out from it — then the water carries it off.
   */
  private inkNewPage() {
    const p = this.fx.panel;
    if (p.circle || !this.fx.inkScene) return;
    const x = p.x + p.w * rand(0.4, 0.6);
    const y = p.y + Math.min(p.h * 0.2, 150);
    this.inkLinger(900);
    const s = this.inkScale;
    this.inkBloom(x, y, { size: 0.045 * s, amount: 1.5, push: 0.2 * s, indigo: rand(0.2, 0.55), splash: true });
    this.inkRipple(x, y, 1);
    // and a few flecks of ink flicked off the nib
    if (this.fx.full) this.fx.burst(x, y, { count: 16, speed: 170, size: 1.4, life: 0.6, sparks: 0.25 });
  }

  /** At startup, in this scene: the water's first ink (now that there's a sky to draw it on). */
  start() {
    this.startInk();
  }

  supported() {
    // (without the simulation it's still paper)
    return true;
  }

  enter() {
    this.startInk();
  }

  leave() {
    this.endArrival();
    document.documentElement.removeAttribute("data-ink-water");
  }

  skyScale() {
    // Soft ink, but paper with a tooth to it: about one pixel per CSS pixel (less on phones).
    return Math.min(devicePixelRatio || 1, this.fx.small ? 1.1 : 1.25) * (this.fx.effective === "subtle" ? 0.75 : 1);
  }

  timeRate(lvl: FxLevel) {
    return (0.25 + 0.75 * this.fx.energy) * (lvl === "subtle" ? 0.35 : 1);
  }

  step(now: number, dt: number) {
    if (!this.inkStatic) this.stepInk(now, dt);
  }

  busy() {
    return true;
  }

  mustRender() {
    return true;
  }

  drawsSky() {
    return !this.inkStatic;
  }

  /** The simulation's steps have been run: start the next batch. */
  rendered() {
    this.inkSteps = [];
    this.inkReset = false;
  }

  behind() {
    this.fx.clearBehind();
  }

  /** Its part of the sky's frame. */
  frame() {
    return this.inkFrame();
  }

  newNote() {
    this.inkNewPage();
    return true;
  }
}
