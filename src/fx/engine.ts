import { mixRgb, oklchToRgb, to255, type RGB } from "./color";
import { Sky, type SceneId } from "./sky";
import { viewportHeight } from "../lib/platform";

/**
 * umbra's light engine. One animation loop drives three layers:
 *  - the sky (WebGL): nebula dust, stars, and the solar corona around the editor panel —
 *    or, in the rain scene, a night city seen through a wet window, with lightning — or a
 *    total solar eclipse, seen from the ground, over a bank of cloud
 *  - dust (2D, behind the UI): motes drifting through the corona light
 *  - overlay (2D, above the UI): sunbursts, flares, embers, light trails — splashes and drips in the rain
 * Everything is in CSS pixels; effects are fire-and-forget.
 */

export type FxLevel = "cosmic" | "subtle" | "off";
type C255 = [number, number, number];

type Particle = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  ax: number;
  ay: number;
  drag: number;
  life: number;
  max: number;
  delay: number;
  size: number;
  color: C255;
  alpha: number;
  kind: 0 | 1 | 2; // 0 spark streak · 1 glow mote · 2 flickering ember
  sink?: { x: number; y: number; k: number; swirl: number };
};

type Timed = { t0: number; dur: number };
type Ring = Timed & { x: number; y: number; r0: number; r1: number; color: C255; width: number; alpha: number };
type Flash = Timed & { x: number; y: number; r: number; color: C255; alpha: number };
type Rays = Timed & { x: number; y: number; n: number; r0: number; len: number; color: C255; spin: number; width: number };
type Ghost = Timed & { x: number; y: number; r: number; color: C255; alpha: number; hex: boolean };
type Streak = Timed & { x: number; y: number; w: number; color: C255; alpha: number };
type Beam = Timed & { x: number; y: number; color: C255 };
type Loop = Timed & { x: number; y: number; r: number; angle: number; spread: number; height: number; color: C255 };
type Trail = Timed & {
  from: { x: number; y: number };
  to: { x: number; y: number };
  ctrl: { x: number; y: number };
  color: C255;
  pts: { x: number; y: number }[];
  done?: () => void;
  fired?: boolean;
  quiet?: boolean;
};
type Mote = { x: number; y: number; z: number; vx: number; vy: number; size: number; phase: number };
/** A coronal loop erupting from the panel's edge (drawn behind the glass). */
type Cme = Timed & { x: number; y: number; nx: number; ny: number; tx: number; ty: number; span: number; height: number; tilt: number };
/** A shooting star burning up behind the glass. */
type Meteor = Timed & { x: number; y: number; vx: number; vy: number; size: number; color: C255; flareAt: number; wake: boolean; fireball: boolean };
/** The glowing wake a bright meteor leaves, slowly twisting in the upper-air wind. */
type Wake = Timed & { x0: number; y0: number; x1: number; y1: number; bend: number; width: number; color: C255 };
type Frag = { x: number; y: number; vx: number; vy: number; life: number; max: number; size: number; color: C255 };
/** A letter as it lands (white-hot, cooling to ink) or leaves (falling away as ash — or, in the rain, running off like a drip). */
type Glyph = Timed & { ch: string; x: number; y: number; font: string; ash: boolean; vx: number; spin: number; drip?: boolean };
/** A lightning strike: a few flickers of light, maybe with a bolt you can see. */
type Strike = { t0: number; pulses: { at: number; amp: number; tau: number }[]; x: number; seed: number; bolt: boolean };
export type RainOptions = { lightning: boolean; city: boolean; amount: number; blur: number };
/** The moon nudged a hair off the sun and back — [ms, offset in sun radii] keys. A diamond ring, or just a glimmer of Baily's beads. */
type Nudge = { t0: number; dir: { x: number; y: number }; keys: [number, number][]; spin?: number };

const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);
const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const clamp01 = (t: number) => Math.min(1, Math.max(0, t));
const rand = (a: number, b: number) => a + Math.random() * (b - a);
const WHITE: C255 = [255, 255, 255];
const WATER: C255 = [196, 222, 255];
const SUNLIGHT: C255 = [255, 222, 186];
const smooth = (a: number, b: number, x: number) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};

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

class FxEngine {
  level: FxLevel = "cosmic";
  private started = false;
  private raf = 0;
  private reduced = typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;
  private small = typeof matchMedia !== "undefined" && matchMedia("(pointer: coarse), (max-width: 820px)").matches;

  private skyCanvas: HTMLCanvasElement | null = null;
  private sky: Sky | null = null;
  private dustCanvas: HTMLCanvasElement | null = null;
  private dctx: CanvasRenderingContext2D | null = null;
  private overCanvas: HTMLCanvasElement | null = null;
  private octx: CanvasRenderingContext2D | null = null;

  private W = 0;
  private H = 0;
  private dpr = 1;
  private time = 0;
  private last = 0;
  private lastSky = 0;
  /** Effects run on a virtual clock (ms) so they can be slowed down for inspection. */
  private clock = 0;
  timeScale = 1;

  private mouse = { x: 0, y: 0 };
  private smouse = { x: 0, y: 0 };
  private panelEl: HTMLElement | null = null;
  private panelCircle: (() => { x: number; y: number; r: number }) | null = null;
  private panel = { x: 0, y: 0, w: 0, h: 0, r: 16, circle: false };
  private panelRadius = 16;

  private a: RGB = [0.7, 0.62, 1];
  private b: RGB = [0.3, 0.35, 0.8];
  private aTo: RGB = [0.7, 0.62, 1];
  private bTo: RGB = [0.3, 0.35, 0.8];

  private calm = false;
  /** The cursor as a light source (it can be turned off); eased so the change is a soft fade. */
  cursorLight = true;
  private cursorK = 1;
  /** Nothing drawn over the sky (the "Bare" background): the corona no longer outlines the panel. */
  private open = false;
  private openK = 0;
  /** When you last touched anything (fx clock). Left alone, the sky slowly wakes up. */
  private lastInput = 0;
  private energy = 1;
  private flare = 0;
  private dim = 0;
  private dimTarget = 0;
  private diamond = { x: 0, y: 0, v: 0 };
  private shocks: (Timed & { x: number; y: number; strength: number })[] = [];

  private particles: Particle[] = [];
  private rings: Ring[] = [];
  private flashes: Flash[] = [];
  private rays: Rays[] = [];
  private ghosts: Ghost[] = [];
  private streaks: Streak[] = [];
  private beams: Beam[] = [];
  private loops: Loop[] = [];
  private trails: Trail[] = [];
  private motes: Mote[] = [];
  private cmes: Cme[] = [];
  private nextCme = 5000;
  private meteors: Meteor[] = [];
  private wakes: Wake[] = [];
  private frags: Frag[] = [];
  private nextMeteor = 2600;
  private showerLeft = 0;
  private glyphs: Glyph[] = [];
  private inkBudget = 0;
  private overDirty = false;
  private sprites = new Map<string, HTMLCanvasElement>();
  /** Adaptive quality: the sky's render scale drops on slow machines, recovers on fast ones. */
  private skyScale = 1;
  private frameMs = 16;
  private slowFor = 0;
  private fastFor = 0;

  /** Which sky: the eclipse, or rain on the window. */
  scene: SceneId = "eclipse";
  private rainOpts: RainOptions = { lightning: true, city: true, amount: 0.5, blur: 1 };
  private blurK = 1;
  private wet = 1;
  private sceneFade = 1;
  private cityK = 1;
  private amountK = 0.5;
  private strikes: Strike[] = [];
  private nextStrike = 9000;
  private roomFlash = 0;
  private dustClear = false;
  /** A veil of light over everything, for the instant lightning lights up the room. */
  private room: HTMLDivElement | null = null;

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
  private solarOpts = { clouds: true, size: 0.5 };
  /** The Background setting ("dark" frosts the panels, so the sun keeps to the clearer right-hand column). */
  private backdrop = "dark";
  /** Where your writing ends, where the right-hand column starts and where its widgets end (CSS px), measured now and then. */
  private textRight = 0;
  private railLeft = 0;
  private railBottom = 0;
  private layoutAt = -1e9;
  private cloudsK = 1;

  // ── lifecycle ────────────────────────────────────────────────────────────

  init() {
    if (this.started || typeof document === "undefined") return;
    this.started = true;
    this.mouse = { x: innerWidth * 0.62, y: innerHeight * 0.3 };
    this.smouse = { ...this.mouse };

    this.skyCanvas = this.makeCanvas("fx-sky");
    this.sky = Sky.create(this.skyCanvas);
    if (!this.sky) this.skyCanvas.style.display = "none";
    // Rain needs a little more of the GPU; if this device can't draw it, stay with the eclipse.
    if (this.scene === "rain" && this.sky && !this.sky.rainReady()) this.scene = "eclipse";
    if (this.scene === "solar" && this.sky && !this.sky.solarReady()) this.scene = "eclipse";
    document.documentElement.dataset.scene = this.scene;
    this.dustCanvas = this.makeCanvas("fx-dust");
    this.dctx = this.dustCanvas.getContext("2d");
    this.overCanvas = this.makeCanvas("fx-over");
    this.octx = this.overCanvas.getContext("2d");
    document.body.prepend(this.dustCanvas);
    document.body.prepend(this.skyCanvas);
    document.body.append(this.overCanvas);
    this.room = document.createElement("div");
    this.room.className = "fx-room";
    this.room.setAttribute("aria-hidden", "true");
    this.room.style.display = "none";
    document.body.append(this.room);

    this.resize();
    addEventListener("resize", () => {
      this.resize();
      this.remeasure();
    });
    addEventListener("scroll", this.remeasure, { passive: true });
    visualViewport?.addEventListener("resize", this.remeasure);
    visualViewport?.addEventListener("scroll", this.remeasure);
    // The keyboard takes a moment to slide in or out, and the page can move at either end of that.
    for (const type of ["focusin", "focusout"] as const)
      addEventListener(type, () => {
        this.remeasure();
        window.setTimeout(this.remeasure, 350);
        window.setTimeout(this.remeasure, 800);
      });
    addEventListener(
      "pointermove",
      (e) => {
        this.mouse.x = e.clientX;
        this.mouse.y = e.clientY;
        this.lastInput = this.clock;
      },
      { passive: true },
    );
    for (const type of ["keydown", "pointerdown", "wheel"] as const) addEventListener(type, () => (this.lastInput = this.clock), { passive: true });
    this.seedMotes();
    this.applyLevel();
  }

  private makeCanvas(cls: string) {
    const c = document.createElement("canvas");
    c.className = cls;
    c.setAttribute("aria-hidden", "true");
    return c;
  }

  private resize() {
    this.W = innerWidth;
    this.H = viewportHeight();
    this.dpr = Math.min(devicePixelRatio || 1, 2);
    this.sizeSky();
    for (const [c, ctx] of [
      [this.dustCanvas, this.dctx],
      [this.overCanvas, this.octx],
    ] as const) {
      if (!c || !ctx) continue;
      c.width = Math.round(this.W * this.dpr);
      c.height = Math.round(this.H * this.dpr);
    }
    this.place();
    this.overDirty = true;
  }

  /**
   * Where the effect layers really are, in the same coordinates as everything we draw over.
   * Normally that's (0, 0). But a phone keyboard can scroll the page out from under the fixed
   * layers — and a letter's glow has to land on the letter, not a status bar's height above it.
   */
  private ox = 0;
  private oy = 0;
  private originRaf = 0;

  private measureOrigin() {
    const c = this.overCanvas;
    if (!c || c.style.display === "none") return;
    const r = c.getBoundingClientRect();
    const ox = Math.round(r.left * 4) / 4;
    const oy = Math.round(r.top * 4) / 4;
    if (ox === this.ox && oy === this.oy) return;
    this.ox = ox;
    this.oy = oy;
    this.place();
    this.overDirty = true;
    this.dustClear = true;
  }

  private remeasure = () => {
    if (!this.originRaf)
      this.originRaf = requestAnimationFrame(() => {
        this.originRaf = 0;
        this.measureOrigin();
      });
  };

  /** Draw in page coordinates: shift each 2D layer by however far it has been moved. */
  private place() {
    for (const ctx of [this.dctx, this.octx]) ctx?.setTransform(this.dpr, 0, 0, this.dpr, -this.ox * this.dpr, -this.oy * this.dpr);
  }

  /** Clears a whole 2D layer, wherever it has been shifted to. */
  private wipe(ctx: CanvasRenderingContext2D) {
    ctx.clearRect(this.ox, this.oy, this.W, this.H);
  }

  /** The offset of the effect layers from the page (see `measureOrigin`), for things placed over the page by hand. */
  get origin() {
    return { x: this.ox, y: this.oy };
  }

  private get baseSkyScale() {
    if (this.scene === "rain") {
      // Drops and falling rain need real resolution: up to 2x (1.6x on phones), within a pixel budget.
      const dpr = devicePixelRatio || 1;
      const budget = Math.sqrt(4.2e6 / Math.max(1, this.W * this.H));
      return Math.min(dpr, this.small ? 1.6 : 2, budget) * (this.effective === "subtle" ? 0.75 : 1);
    }
    if (this.scene === "solar") {
      // The clouds are drawn small anyway; the moon wants a crisp edge.
      return Math.min(devicePixelRatio || 1, this.small ? 1.25 : 1.35) * (this.effective === "subtle" ? 0.7 : 1);
    }
    return this.small ? 0.55 : Math.min(devicePixelRatio || 1, 1.25) * (this.effective === "subtle" ? 0.6 : 1);
  }

  /** Sizes the sky for the current scene, level and measured speed. */
  private sizeSky() {
    if (!this.sky) return;
    const scale = this.baseSkyScale * this.skyScale;
    this.sky.resize(this.W, this.H, scale);
    // The city behind the rain is soft, so it needs a little less than the glass in front of it.
    this.sky.cityScale = Math.min(1.15, Math.max(0.6, scale * 0.75));
    this.sky.quality = this.effective === "cosmic" && (!this.small || this.rain || this.solar) ? 1 : 0;
  }

  get rain() {
    return this.scene === "rain";
  }

  get solar() {
    return this.scene === "solar";
  }

  /** Switches the sky. The rain sets in gradually; `instant` skips that (e.g. at startup). */
  setScene(scene: SceneId, instant = false) {
    if (scene === this.scene) return;
    if (scene === "rain" && this.sky && !this.sky.rainReady()) scene = "eclipse";
    if (scene === "solar" && this.sky && !this.sky.solarReady()) scene = "eclipse";
    if (scene === this.scene) return;
    this.scene = scene;
    document.documentElement.dataset.scene = scene;
    if (scene !== "eclipse") {
      this.cmes = [];
      this.meteors = [];
      this.wakes = [];
      this.frags = [];
      this.dustClear = true;
    }
    if (scene === "rain") {
      this.wet = instant ? 1 : 0.15;
      this.sceneFade = instant ? 1 : 0.6;
      this.nextStrike = this.clock + rand(4000, 9000);
    } else {
      this.strikes = [];
      this.flashNow = 0;
      this.setRoomFlash(0);
    }
    if (scene === "solar") {
      this.solarFade = instant ? 1 : 0.55;
      this.nudges = [];
      this.eruption = null;
      this.coronaK = 1;
      this.nextGlint = this.clock + rand(12000, 25000);
      this.nextErupt = this.clock + rand(20000, 40000);
      this.nextDiamond = this.clock + rand(50000, 90000);
      // Straight to its spot (so a view transition's snapshot already has it there).
      this.sunPlaced = this.started;
      if (this.started) this.sun = this.sunHome();
    }
    if (this.started) this.sizeSky();
  }

  setSolar(o: Partial<{ clouds: boolean; size: number }>) {
    this.solarOpts = { ...this.solarOpts, ...o };
    if (!this.started) this.cloudsK = this.solarOpts.clouds ? 1 : 0;
  }

  setBackdrop(id: string) {
    this.backdrop = id;
  }

  /** How much nearer (or further) than usual the eclipse looks, from the Distance setting: 0.62 .. 1.62. */
  get sunScale() {
    return Math.pow(2, (Math.min(1, Math.max(0, this.solarOpts.size)) - 0.5) * 1.4);
  }

  /** Where the sun is (CSS px), for things that start from it. */
  get sunSpot() {
    return { ...this.sun };
  }

  setRain(o: Partial<RainOptions>) {
    this.rainOpts = { ...this.rainOpts, ...o };
    if (!this.started) {
      this.cityK = this.rainOpts.city ? 1 : 0;
      this.amountK = this.rainOpts.amount;
      this.blurK = this.rainOpts.blur;
    }
    if (!this.lightningOn) this.strikes = this.strikes.filter((s) => this.clock - s.t0 < 900);
  }

  /** Whether lightning may flash at all (never with reduced motion — it's a flashing light). */
  get lightningOn() {
    return this.rain && this.rainOpts.lightning && !this.reduced && this.effective !== "off";
  }

  /** Fades the sky up from dark — how a scene change looks where view transitions aren't used. */
  fadeSky(dur = 1000) {
    if (!this.active) return;
    const frames = [{ opacity: 0 }, { opacity: 1 }];
    const timing = { duration: dur, easing: "cubic-bezier(0.2, 0.8, 0.2, 1)" };
    this.skyCanvas?.animate(frames, timing);
    this.dustCanvas?.animate(frames, timing);
  }

  /** Renders the sky right now (so a view transition can capture the new scene). */
  renderNow() {
    if (!this.started || !this.sky) return;
    this.lastSky = -1e9;
    this.sky.invalidate();
    this.renderSky(this.clock);
  }

  /** Watches real frame times; trades sky resolution for smoothness when needed. */
  private adapt(realDt: number) {
    this.frameMs += (realDt * 1000 - this.frameMs) * 0.05;
    const floor = this.rain || this.solar ? 0.5 : 0.35;
    if (this.frameMs > 24 && this.skyScale > floor + 0.01) {
      this.slowFor += realDt;
      this.fastFor = 0;
      if (this.slowFor > 1.2) {
        this.skyScale = Math.max(floor, this.skyScale * 0.8);
        this.slowFor = 0;
        this.sizeSky();
      }
    } else if (this.frameMs < 13 && this.skyScale < 1) {
      this.fastFor += realDt;
      this.slowFor = 0;
      if (this.fastFor > 5) {
        this.skyScale = Math.min(1, this.skyScale * 1.2);
        this.fastFor = 0;
        this.sizeSky();
      }
    } else {
      this.slowFor = Math.max(0, this.slowFor - realDt);
      this.fastFor = Math.max(0, this.fastFor - realDt);
    }
  }

  private get effective(): FxLevel {
    if (this.level === "cosmic" && this.reduced) return "subtle";
    return this.level;
  }

  get active() {
    return this.started && this.effective !== "off";
  }

  get full() {
    return this.started && this.effective === "cosmic";
  }

  setLevel(level: FxLevel) {
    this.level = level;
    if (this.started) this.applyLevel();
  }

  private applyLevel() {
    const lvl = this.effective;
    const on = lvl !== "off";
    for (const c of [this.skyCanvas, this.dustCanvas, this.overCanvas]) if (c) c.style.display = on ? "" : "none";
    if (!this.sky && this.skyCanvas) this.skyCanvas.style.display = "none";
    document.documentElement.dataset.fx = lvl;
    this.resize();
    if (on && !this.raf) {
      this.last = performance.now();
      this.raf = requestAnimationFrame(this.frame);
    } else if (!on && this.raf) {
      cancelAnimationFrame(this.raf);
      this.raf = 0;
      this.clearAll();
    }
  }

  private clearAll() {
    this.strikes = [];
    this.flashNow = 0;
    this.setRoomFlash(0);
    this.glyphs = [];
    this.meteors = [];
    this.wakes = [];
    this.frags = [];
    this.particles = [];
    this.rings = [];
    this.flashes = [];
    this.rays = [];
    this.ghosts = [];
    this.streaks = [];
    this.beams = [];
    this.loops = [];
    this.trails = [];
    if (this.octx) this.wipe(this.octx);
  }

  setAccent(accent: string, secondary: string) {
    this.aTo = oklchToRgb(accent);
    this.bTo = oklchToRgb(secondary);
    if (!this.started) {
      this.a = [...this.aTo];
      this.b = [...this.bTo];
    }
  }

  /** The element the corona pours out from behind (the editor panel). */
  setPanel(el: HTMLElement | null) {
    this.panelEl = el;
    this.panelCircle = null;
    if (el) this.panelRadius = parseFloat(getComputedStyle(el).borderTopLeftRadius) || 16;
  }

  /** A circular "moon" instead (e.g. the shared-link page). */
  setMoon(fn: (() => { x: number; y: number; r: number }) | null) {
    this.panelCircle = fn;
    if (fn) this.panelEl = null;
  }

  setCalm(calm: boolean) {
    this.calm = calm;
  }

  setCursorLight(on: boolean) {
    this.cursorLight = on;
    if (!this.started) this.cursorK = on ? 1 : 0;
  }

  setOpen(open: boolean) {
    this.open = open;
    if (!this.started) this.openK = open ? 1 : 0;
  }

  // ── main loop ────────────────────────────────────────────────────────────

  /** The effects clock, in ms. */
  now() {
    return this.clock;
  }

  private frame = (real: number) => {
    this.raf = requestAnimationFrame(this.frame);
    const realDt = Math.min(0.25, (real - this.last) / 1000);
    const dt = Math.min(0.05, realDt) * this.timeScale;
    this.last = real;
    if (!document.hidden) this.adapt(realDt);
    this.clock += dt * 1000;
    const now = this.clock;
    const lvl = this.effective;

    // Ambient energy eases toward calm while you write — and swells when you leave it be.
    const idle = now - this.lastInput > 25000;
    const energyTo = this.calm ? 0.2 : idle ? 1.4 : 1;
    this.energy += (energyTo - this.energy) * Math.min(1, dt * (this.calm ? 1.2 : idle ? 0.35 : 3));
    // The eclipse slows and holds its breath while you write; rain just keeps falling; the clouds
    // under the solar eclipse drift on, a little slower.
    this.time += dt * (this.rain ? 1 : this.solar ? (0.45 + 0.55 * Math.min(1, this.energy)) * (lvl === "subtle" ? 0.6 : 1) : (0.25 + 0.75 * this.energy) * (lvl === "subtle" ? 0.35 : 1));
    this.smouse.x += (this.mouse.x - this.smouse.x) * Math.min(1, dt * 4);
    this.smouse.y += (this.mouse.y - this.smouse.y) * Math.min(1, dt * 4);
    for (let i = 0; i < 3; i++) {
      this.a[i] += (this.aTo[i] - this.a[i]) * Math.min(1, dt * 3);
      this.b[i] += (this.bTo[i] - this.b[i]) * Math.min(1, dt * 3);
    }
    this.flare *= Math.exp(-dt * 1.8);
    this.diamond.v *= Math.exp(-dt * 3.2);
    this.dim += (this.dimTarget - this.dim) * Math.min(1, dt * 5);
    this.cursorK += ((this.cursorLight ? 1 : 0) - this.cursorK) * Math.min(1, dt * 4);
    this.openK += ((this.open ? 1 : 0) - this.openK) * Math.min(1, dt * 3);
    this.inkBudget = Math.min(24, this.inkBudget + dt * 40);
    this.trackPanel();
    if (this.rain) this.stepRain(now, dt, idle);
    if (this.solar) this.stepSolar(now, dt, idle);

    // Sky: the eclipse drifts so slowly while you write that ~30fps is plenty then. Rain never
    // slows down — falling drops stutter visibly at anything less than every frame — and nor does
    // the solar eclipse while something's happening in it.
    const throttle = !this.rain && !this.solarBusy && this.energy < 0.4 ? 32 : 0;
    if (this.sky && (now - this.lastSky > throttle || this.flare > 0.02 || this.shocks.length || this.flashNow > 0.004)) {
      this.renderSky(now);
    }

    if (this.rain || this.solar) {
      this.drawDust(dt);
      this.drawOverlay(now, dt);
      return;
    }

    if (lvl === "cosmic" && !this.calm && !this.open && this.panelEl && now > this.nextCme) {
      this.spawnCme();
      this.nextCme = now + rand(7000, 15000) * (idle ? 0.55 : 1);
    }

    // Shooting stars — now and then a little shower of them.
    if (lvl === "cosmic" && !this.calm && now > this.nextMeteor) {
      this.meteor();
      if (this.showerLeft > 0) {
        this.showerLeft--;
        this.nextMeteor = now + rand(160, 520);
      } else if (Math.random() < 0.1) {
        this.showerLeft = 3 + ((Math.random() * 4) | 0);
        this.nextMeteor = now + rand(200, 420);
      } else this.nextMeteor = now + rand(2200, 6500) * (this.small ? 2 : 1) * (idle ? 0.45 : 1);
    }

    this.drawDust(dt);
    this.drawOverlay(now, dt);
  };

  private renderSky(now: number) {
    if (!this.sky) return;
    this.lastSky = now;
    this.shocks = this.shocks.filter((s) => now - s.t0 < s.dur);
    const bolt = this.strikes[this.strikes.length - 1];
    // Page coordinates → the sky's own (they differ only while a phone keyboard has moved things).
    const { ox, oy } = this;
    this.sky.render({
      scene: this.scene,
      time: this.time,
      mouse: { x: this.smouse.x - ox, y: this.smouse.y - oy },
      panel: { ...this.panel, x: this.panel.x - ox, y: this.panel.y - oy },
      a: this.a,
      b: this.b,
      energy: this.energy,
      flare: Math.min(1, this.flare),
      dim: this.dim,
      ring: { ...this.diamond, x: this.diamond.x - ox, y: this.diamond.y - oy },
      shocks: this.shocks.slice(-3).map((s) => ({ x: s.x - ox, y: s.y - oy, age: (now - s.t0) / s.dur, strength: s.strength })),
      cursor: this.cursorK,
      open: this.openK,
      rain: {
        flash: this.flashNow,
        boltX: bolt ? bolt.x : 0,
        boltSeed: bolt ? bolt.seed : 0,
        bolt: bolt?.bolt ? Math.min(1, this.flashNow * 2.2) : 0,
        amount: this.amountK,
        wet: this.wet,
        fog: 0.24 + this.amountK * 0.3,
        city: this.cityK,
        wind: 0.13 + 0.05 * Math.sin(this.time * 0.07) + 0.035 * Math.sin(this.time * 0.23 + 1),
        fade: this.sceneFade,
        blur: this.blurK,
      },
      solar: {
        sun: { x: this.sun.x - ox, y: this.sun.y - oy, r: this.sun.r },
        moon: this.moonNow,
        light: this.lightNow,
        glare: this.glareNow,
        corona: this.coronaK,
        erupt: this.eruptNow,
        fade: this.solarFade,
        clouds: this.cloudsK,
      },
    });
  }

  // ── the solar eclipse ────────────────────────────────────────────────────

  /**
   * Where the sun hangs. With room beside your writing (and panels you can see through), right
   * there in the open sky, a little above the middle of the screen. Otherwise over the right-hand
   * column, in the clear sky below its widgets (drifting down as the list grows). On a phone, low
   * on the right; on a friend's page, high over the note. The Distance setting brings it closer
   * or sends it further off.
   */
  private sunHome() {
    const W = this.W;
    const H = this.H;
    const m = Math.min(W, H);
    const near = this.sunScale;
    const fit = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
    if (this.panelCircle) {
      const r = fit(m * 0.08 * near, 30, 130);
      return { x: W / 2, y: Math.max(r * 2.3, H * 0.15), r };
    }
    if (this.small) {
      const r = fit(W * 0.12 * near, 28, 110);
      return { x: W * 0.62, y: H * 0.56, r };
    }
    const r0 = m * 0.088 * near;
    if (this.panelEl) {
      this.measureLayout();
      const gap = this.railLeft - this.textRight;
      if (this.backdrop !== "dark" && gap > Math.min(r0, 70) * 3.2) {
        // It keeps its bright inner ring clear of your words — unless you've asked for it closer,
        // when only the moon itself has to fit.
        const room = gap / (3.1 - 0.8 * Math.max(0, this.solarOpts.size - 0.5) * 2);
        return { x: this.textRight + gap / 2, y: H * 0.4, r: fit(Math.min(r0, room), 32, 170) };
      }
      const p = this.panel;
      const right = W - (p.x + p.w);
      if (right > 220) {
        const r = fit(Math.min(r0, right * 0.3), 34, 120);
        return { x: p.x + p.w + right / 2, y: fit(this.railBottom + r * 2.4, H * 0.42, H * 0.72), r };
      }
    }
    return { x: W * 0.76, y: H * 0.4, r: fit(r0, 32, 150) };
  }

  /** Where your writing ends and the right-hand column begins (and its widgets end), every so often. */
  private measureLayout() {
    const t = performance.now();
    if (t - this.layoutAt < 400) return;
    this.layoutAt = t;
    let right = 0;
    for (const el of document.querySelectorAll<HTMLElement>(".canvas .note-title, .canvas .prose")) right = Math.max(right, el.getBoundingClientRect().right);
    // no note open: about where one would be
    this.textRight = right || this.panel.x + this.panel.w / 2 + 330;
    const rail = document.querySelector<HTMLElement>(".app.has-rail .rail-inner");
    this.railLeft = rail ? rail.getBoundingClientRect().left : this.W;
    const last = rail?.lastElementChild;
    this.railBottom = last ? last.getBoundingClientRect().bottom : 0;
  }

  /** Something's moving in the solar sky, so it should be drawn every frame. */
  private get solarBusy() {
    return (
      this.solar &&
      (this.nudges.length > 0 || this.approach !== null || this.eruption !== null || this.solarFade < 0.995 || this.sunHold !== null || (this.cloudsK > 0 && this.cloudsK < 1))
    );
  }

  private stepSolar(now: number, dt: number, idle: boolean) {
    this.solarFade += (1 - this.solarFade) * Math.min(1, dt * 1.6);
    this.cloudsK += ((this.solarOpts.clouds ? 1 : 0) - this.cloudsK) * Math.min(1, dt * 1.8);
    if (Math.abs(this.cloudsK - (this.solarOpts.clouds ? 1 : 0)) < 0.002) this.cloudsK = this.solarOpts.clouds ? 1 : 0;
    const to = this.sunHold ?? this.sunHome();
    // The first time there's a page to hang it by, it goes straight there; after that it glides.
    const anchor = this.panelCircle ? "moon" : this.panelEl ? "panel" : "none";
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
      const lt = this.time;
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
    if (this.full && !document.hidden && !this.sunHold) {
      if (now > this.nextGlint) {
        this.glint();
        this.nextGlint = now + rand(16000, 36000) * (this.calm ? 2 : idle ? 0.7 : 1);
      }
      if (!this.calm && now > this.nextErupt) {
        this.erupt();
        this.nextErupt = now + rand(28000, 60000) * (idle ? 0.6 : 1);
      }
      if (idle && !this.calm && now > this.nextDiamond) {
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
    if (!this.solar || !this.active) return;
    const a = rand(0, Math.PI * 2);
    this.nudges.push({
      t0: this.clock,
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
    if (!this.solar || !this.full) return;
    this.eruption = { t0: this.clock, dur: rand(10000, 14000), angle: rand(0, Math.PI * 2), size: rand(0.85, 1.4) };
  }

  /**
   * New note, under the solar eclipse: the moon slips a hair off the sun. Baily's beads flicker
   * along its edge — then the sunlight bursts out at one point, the diamond ring. It lights the
   * clouds, flares across the lens, and fades as the moon slides back over.
   */
  private solarDiamond(strength = 1) {
    const s = this.sun;
    // It breaks out on the side facing the middle of the screen, more or less.
    const a = Math.atan2(this.H * 0.45 - s.y, this.W * 0.5 - s.x) + rand(-0.55, 0.55);
    const dir = { x: Math.cos(a), y: Math.sin(a) };
    const peak = 0.034 + 0.026 * strength;
    const burst = 520;
    this.nudges = [
      {
        t0: this.clock,
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
    if (!this.full) return;
    const s = this.sun;
    const x = at?.x ?? s.x + this.glareNow.x * s.r;
    const y = at?.y ?? s.y + this.glareNow.y * s.r;
    this.flash(x, y, Math.max(this.W, this.H) * 0.75, { dur: 1600, alpha: 0.13 * strength, color: SUNLIGHT, delay });
    this.flash(x, y, s.r * 1.4, { dur: 700, alpha: 0.75, color: WHITE, delay });
    const cx = this.W / 2;
    const cy = this.H / 2;
    const ghosts: [number, number, boolean, C255, number][] = [
      [0.32, 16, true, SUNLIGHT, 0.26],
      [0.58, 44, false, this.accentHot, 0.14],
      [0.84, 8, false, WHITE, 0.36],
      [1.16, 26, true, this.accent, 0.22],
      [1.46, 72, false, SUNLIGHT, 0.09],
      [1.74, 12, true, WHITE, 0.3],
    ];
    const t0 = this.clock + delay;
    ghosts.forEach(([k, r, hex, color, alpha], i) =>
      this.ghosts.push({ x: x + (cx - x) * k * 2, y: y + (cy - y) * k * 2, r, hex, color, alpha: alpha * strength, t0: t0 + i * 45, dur: 1400 }),
    );
    this.overDirty = true;
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

  // ── rain: the weather ────────────────────────────────────────────────────

  /** Lightning brightness this frame. */
  private flashNow = 0;

  private stepRain(now: number, dt: number, idle: boolean) {
    this.wet += (1 - this.wet) * Math.min(1, dt * 0.32);
    this.sceneFade += (1 - this.sceneFade) * Math.min(1, dt * 1.6);
    this.cityK += ((this.rainOpts.city ? 1 : 0) - this.cityK) * Math.min(1, dt * 1.4);
    this.amountK += (this.rainOpts.amount - this.amountK) * Math.min(1, dt * 0.8);
    this.blurK += (this.rainOpts.blur - this.blurK) * Math.min(1, dt * 6);

    // Now and then, lightning — but never while you're writing.
    if (this.lightningOn && !this.calm && !document.hidden && now > this.nextStrike) {
      const bolt = Math.random() < 0.38;
      this.strike({ bolt, power: bolt ? rand(0.6, 0.95) : rand(0.25, 0.45) });
      this.nextStrike = now + rand(11000, 34000) * (idle ? 0.6 : 1) * (1.25 - this.amountK * 0.5);
    }

    let f = 0;
    this.strikes = this.strikes.filter((s) => {
      const t = now - s.t0;
      let v = 0;
      let alive = false;
      for (const p of s.pulses) {
        const d = t - p.at;
        if (d < 0) {
          alive = true;
          continue;
        }
        const e = d < 28 ? d / 28 : Math.exp(-(d - 28) / p.tau);
        if (e > 0.002) alive = true;
        v += p.amp * e;
      }
      f = Math.max(f, v);
      return alive;
    });
    this.flashNow = f;
    // The room lights up too, just a little.
    this.setRoomFlash(Math.min(1, f));
  }

  private setRoomFlash(v: number) {
    const q = Math.round(v * 200) / 200;
    if (q === this.roomFlash || !this.room) return;
    this.roomFlash = q;
    this.room.style.display = q > 0 ? "" : "none";
    this.room.style.opacity = (q * 0.075).toFixed(4);
  }

  /**
   * A lightning strike. Distant ones are a flicker in the clouds; nearer ones show the bolt
   * itself. Flickers are kept slow and few (never more than three in a second).
   */
  strike(o: { bolt?: boolean; power?: number; x?: number } = {}) {
    if (!this.lightningOn) return false;
    const power = o.power ?? 0.8;
    const bolt = o.bolt ?? true;
    const aspect = this.W / Math.max(1, this.H);
    const x = o.x !== undefined ? o.x / Math.max(1, this.H) : rand(0.12, 0.88) * aspect;
    const pulses = [{ at: 0, amp: power * rand(0.45, 0.7), tau: 90 }];
    pulses.push({ at: rand(170, 260), amp: power, tau: bolt ? 150 : 210 });
    if (Math.random() < 0.6) pulses.push({ at: rand(520, 700), amp: power * rand(0.3, 0.55), tau: 260 });
    this.strikes.push({ t0: this.clock, pulses, x, seed: Math.random() * 100, bolt });
    if (this.strikes.length > 3) this.strikes.shift();
    return true;
  }

  private spawnCme() {
    const p = this.panel;
    const edges: [string, number][] = [
      ["top", p.w * 0.8],
      ["right", p.h],
      ["left", p.h],
    ];
    let pick = Math.random() * edges.reduce((a, e) => a + e[1], 0);
    let edge = "top";
    for (const [name, w] of edges) {
      pick -= w;
      if (pick <= 0) {
        edge = name;
        break;
      }
    }
    const f = rand(0.15, 0.85);
    const base =
      edge === "top"
        ? { x: p.x + p.w * f, y: p.y, nx: 0, ny: -1, tx: 1, ty: 0 }
        : edge === "right"
          ? { x: p.x + p.w, y: p.y + p.h * f, nx: 1, ny: 0, tx: 0, ty: 1 }
          : { x: p.x, y: p.y + p.h * f, nx: -1, ny: 0, tx: 0, ty: 1 };
    this.cmes.push({ ...base, span: rand(16, 34), height: rand(26, 58), tilt: rand(-0.5, 0.5), t0: this.clock, dur: 2800 });
    // Light the corona around the eruption.
    this.diamond.x = base.x;
    this.diamond.y = base.y;
    this.flareUp(0.4);
  }

  private drawCmes(ctx: CanvasRenderingContext2D) {
    const now = this.clock;
    const hot = this.accentHot.join(",");
    this.cmes = this.cmes.filter((c) => {
      const k = (now - c.t0) / c.dur;
      if (k >= 1) return false;
      const grow = easeOut(Math.min(1, k * 1.5));
      const fade = k < 0.5 ? 1 : 1 - (k - 0.5) / 0.5;
      for (const [scale, w, a] of [
        [1, 7, 0.12],
        [1, 1.8, 0.75],
        [0.62, 1.2, 0.5],
      ] as const) {
        const span = c.span * scale;
        const h = c.height * grow * scale * 1.7;
        const p0x = c.x - c.tx * span;
        const p0y = c.y - c.ty * span;
        const p2x = c.x + c.tx * span;
        const p2y = c.y + c.ty * span;
        const cx = c.x + c.nx * h + c.tx * c.tilt * h;
        const cy = c.y + c.ny * h + c.ty * c.tilt * h;
        ctx.strokeStyle = `rgba(${hot},${a * fade})`;
        ctx.lineWidth = w;
        ctx.beginPath();
        ctx.moveTo(p0x, p0y);
        ctx.quadraticCurveTo(cx, cy, p2x, p2y);
        ctx.stroke();
      }
      return true;
    });
  }

  private trackPanel() {
    if (this.panelCircle) {
      const c = this.panelCircle();
      this.panel = { x: c.x - c.r, y: c.y - c.r, w: c.r * 2, h: c.r * 2, r: c.r, circle: true };
      return;
    }
    const el = this.panelEl;
    if (el && el.isConnected) {
      const r = el.getBoundingClientRect();
      if (r.width > 0) this.panel = { x: r.left, y: r.top, w: r.width, h: r.height, r: this.panelRadius, circle: false };
    } else {
      // No panel: a dim, distant sun far below the horizon.
      this.panel = { x: this.W * 0.5 - 1, y: this.H * 1.6, w: 2, h: 2, r: 1, circle: false };
    }
  }

  // ── dust: motes drifting through the corona light (behind the UI) ────────

  private seedMotes() {
    const n = this.small ? 34 : this.effective === "subtle" ? 30 : 90;
    this.motes = Array.from({ length: n }, () => this.newMote(true));
  }

  private newMote(anywhere: boolean): Mote {
    const z = Math.random() * 0.8 + 0.2;
    return {
      x: Math.random() * this.W,
      y: anywhere ? Math.random() * this.H : this.H + 10,
      z,
      vx: rand(-5, 5) * z,
      vy: -rand(3, 13) * z,
      size: rand(0.5, 1.9) * (0.5 + z),
      phase: Math.random() * Math.PI * 2,
    };
  }

  private drawDust(dt: number) {
    const ctx = this.dctx;
    if (!ctx) return;
    if (this.rain || this.solar) {
      if (this.dustClear) this.wipe(ctx);
      this.dustClear = false;
      return;
    }
    this.wipe(ctx);
    ctx.globalCompositeOperation = "lighter";
    const tint = to255(mixRgb(this.a, [1, 1, 1], 0.55));
    const sprite = this.sprite(tint);
    const p = this.panel;
    const px = (this.smouse.x / Math.max(1, this.W) - 0.5) * 24;
    const py = (this.smouse.y / Math.max(1, this.H) - 0.5) * 24;
    const speed = 0.3 + 0.7 * this.energy;
    for (const m of this.motes) {
      m.x += m.vx * dt * speed;
      m.y += m.vy * dt * speed;
      m.phase += dt * (0.6 + m.z);
      if (m.y < -12 || m.x < -12 || m.x > this.W + 12) Object.assign(m, this.newMote(false));
      const x = m.x - px * m.z;
      const y = m.y - py * m.z;
      // Brighter where the corona light falls.
      const dx = Math.max(p.x - x, 0, x - (p.x + p.w));
      const dy = Math.max(p.y - y, 0, y - (p.y + p.h));
      const inside = dx === 0 && dy === 0 && !p.circle;
      if (inside && !this.open) continue;
      const edge = Math.hypot(dx, dy);
      const lit = Math.exp(-edge / 140) * (1 + this.flare * 2);
      const tw = 0.55 + 0.45 * Math.sin(m.phase * 2.1);
      const alpha = (0.1 + lit * 0.55) * tw * (0.4 + 0.6 * m.z);
      if (alpha < 0.01) continue;
      const s = m.size * (2.6 + lit * 2);
      ctx.globalAlpha = Math.min(1, alpha);
      ctx.drawImage(sprite, x - s, y - s, s * 2, s * 2);
    }
    ctx.globalAlpha = 1;
    if (this.cmes.length) this.drawCmes(ctx);
    if (this.meteors.length || this.wakes.length || this.frags.length) this.drawMeteors(ctx, dt);
    ctx.globalCompositeOperation = "source-over";
  }

  // ── shooting stars ───────────────────────────────────────────────────────

  /** Spawns one meteor, mostly where it can be seen: through the side glass or around the panel. */
  meteor(o: { fireball?: boolean } = {}) {
    if (!this.full || this.rain || this.solar) return;
    const p = this.panel;
    const left = Math.max(0, p.x);
    const right = Math.max(0, this.W - (p.x + p.w));
    let x: number;
    const r = Math.random() * (left + right + this.W * 0.25);
    if (p.circle || r > left + right) x = Math.random() * this.W;
    else if (r < left) x = Math.random() * left;
    else x = p.x + p.w + Math.random() * right;
    const y = rand(0.02, 0.62) * this.H;
    // Every meteor in a shower streams away from the same radiant, high up and off to the right.
    const rx = this.W * 1.15;
    const ry = -this.H * 0.4;
    let dx = x - rx;
    let dy = y - ry;
    const d = Math.hypot(dx, dy) || 1;
    const jitter = rand(-0.08, 0.08);
    dx = dx / d;
    dy = dy / d;
    const ux = dx * Math.cos(jitter) - dy * Math.sin(jitter);
    const uy = dx * Math.sin(jitter) + dy * Math.cos(jitter);
    const fireball = o.fireball ?? Math.random() < 0.06;
    const speed = fireball ? rand(380, 560) : rand(520, 980);
    const dur = fireball ? rand(1300, 1700) : rand(450, 1050);
    const hue = Math.random();
    const color: C255 = hue < 0.55 ? this.accentHot : hue < 0.8 ? to255(mixRgb(this.bTo, [1, 1, 1], 0.45)) : [255, 236, 214];
    this.meteors.push({
      x,
      y,
      vx: ux * speed,
      vy: uy * speed,
      size: fireball ? rand(2.2, 2.8) : rand(0.9, 1.7),
      color,
      flareAt: rand(0.55, 0.85),
      wake: fireball || Math.random() < 0.3,
      fireball,
      t0: this.clock,
      dur,
    });
  }

  private drawMeteors(ctx: CanvasRenderingContext2D, dt: number) {
    const now = this.clock;
    ctx.lineCap = "round";

    // Wakes, beneath: they linger, widen and twist as the wind takes them.
    this.wakes = this.wakes.filter((w) => {
      const k = (now - w.t0) / w.dur;
      if (k >= 1) return false;
      const a = Math.pow(1 - k, 1.6) * 0.2 * Math.min(1, k * 8);
      const dx = w.x1 - w.x0;
      const dy = w.y1 - w.y0;
      const b = w.bend * easeOut(k);
      const c = w.color.join(",");
      const g = ctx.createLinearGradient(w.x0, w.y0, w.x1, w.y1);
      g.addColorStop(0, `rgba(${c},0)`);
      g.addColorStop(0.55, `rgba(${c},${a})`);
      g.addColorStop(0.9, `rgba(${c},${a * 0.6})`);
      g.addColorStop(1, `rgba(${c},0)`);
      ctx.strokeStyle = g;
      ctx.lineWidth = w.width * (1 + k * 3);
      ctx.beginPath();
      ctx.moveTo(w.x0, w.y0);
      ctx.quadraticCurveTo((w.x0 + w.x1) / 2 - dy * b, (w.y0 + w.y1) / 2 + dx * b, w.x1, w.y1);
      ctx.stroke();
      return true;
    });

    this.meteors = this.meteors.filter((m) => {
      const k = (now - m.t0) / m.dur;
      const t = (Math.min(1, k) * m.dur) / 1000;
      const hx = m.x + m.vx * t;
      const hy = m.y + m.vy * t;
      if (k >= 1) {
        if (m.wake) {
          const from = 0.2 * t;
          this.wakes.push({
            x0: m.x + m.vx * from,
            y0: m.y + m.vy * from,
            x1: hx,
            y1: hy,
            bend: rand(-0.08, 0.08),
            width: m.fireball ? 2.4 : 1.4,
            color: m.color,
            t0: now,
            dur: m.fireball ? 3200 : rand(1600, 2400),
          });
        }
        return false;
      }
      // Brightens, flares near the end of its life, then gutters out.
      let b = Math.pow(Math.sin(Math.PI * k), 0.55);
      b *= 1 + (m.fireball ? 2.2 : 1.4) * Math.exp(-Math.pow((k - m.flareAt) / 0.07, 2));
      const speed = Math.hypot(m.vx, m.vy);
      const len = Math.min(speed * t, speed * (m.fireball ? 0.3 : 0.17));
      const ux = m.vx / speed;
      const uy = m.vy / speed;
      const tx = hx - ux * len;
      const ty = hy - uy * len;
      const c = m.color.join(",");
      const g = ctx.createLinearGradient(hx, hy, tx, ty);
      g.addColorStop(0, `rgba(255,255,255,${Math.min(1, b * 0.95)})`);
      g.addColorStop(0.22, `rgba(${c},${Math.min(1, b * 0.6)})`);
      g.addColorStop(1, `rgba(${c},0)`);
      ctx.strokeStyle = g;
      ctx.beginPath();
      ctx.moveTo(tx, ty);
      ctx.lineTo(hx, hy);
      ctx.lineWidth = m.size * 4;
      ctx.globalAlpha = 0.28;
      ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.lineWidth = m.size;
      ctx.stroke();
      const s = m.size * (3.5 + 4.5 * Math.min(2, b));
      ctx.globalAlpha = Math.min(1, b);
      ctx.drawImage(this.sprite(m.color), hx - s, hy - s, s * 2, s * 2);
      ctx.globalAlpha = 1;
      // Fireballs shed glowing fragments.
      if (m.fireball && Math.random() < dt * 45) {
        const life = rand(0.35, 0.8);
        this.frags.push({ x: hx, y: hy, vx: m.vx * rand(0.1, 0.3) + rand(-20, 20), vy: m.vy * rand(0.1, 0.3) + rand(-20, 20), life, max: life, size: rand(0.8, 1.6), color: m.color });
      }
      return true;
    });

    this.frags = this.frags.filter((f) => {
      f.life -= dt;
      if (f.life <= 0) return false;
      f.x += f.vx * dt;
      f.y += f.vy * dt;
      f.vx *= 0.96;
      f.vy *= 0.96;
      const s = f.size * 3;
      ctx.globalAlpha = (f.life / f.max) * 0.85;
      ctx.drawImage(this.sprite(f.color), f.x - s, f.y - s, s * 2, s * 2);
      return true;
    });
    ctx.globalAlpha = 1;
  }

  // ── overlay: the effects above the UI ────────────────────────────────────

  private sprite(c: C255): HTMLCanvasElement {
    const key = c.join(",");
    let s = this.sprites.get(key);
    if (!s) {
      s = document.createElement("canvas");
      s.width = s.height = 64;
      const g = s.getContext("2d")!;
      const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
      grad.addColorStop(0, "rgba(255,255,255,1)");
      grad.addColorStop(0.16, `rgba(${key},0.95)`);
      grad.addColorStop(0.42, `rgba(${key},0.28)`);
      grad.addColorStop(1, `rgba(${key},0)`);
      g.fillStyle = grad;
      g.fillRect(0, 0, 64, 64);
      this.sprites.set(key, s);
    }
    return s;
  }

  /** A drop of water catching the light: a bright glint up top, a thin lit rim, dark inside. */
  private dropSprite(c: C255): HTMLCanvasElement {
    const key = `drop:${c.join(",")}`;
    let s = this.sprites.get(key);
    if (!s) {
      s = document.createElement("canvas");
      s.width = s.height = 64;
      const g = s.getContext("2d")!;
      const halo = g.createRadialGradient(32, 32, 8, 32, 32, 32);
      halo.addColorStop(0, `rgba(${c.join(",")},0.22)`);
      halo.addColorStop(1, `rgba(${c.join(",")},0)`);
      g.fillStyle = halo;
      g.fillRect(0, 0, 64, 64);
      g.lineWidth = 2.2;
      g.strokeStyle = `rgba(${c.join(",")},0.75)`;
      g.beginPath();
      g.arc(32, 32, 11, 0, Math.PI * 2);
      g.stroke();
      const glint = g.createRadialGradient(27, 26, 0, 27, 26, 7);
      glint.addColorStop(0, "rgba(255,255,255,1)");
      glint.addColorStop(1, "rgba(255,255,255,0)");
      g.fillStyle = glint;
      g.fillRect(16, 15, 22, 22);
      this.sprites.set(key, s);
    }
    return s;
  }

  private get maxParticles() {
    if (this.effective === "subtle") return 420;
    return this.small ? 700 : 2600;
  }

  private drawOverlay(now: number, dt: number) {
    const ctx = this.octx;
    if (!ctx) return;
    const busy =
      this.particles.length ||
      this.rings.length ||
      this.flashes.length ||
      this.rays.length ||
      this.ghosts.length ||
      this.streaks.length ||
      this.beams.length ||
      this.loops.length ||
      this.trails.length ||
      this.glyphs.length;
    if (!busy && !this.overDirty) return;
    this.overDirty = Boolean(busy);
    this.wipe(ctx);
    if (!busy) return;
    ctx.globalCompositeOperation = "lighter";

    const age = (t: Timed) => (now - t.t0) / t.dur;

    // Flashes
    this.flashes = this.flashes.filter((f) => {
      const k = age(f);
      if (k >= 1) return false;
      if (k < 0) return true;
      const a = f.alpha * Math.pow(1 - k, 2);
      const g = ctx.createRadialGradient(f.x, f.y, 0, f.x, f.y, f.r * (0.6 + 0.4 * easeOut(k)));
      g.addColorStop(0, `rgba(255,255,255,${a})`);
      g.addColorStop(0.25, `rgba(${f.color.join(",")},${a * 0.6})`);
      g.addColorStop(1, `rgba(${f.color.join(",")},0)`);
      ctx.fillStyle = g;
      ctx.fillRect(f.x - f.r, f.y - f.r, f.r * 2, f.r * 2);
      return true;
    });

    // Anamorphic streaks
    this.streaks = this.streaks.filter((s) => {
      const k = age(s);
      if (k >= 1) return false;
      if (k < 0) return true;
      const a = s.alpha * Math.pow(1 - k, 1.6);
      const w = s.w * (0.7 + 0.3 * easeOut(k));
      const g = ctx.createLinearGradient(s.x - w, 0, s.x + w, 0);
      g.addColorStop(0, `rgba(${s.color.join(",")},0)`);
      g.addColorStop(0.5, `rgba(255,255,255,${a})`);
      g.addColorStop(1, `rgba(${s.color.join(",")},0)`);
      ctx.fillStyle = g;
      ctx.fillRect(s.x - w, s.y - 1.2, w * 2, 2.4);
      ctx.globalAlpha = 0.35;
      ctx.fillRect(s.x - w * 0.6, s.y - 5, w * 1.2, 10);
      ctx.globalAlpha = 1;
      return true;
    });

    // Lens-flare ghosts
    this.ghosts = this.ghosts.filter((gh) => {
      const k = age(gh);
      if (k >= 1) return false;
      if (k < 0) return true;
      const a = gh.alpha * Math.sin(Math.PI * Math.min(1, k * 1.2));
      const g = ctx.createRadialGradient(gh.x, gh.y, gh.r * 0.2, gh.x, gh.y, gh.r);
      g.addColorStop(0, `rgba(${gh.color.join(",")},${a * 0.25})`);
      g.addColorStop(0.85, `rgba(${gh.color.join(",")},${a})`);
      g.addColorStop(1, `rgba(${gh.color.join(",")},0)`);
      ctx.fillStyle = g;
      ctx.beginPath();
      if (gh.hex) {
        for (let i = 0; i < 6; i++) {
          const an = (i / 6) * Math.PI * 2 + Math.PI / 6;
          const fn = i ? ctx.lineTo.bind(ctx) : ctx.moveTo.bind(ctx);
          fn(gh.x + Math.cos(an) * gh.r, gh.y + Math.sin(an) * gh.r);
        }
        ctx.closePath();
      } else ctx.arc(gh.x, gh.y, gh.r, 0, Math.PI * 2);
      ctx.fill();
      return true;
    });

    // Rings
    this.rings = this.rings.filter((r) => {
      const k = age(r);
      if (k >= 1) return false;
      if (k < 0) return true;
      const rad = r.r0 + (r.r1 - r.r0) * easeOut(k);
      ctx.strokeStyle = `rgba(${r.color.join(",")},${r.alpha * Math.pow(1 - k, 2)})`;
      ctx.lineWidth = r.width * (1 - k * 0.6);
      ctx.beginPath();
      ctx.arc(r.x, r.y, rad, 0, Math.PI * 2);
      ctx.stroke();
      return true;
    });

    // Sunburst rays
    ctx.lineCap = "round";
    this.rays = this.rays.filter((r) => {
      const k = age(r);
      if (k >= 1) return false;
      if (k < 0) return true;
      const e = easeOut(k);
      const a = Math.pow(1 - k, 1.5);
      for (let i = 0; i < r.n; i++) {
        const an = (i / r.n) * Math.PI * 2 + r.spin * e;
        const long = i % 2 ? 0.62 : 1;
        const r0 = r.r0 + r.len * 0.35 * e;
        const r1 = r.r0 + r.len * long * e;
        ctx.strokeStyle = `rgba(${r.color.join(",")},${a})`;
        ctx.lineWidth = r.width * (1 - k * 0.7);
        ctx.beginPath();
        ctx.moveTo(r.x + Math.cos(an) * r0, r.y + Math.sin(an) * r0);
        ctx.lineTo(r.x + Math.cos(an) * r1, r.y + Math.sin(an) * r1);
        ctx.stroke();
      }
      return true;
    });

    // Beams of light (share)
    this.beams = this.beams.filter((b) => {
      const k = age(b);
      if (k >= 1) return false;
      if (k < 0) return true;
      const grow = easeOut(Math.min(1, k * 2.4));
      const a = Math.pow(1 - k, 1.4);
      const top = b.y - (b.y + 40) * grow;
      for (const [w, alpha] of [
        [26, 0.12],
        [9, 0.3],
        [2.2, 0.95],
      ] as const) {
        const g = ctx.createLinearGradient(0, b.y, 0, top);
        g.addColorStop(0, `rgba(255,255,255,${alpha * a})`);
        g.addColorStop(0.3, `rgba(${b.color.join(",")},${alpha * a})`);
        g.addColorStop(1, `rgba(${b.color.join(",")},0)`);
        ctx.fillStyle = g;
        ctx.fillRect(b.x - w / 2, top, w, b.y - top);
      }
      return true;
    });

    // Solar prominences (countdown day)
    this.loops = this.loops.filter((l) => {
      const k = age(l);
      if (k >= 1) return false;
      if (k < 0) return true;
      const grow = easeOut(Math.min(1, k * 1.6));
      const a = k < 0.6 ? 1 : 1 - (k - 0.6) / 0.4;
      const p0 = { x: l.x + Math.cos(l.angle - l.spread) * l.r, y: l.y + Math.sin(l.angle - l.spread) * l.r };
      const p2 = { x: l.x + Math.cos(l.angle + l.spread) * l.r, y: l.y + Math.sin(l.angle + l.spread) * l.r };
      const h = l.r + l.height * grow;
      const c = { x: l.x + Math.cos(l.angle) * h * 1.35, y: l.y + Math.sin(l.angle) * h * 1.35 };
      const steps = 22;
      const upto = Math.max(2, Math.round(steps * Math.min(1, k * 2)));
      for (const [w, alpha] of [
        [5, 0.16],
        [1.6, 0.85],
      ] as const) {
        ctx.strokeStyle = `rgba(${l.color.join(",")},${alpha * a})`;
        ctx.lineWidth = w;
        ctx.beginPath();
        for (let i = 0; i <= upto; i++) {
          const t = i / steps;
          const x = (1 - t) * (1 - t) * p0.x + 2 * (1 - t) * t * c.x + t * t * p2.x;
          const y = (1 - t) * (1 - t) * p0.y + 2 * (1 - t) * t * c.y + t * t * p2.y;
          if (i) ctx.lineTo(x, y);
          else ctx.moveTo(x, y);
        }
        ctx.stroke();
      }
      return true;
    });

    // Light trails
    this.trails = this.trails.filter((tr) => {
      const k = clamp01(age(tr));
      const e = easeInOut(Math.min(1, k * 1.25));
      const t = e;
      const head = {
        x: (1 - t) * (1 - t) * tr.from.x + 2 * (1 - t) * t * tr.ctrl.x + t * t * tr.to.x,
        y: (1 - t) * (1 - t) * tr.from.y + 2 * (1 - t) * t * tr.ctrl.y + t * t * tr.to.y,
      };
      if (k * 1.25 < 1) tr.pts.push(head);
      if (tr.pts.length > 26) tr.pts.shift();
      if (k * 1.25 >= 1 && !tr.fired) {
        tr.fired = true;
        if (!tr.quiet) this.burst(tr.to.x, tr.to.y, { count: 14, speed: 120, size: 1.6, life: 0.5, colors: [tr.color, WHITE] });
        tr.done?.();
      }
      if (tr.fired) tr.pts.shift();
      const n = tr.pts.length;
      for (let i = 1; i < n; i++) {
        const f = i / n;
        ctx.strokeStyle = `rgba(${tr.color.join(",")},${f * (tr.quiet ? 0.5 : 0.9)})`;
        ctx.lineWidth = (0.6 + f * 2.6) * (tr.quiet ? 0.6 : 1);
        ctx.beginPath();
        ctx.moveTo(tr.pts[i - 1].x, tr.pts[i - 1].y);
        ctx.lineTo(tr.pts[i].x, tr.pts[i].y);
        ctx.stroke();
      }
      if (n && !tr.fired) {
        const h = tr.pts[n - 1];
        const s = 9;
        ctx.drawImage(this.sprite(tr.color), h.x - s, h.y - s, s * 2, s * 2);
      }
      return !(tr.fired && tr.pts.length === 0) && k < 2;
    });

    // Letters: white-hot as they land, or falling away as ash.
    if (this.glyphs.length) {
      const hot = this.accentHot.join(",");
      const acc = this.accent.join(",");
      ctx.textBaseline = "alphabetic";
      this.glyphs = this.glyphs.filter((g) => {
        const k = age(g);
        if (k >= 1) return false;
        if (k < 0) return true;
        ctx.font = g.font;
        if (g.drip) {
          // In the rain, an erased letter runs off the page like a drip of ink.
          const t = (k * g.dur) / 1000;
          const a = Math.pow(1 - k, 1.4) * 0.8;
          ctx.save();
          ctx.translate(g.x, g.y + 150 * t * t + 6 * t);
          ctx.scale(1 - k * 0.25, 1 + k * 1.1);
          ctx.shadowColor = `rgba(${acc},${a * 0.5})`;
          ctx.shadowBlur = 6;
          ctx.fillStyle = `rgba(${WATER.join(",")},${a})`;
          ctx.fillText(g.ch, 0, 0);
          ctx.restore();
        } else if (g.ash) {
          const t = (k * g.dur) / 1000;
          const a = Math.pow(1 - k, 1.5) * 0.75;
          ctx.save();
          ctx.translate(g.x + g.vx * t, g.y + 70 * t * t + 8 * t);
          ctx.rotate(g.spin * k);
          ctx.shadowColor = `rgba(${acc},${a * 0.6 * (1 - k)})`;
          ctx.shadowBlur = 8;
          ctx.fillStyle = `rgba(150,150,166,${a})`;
          ctx.fillText(g.ch, 0, 0);
          ctx.restore();
        } else {
          const a = Math.pow(1 - k, 2.2);
          ctx.shadowColor = `rgba(${acc},${Math.min(1, a * 1.2)})`;
          ctx.shadowBlur = 4 + 14 * a;
          ctx.fillStyle = `rgba(${hot},${a * 0.95})`;
          ctx.fillText(g.ch, g.x, g.y);
        }
        return true;
      });
      ctx.shadowBlur = 0;
      ctx.shadowColor = "transparent";
    }

    // Particles
    const next: Particle[] = [];
    for (const p of this.particles) {
      if (p.delay > 0) {
        p.delay -= dt;
        next.push(p);
        continue;
      }
      p.life -= dt;
      if (p.life <= 0) continue;
      if (p.sink) {
        const dx = p.sink.x - p.x;
        const dy = p.sink.y - p.y;
        const d = Math.max(14, Math.hypot(dx, dy));
        if (d < 16) continue;
        const pull = p.sink.k / d;
        p.vx += ((dx / d) * pull - (dy / d) * pull * p.sink.swirl) * dt;
        p.vy += ((dy / d) * pull + (dx / d) * pull * p.sink.swirl) * dt;
      }
      p.vx += p.ax * dt;
      p.vy += p.ay * dt;
      const dragK = Math.pow(p.drag, dt * 60);
      p.vx *= dragK;
      p.vy *= dragK;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      const lifeK = p.life / p.max;
      let a = p.alpha * (lifeK < 0.35 ? lifeK / 0.35 : 1);
      if (p.kind === 2) a *= 0.6 + 0.4 * Math.sin(p.life * 40 + p.x);
      if (p.kind === 0) {
        ctx.strokeStyle = `rgba(${p.color.join(",")},${a})`;
        ctx.lineWidth = p.size;
        ctx.beginPath();
        ctx.moveTo(p.x - p.vx * 0.035, p.y - p.vy * 0.035);
        ctx.lineTo(p.x, p.y);
        ctx.stroke();
      } else {
        const s = p.size * 3.2;
        ctx.globalAlpha = Math.min(1, a);
        ctx.drawImage(this.rain ? this.dropSprite(p.color) : this.sprite(p.color), p.x - s, p.y - s, s * 2, s * 2);
        ctx.globalAlpha = 1;
      }
      next.push(p);
    }
    this.particles = next;

    // Nothing stops at a hard line along the top of the screen: the topmost strip fades out,
    // so light arriving from up there (the diamond ring, a beam) seems to pour in from beyond it.
    const fade = 34;
    const top = ctx.createLinearGradient(0, this.oy, 0, this.oy + fade);
    top.addColorStop(0, "rgba(0,0,0,1)");
    top.addColorStop(0.3, "rgba(0,0,0,0.62)");
    top.addColorStop(0.65, "rgba(0,0,0,0.2)");
    top.addColorStop(1, "rgba(0,0,0,0)");
    ctx.globalCompositeOperation = "destination-out";
    ctx.fillStyle = top;
    ctx.fillRect(this.ox, this.oy, this.W, fade);
    ctx.globalCompositeOperation = "source-over";
  }

  // ── primitives ───────────────────────────────────────────────────────────

  get accent(): C255 {
    return to255(this.aTo);
  }

  get accentHot(): C255 {
    return to255(mixRgb(this.aTo, [1, 1, 1], 0.5));
  }

  get secondary(): C255 {
    return to255(this.bTo);
  }

  private add(p: Partial<Particle> & { x: number; y: number }) {
    if (this.particles.length >= this.maxParticles) return;
    this.particles.push({
      vx: 0,
      vy: 0,
      ax: 0,
      ay: 0,
      drag: 0.96,
      life: 0.8,
      max: 0.8,
      delay: 0,
      size: 2,
      color: WHITE,
      alpha: 1,
      kind: 1,
      ...p,
    } as Particle);
    this.overDirty = true;
  }

  burst(x: number, y: number, o: { count?: number; speed?: number; size?: number; life?: number; colors?: C255[]; gravity?: number; sparks?: number; spread?: number; angle?: number } = {}) {
    if (!this.active) return;
    const scale = this.full ? 1 : 0.4;
    const count = Math.round((o.count ?? 24) * scale);
    // In the rain, every burst is a splash: droplets that arc and fall.
    const wet = this.rain;
    const colors = o.colors ?? (wet ? [WATER, WHITE, this.accentHot] : [this.accent, this.accentHot, WHITE]);
    const spread = o.spread ?? Math.PI * 2;
    const base = o.angle ?? 0;
    for (let i = 0; i < count; i++) {
      const an = base - spread / 2 + Math.random() * spread;
      const sp = (o.speed ?? 180) * rand(0.35, 1);
      const life = (o.life ?? 0.8) * rand(0.6, 1.1);
      const spark = Math.random() < (o.sparks ?? 0.45);
      this.add({
        x,
        y,
        vx: Math.cos(an) * sp,
        vy: Math.sin(an) * sp,
        ay: o.gravity ?? (wet ? 820 : 0),
        drag: wet ? 0.975 : spark ? 0.93 : 0.95,
        life,
        max: life,
        size: (o.size ?? 2) * rand(0.6, 1.2) * (spark ? 0.7 : 1),
        color: colors[(Math.random() * colors.length) | 0],
        kind: spark ? 0 : 1,
      });
    }
  }

  ring(x: number, y: number, r0: number, r1: number, o: { dur?: number; color?: C255; width?: number; alpha?: number; delay?: number } = {}) {
    if (!this.active) return;
    this.rings.push({ x, y, r0, r1, t0: this.clock + (o.delay ?? 0), dur: o.dur ?? 600, color: o.color ?? this.accentHot, width: o.width ?? 1.6, alpha: o.alpha ?? 0.9 });
    this.overDirty = true;
  }

  flash(x: number, y: number, r: number, o: { dur?: number; alpha?: number; color?: C255; delay?: number } = {}) {
    if (!this.active) return;
    this.flashes.push({ x, y, r, t0: this.clock + (o.delay ?? 0), dur: o.dur ?? 500, color: o.color ?? this.accent, alpha: o.alpha ?? 0.5 });
    this.overDirty = true;
  }

  shockwave(x: number, y: number, strength = 1, dur = 1400) {
    if (!this.active) return;
    this.shocks.push({ x, y, t0: this.clock, dur, strength });
  }

  flareUp(amount = 1) {
    this.flare = Math.max(this.flare, amount);
  }

  setDim(v: number) {
    this.dimTarget = v;
  }

  // ── signature effects ────────────────────────────────────────────────────

  /** New note: the diamond ring — the instant sunlight bursts from behind the moon. */
  diamondRing() {
    if (!this.active) return;
    if (this.rain) {
      this.thunderclap();
      return;
    }
    if (this.solar) {
      this.solarDiamond();
      return;
    }
    const p = this.panel;
    // On the page's top edge, near the middle (its light washes down over the whole page).
    let x = p.x + p.w * rand(0.44, 0.56);
    let y = p.y + 1;
    if (p.circle) {
      // On a moon: wherever its rim is actually on screen (bottom if it hangs above the page).
      const cx = p.x + p.w / 2;
      const cy = p.y + p.h / 2;
      const ang = (cy < 0 ? Math.PI / 2 : -Math.PI / 2) + rand(-0.45, 0.45);
      x = cx + Math.cos(ang) * p.r;
      y = cy + Math.sin(ang) * p.r;
    }
    this.diamond = { x, y, v: 1 };
    this.flareUp(1);
    this.shockwave(x, y, 1.1, 1600);
    if (!this.full) {
      this.flash(x, y, 160, { alpha: 0.45 });
      return;
    }
    const now = this.clock;
    // The wash of light falls down into the page from the rim, rather than sitting on the edge.
    this.flash(x, y + Math.min(this.H * 0.08, 70), Math.max(this.W, this.H) * 0.55, { dur: 900, alpha: 0.3, color: this.accent });
    this.flash(x, y, 84, { dur: 500, alpha: 0.85, color: WHITE });
    this.streaks.push({ x, y: y + 2, w: this.W * 0.42, t0: now, dur: 900, color: this.accentHot, alpha: 0.85 });
    // Ghost reflections march across the "lens" through the screen center.
    const cx = this.W / 2;
    const cy = this.H / 2;
    const ghosts: [number, number, boolean, C255, number][] = [
      [0.3, 20, true, this.accentHot, 0.34],
      [0.55, 52, false, this.secondary, 0.2],
      [0.85, 9, false, WHITE, 0.45],
      [1.18, 30, true, this.accent, 0.3],
      [1.45, 84, false, this.accentHot, 0.12],
      [1.72, 14, true, WHITE, 0.38],
    ];
    ghosts.forEach(([k, r, hex, color, alpha], i) => this.ghosts.push({ x: x + (cx - x) * k * 2, y: y + (cy - y) * k * 2, r, hex, color, alpha, t0: now + i * 40, dur: 1100 }));
    this.rays.push({ x, y, n: 16, r0: 6, len: 90, color: this.accentHot, spin: 0.3, width: 1.4, t0: now, dur: 700 });
    this.burst(x, y, { count: 70, speed: 420, size: 2, life: 1.1, sparks: 0.7 });
    this.overDirty = true;
  }

  /**
   * New note, in the rain: lightning, close — the bolt, the flash, the room lit up for an
   * instant, the glass shivering. Without lightning, a big drop hits the glass instead.
   */
  private thunderclap() {
    const p = this.panel;
    const x = p.circle ? p.x + p.w / 2 : p.x + p.w * rand(0.55, 0.9);
    const y = p.circle ? Math.min(this.H * 0.4, Math.max(40, p.y + p.h)) : Math.max(30, p.y + 1);
    if (this.strike({ bolt: true, power: 1, x: x + rand(-80, 80) })) {
      this.shockwave(x, y, 0.9, 1800);
      if (this.full) this.burst(x, y, { count: 26, speed: 260, size: 1.6, life: 1, angle: -Math.PI / 2, spread: Math.PI * 0.9 });
      return;
    }
    this.splash(x, y, 1.6);
  }

  /** A drop hits: rings spread, a crown of droplets leaps up and falls back, and the glass ripples. */
  splash(x: number, y: number, size = 1) {
    if (!this.active) return;
    this.ring(x, y, 4 * size, 30 * size, { dur: 620, width: 1.3, color: WATER, alpha: 0.8 });
    this.ring(x, y, 3 * size, 52 * size, { dur: 900, delay: 110, width: 1, color: WATER, alpha: 0.42 });
    if (this.full) this.ring(x, y, 2 * size, 76 * size, { dur: 1150, delay: 230, width: 0.8, color: this.accentHot, alpha: 0.22 });
    this.flash(x, y, 40 * size, { dur: 360, alpha: 0.38, color: WATER });
    this.shockwave(x, y, 0.35 * size, 1300);
    this.burst(x, y, { count: Math.round(16 * size), speed: 175 * Math.sqrt(size), size: 1.5, life: 0.8, angle: -Math.PI / 2, spread: Math.PI * 0.85, sparks: 0.35 });
  }

  /** Checking off a to-do: a tiny sunburst — a splash, in the rain. */
  sunburst(x: number, y: number) {
    if (!this.active) return;
    if (this.rain) {
      this.splash(x, y);
      return;
    }
    const now = this.clock;
    this.rays.push({ x, y, n: 12, r0: 11, len: this.full ? 26 : 16, color: this.accentHot, spin: 0.35, width: 1.5, t0: now, dur: 520 });
    this.ring(x, y, 9, 34, { dur: 520, width: 1.4 });
    this.flash(x, y, 46, { dur: 380, alpha: 0.55 });
    this.burst(x, y, { count: 18, speed: 150, size: 1.7, life: 0.65, sparks: 0.5 });
  }

  /** A soft flourish of light (sharing, saving a copy). In a storm, it calls down the lightning. */
  beam(x: number, y: number) {
    if (!this.active) return;
    if (this.rain) {
      this.strike({ bolt: true, power: 0.85, x: x + rand(-140, 140) });
      this.splash(x, y, 1.3);
      return;
    }
    const now = this.clock;
    this.beams.push({ x, y, t0: now, dur: 1100, color: this.accentHot });
    this.ring(x, y, 6, 70, { dur: 700 });
    this.ring(x, y, 6, 120, { dur: 900, delay: 120, alpha: 0.6 });
    this.ring(x, y, 6, 170, { dur: 1100, delay: 240, alpha: 0.35 });
    this.shockwave(x, y, 0.7, 1300);
    for (let i = 0; i < (this.full ? 46 : 14); i++) {
      this.add({
        x: x + rand(-4, 4),
        y,
        vx: rand(-14, 14),
        vy: -rand(300, 900),
        drag: 0.985,
        life: rand(0.5, 1.1),
        max: 1.1,
        size: rand(0.8, 1.8),
        color: Math.random() < 0.5 ? WHITE : this.accentHot,
        kind: 0,
        delay: Math.random() * 0.25,
      });
    }
  }

  /** Solar prominence: an arc of light erupting from a small eclipse. (In the rain: a drop and its rings.) */
  prominence(x: number, y: number, r: number) {
    if (!this.full) return;
    if (this.rain) {
      this.ring(x, y, r * 0.8, r * 2.6, { dur: 950, color: WATER, width: 1, alpha: 0.6 });
      this.ring(x, y, r * 0.6, r * 3.6, { dur: 1250, delay: 160, color: WATER, width: 0.8, alpha: 0.3 });
      this.burst(x, y - r * 0.5, { count: 7, speed: 85, size: 1.1, life: 0.7, angle: -Math.PI / 2, spread: 1.4 });
      return;
    }
    const angle = rand(0, Math.PI * 2);
    this.loops.push({ x, y, r, angle, spread: rand(0.25, 0.5), height: rand(8, 18), color: this.accentHot, t0: this.clock, dur: 1500 });
    this.burst(x + Math.cos(angle) * r, y + Math.sin(angle) * r, { count: 8, speed: 60, size: 1.2, life: 0.9, spread: 1.2, angle });
    this.overDirty = true;
  }

  /** A streak of light from one place to another. */
  trail(from: { x: number; y: number }, to: { x: number; y: number }, done?: () => void, o: { quiet?: boolean; dur?: number } = {}) {
    if (!this.active) {
      done?.();
      return;
    }
    const mx = (from.x + to.x) / 2;
    const my = (from.y + to.y) / 2;
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const bend = (o.quiet ? rand(0.05, 0.12) : rand(0.18, 0.32)) * (Math.random() < 0.5 ? -1 : 1);
    this.trails.push({
      from,
      to,
      ctrl: { x: mx - dy * bend, y: my + dx * bend },
      color: this.accentHot,
      pts: [],
      t0: this.clock,
      dur: o.dur ?? 620,
      done,
      quiet: o.quiet,
    });
    this.overDirty = true;
  }

  /** A letter you just wrote, landing white-hot and cooling to ink — or one you erased, falling as ash. */
  ink(ch: string, x: number, baseline: number, font: string, ash = false) {
    if (!this.full || this.inkBudget < 1 || !ch.trim()) return;
    this.inkBudget -= 1;
    this.glyphs.push({ ch, x, y: baseline, font, ash, drip: ash && this.rain, vx: rand(-14, 14), spin: rand(-0.5, 0.5), t0: this.clock, dur: ash ? 900 : 650 });
    this.overDirty = true;
  }

  /** Embers rising off a region (used when something dissolves into light). */
  embers(rect: { left: number; top: number; width: number; height: number }, o: { sweep?: number; colors?: C255[]; density?: number } = {}) {
    if (!this.active) return;
    const area = rect.width * rect.height;
    const n = Math.min(this.full ? 220 : 50, Math.round((area / 30) * (o.density ?? 1) * (this.full ? 1 : 0.3)));
    const colors = o.colors ?? (this.rain ? [WATER, WHITE, this.accentHot] : [this.accentHot, this.accent, [235, 225, 255]]);
    if (this.rain) {
      // In the rain it doesn't burn away — it's washed down, top to bottom, in drops.
      for (let i = 0; i < n; i++) {
        const fy = Math.random();
        const life = rand(0.5, 1);
        this.add({
          x: rect.left + Math.random() * rect.width,
          y: rect.top + rect.height * fy,
          vx: rand(-10, 10),
          vy: rand(10, 70),
          ay: 620,
          drag: 0.985,
          life,
          max: life,
          delay: fy * (o.sweep ?? 0.45),
          size: rand(0.6, 1.3),
          alpha: rand(0.5, 0.9),
          color: colors[(Math.random() * colors.length) | 0],
          kind: Math.random() < 0.3 ? 0 : 1,
        });
      }
      return;
    }
    for (let i = 0; i < n; i++) {
      const fx = Math.random();
      const life = rand(0.55, 1.15);
      this.add({
        x: rect.left + fx * rect.width,
        y: rect.top + rect.height * (0.15 + Math.random() * 0.7),
        vx: rand(12, 60),
        vy: -rand(12, 75),
        ay: -34,
        drag: 0.965,
        life,
        max: life,
        delay: fx * (o.sweep ?? 0.45),
        size: rand(0.55, 1.35),
        alpha: rand(0.55, 0.95),
        color: colors[(Math.random() * colors.length) | 0],
        kind: Math.random() < 0.45 ? 2 : 1,
      });
    }
  }

  /** Dust pulled along the rim of the passing moon (optionally just one stretch of it, in radians). */
  rimDust(x: number, y: number, r: number, dir: number, from = 0, to = Math.PI * 2) {
    if (!this.active) return;
    const count = this.full ? 3 : 1;
    for (let i = 0; i < count; i++) {
      const an = rand(from, to);
      const px = x + Math.cos(an) * r;
      const py = y + Math.sin(an) * r;
      const life = rand(0.5, 1);
      this.add({
        x: px,
        y: py,
        vx: -Math.sin(an) * 80 * dir + rand(-20, 20),
        vy: Math.cos(an) * 80 * dir + rand(-20, 20),
        drag: 0.95,
        life,
        max: life,
        size: rand(0.8, 1.6),
        color: Math.random() < 0.5 ? this.accentHot : WHITE,
        kind: 1,
      });
    }
  }

  get panelRect() {
    return { ...this.panel };
  }
}

export const fx = new FxEngine();
