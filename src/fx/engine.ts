import { mixRgb, oklchToRgb, to255, type RGB } from "./color";
import { Sky, type SceneId } from "./sky";
import { viewportHeight } from "../lib/platform";
import { setBarColors } from "../lib/theme";
import { SCENES } from "../scenes/meta";
import type { SceneController } from "./scene";
import { clamp01, easeInOut, easeOut, rand, WATER, WHITE, type C255, type Timed } from "./util";
import { GalaxyScene } from "../scenes/galaxy/controller";
import { SolarScene } from "../scenes/solar/controller";
import { RainScene, type RainOptions } from "../scenes/rain/controller";
import { InkScene } from "../scenes/ink/controller";
import { SkyScene, type SkyOptions } from "../scenes/sky/controller";

export type { RainOptions, SkyOptions };

/**
 * umbra's light engine. One animation loop drives three layers:
 *  - the sky (WebGL, fx/sky.ts): the scene itself — the galaxy, the solar eclipse, the rain, the ink, the Sky
 *  - behind the UI (2D): the galaxy's dust and shooting stars (the other scenes keep it clear)
 *  - over the UI (2D): sunbursts, flares, embers, light trails — drops in the rain, ink on paper
 * What's particular to each scene — its moment-to-moment life, the frame it hands the sky, its
 * own take on the effects — is its controller (scenes/<id>/controller.ts, see fx/scene.ts); the
 * engine is what they share. Everything is in CSS pixels; effects are fire-and-forget.
 */

export type FxLevel = "cosmic" | "subtle" | "off";

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
/** A letter as it lands (white-hot, cooling to ink) or leaves (falling away as ash — or, in the rain, running off like a drip). */
type Glyph = Timed & { ch: string; x: number; y: number; font: string; ash: boolean; vx: number; spin: number; drip?: boolean };

export class FxEngine {
  level: FxLevel = "cosmic";

  // ── the scenes ──
  /** Each scene's controller (scenes/<id>/controller.ts). */
  private galaxy = new GalaxyScene(this);
  private solarScene = new SolarScene(this);
  private rainScene = new RainScene(this);
  private inkCtl = new InkScene(this);
  private skyCtl = new SkyScene(this);
  private scenes: Record<SceneId, SceneController> = { eclipse: this.galaxy, solar: this.solarScene, rain: this.rainScene, ink: this.inkCtl, sky: this.skyCtl };

  /** The scene that's on now. */
  private get ctl(): SceneController {
    return this.scenes[this.scene];
  }

  started = false;
  private raf = 0;
  reduced = typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;
  small = typeof matchMedia !== "undefined" && matchMedia("(pointer: coarse), (max-width: 820px)").matches;

  private skyCanvas: HTMLCanvasElement | null = null;
  sky: Sky | null = null;
  private dustCanvas: HTMLCanvasElement | null = null;
  dctx: CanvasRenderingContext2D | null = null;
  private overCanvas: HTMLCanvasElement | null = null;
  private octx: CanvasRenderingContext2D | null = null;

  W = 0;
  H = 0;
  private dpr = 1;
  time = 0;
  private last = 0;
  private lastSky = 0;
  /** Effects run on a virtual clock (ms) so they can be slowed down for inspection. */
  clock = 0;
  timeScale = 1;

  mouse = { x: 0, y: 0 };
  smouse = { x: 0, y: 0 };
  panelEl: HTMLElement | null = null;
  panelCircle: (() => { x: number; y: number; r: number }) | null = null;
  panel = { x: 0, y: 0, w: 0, h: 0, r: 16, circle: false };
  /** The page's own panel (CSS px), even while the corona pours from a moon instead (the galaxy's eclipse). */
  pageRect = { x: 0, y: 0, w: 0, h: 0 };
  private panelRadius = 16;

  a: RGB = [0.7, 0.62, 1];
  private b: RGB = [0.3, 0.35, 0.8];
  private aTo: RGB = [0.7, 0.62, 1];
  bTo: RGB = [0.3, 0.35, 0.8];

  calm = false;
  /** The cursor as a light source (it can be turned off); eased so the change is a soft fade. */
  cursorLight = true;
  cursorK = 1;
  /** Nothing drawn over the sky (the "Bare" background): the corona no longer outlines the panel. */
  open = false;
  private openK = 0;
  /** When you last touched anything (fx clock). Left alone, the sky slowly wakes up. */
  private lastInput = 0;
  energy = 1;
  flare = 0;
  private dim = 0;
  private dimTarget = 0;
  diamond = { x: 0, y: 0, v: 0 };
  private shocks: (Timed & { x: number; y: number; strength: number })[] = [];

  private particles: Particle[] = [];
  private rings: Ring[] = [];
  private flashes: Flash[] = [];
  private rays: Rays[] = [];
  ghosts: Ghost[] = [];
  private streaks: Streak[] = [];
  private beams: Beam[] = [];
  private loops: Loop[] = [];
  private trails: Trail[] = [];
  private glyphs: Glyph[] = [];
  private inkBudget = 0;
  overDirty = false;
  private sprites = new Map<string, HTMLCanvasElement>();
  /** Adaptive quality: the sky's render scale drops on slow machines, recovers on fast ones. */
  private skyScale = 1;
  private frameMs = 16;
  private slowFor = 0;
  private fastFor = 0;

  /** Which sky: the eclipse, or rain on the window. */
  scene: SceneId = "eclipse";
  dustClear = false;

  // ── lifecycle ────────────────────────────────────────────────────────────

  init() {
    if (this.started || typeof document === "undefined") return;
    this.started = true;
    this.mouse = { x: innerWidth * 0.62, y: innerHeight * 0.3 };
    this.smouse = { ...this.mouse };

    this.skyCanvas = this.makeCanvas("fx-sky");
    this.sky = Sky.create(this.skyCanvas);
    if (!this.sky) this.skyCanvas.style.display = "none";
    // Some scenes need a little more of the GPU; if this device can't draw one, stay with the galaxy.
    if (this.sky && !this.ctl.supported()) this.scene = "eclipse";
    this.markScene();
    this.dustCanvas = this.makeCanvas("fx-dust");
    this.dctx = this.dustCanvas.getContext("2d");
    this.overCanvas = this.makeCanvas("fx-over");
    this.octx = this.overCanvas.getContext("2d");
    document.body.prepend(this.dustCanvas);
    document.body.prepend(this.skyCanvas);
    document.body.append(this.overCanvas);

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
    for (const c of Object.values(this.scenes)) c.init?.();
    this.applyLevel();
    // (a scene that needed the sky to begin with — Ink's water — begins properly now)
    const ctl = this.ctl;
    if (ctl.start) {
      ctl.start();
      this.placeSkyCanvas();
    }
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
  wipe(ctx: CanvasRenderingContext2D) {
    ctx.clearRect(this.ox, this.oy, this.W, this.H);
  }

  /** The offset of the effect layers from the page (see `measureOrigin`), for things placed over the page by hand. */
  get origin() {
    return { x: this.ox, y: this.oy };
  }

  private get baseSkyScale() {
    return this.ctl.skyScale();
  }

  /** Sizes the sky for the current scene, level and measured speed. */
  private sizeSky() {
    if (!this.sky) return;
    const scale = this.baseSkyScale * this.skyScale;
    this.sky.resize(this.W, this.H, scale);
    // The city behind the rain is soft, so it needs a little less than the glass in front of it.
    this.sky.cityScale = Math.min(1.15, Math.max(0.6, scale * 0.75));
    this.sky.quality = this.effective === "cosmic" && (!this.small || this.ctl.detailOnSmall) ? 1 : 0;
  }

  get rain() {
    return this.scene === "rain";
  }

  get solar() {
    return this.scene === "solar";
  }

  /** The Ink scene: a light one (paper), where effects are ink rather than light. */
  get inkScene() {
    return this.scene === "ink";
  }

  /** A light scene (paper): effects are ink rather than light. */
  get light() {
    return SCENES[this.scene].light;
  }

  /** Whether this device can run the ink in the water (WebGL with float or 8-bit targets). */
  get inkCapable() {
    return Boolean(this.sky?.inkReady());
  }

  /** The reader asked for less motion (the big moments become simple changes). */
  get reducedMotion() {
    return this.reduced;
  }

  /**
   * Tells the page which scene it's in: html[data-scene] for its own styles, html[data-tone] for
   * whether it's a light (paper) one (styles/light.css), and the browser's own colour scheme to match.
   */
  private markScene() {
    const root = document.documentElement;
    root.dataset.scene = this.scene;
    root.dataset.tone = this.light ? "light" : "dark";
    // (the page's own colour under everything: paper for a light scene, else the dark default)
    if (this.light) root.style.setProperty("--plain", SCENES[this.scene].plain);
    else root.style.removeProperty("--plain");
    document.querySelector('meta[name="color-scheme"]')?.setAttribute("content", this.light ? "light" : "dark");
  }

  /** The sky canvas: hidden when there's nothing to draw on it (ink this device can't simulate: plain paper). */
  private placeSkyCanvas() {
    if (!this.skyCanvas) return;
    const on = this.effective !== "off" && Boolean(this.sky) && this.ctl.drawsSky();
    this.skyCanvas.style.display = on ? "" : "none";
  }

  setScene(scene: SceneId, instant = false) {
    if (scene === this.scene) return;
    if (this.sky && !this.scenes[scene].supported()) scene = "eclipse";
    if (scene === this.scene) return;
    const from = this.ctl;
    this.scene = scene;
    this.markScene();
    this.barsSoon();
    // (with effects off nothing reads the sky's edges: the bars just take the page's own colour)
    if (this.started && this.effective === "off") setBarColors(null, null);
    from.leave();
    // the layer behind the UI is the galaxy's: anywhere else it's cleared, once
    this.dustClear = true;
    this.ctl.enter(instant);
    if (this.started) this.placeSkyCanvas();
    if (this.started) this.sizeSky();
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
    if (performance.now() < this.adaptHold) {
      this.frameMs = Math.min(this.frameMs, 16);
      this.slowFor = 0;
      return;
    }
    this.frameMs += (realDt * 1000 - this.frameMs) * 0.05;
    const floor = this.ctl.floor;
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

  get effective(): FxLevel {
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
    this.placeSkyCanvas();
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
    if (!on) {
      this.barTop = this.barBottom = "";
      setBarColors(null, null);
    } else this.barsSoon();
  }

  private clearAll() {
    for (const c of Object.values(this.scenes)) c.clear?.();
    this.glyphs = [];
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
    const was = this.aTo?.join();
    this.aTo = oklchToRgb(accent);
    this.bTo = oklchToRgb(secondary);
    if (was !== this.aTo.join()) this.barsSoon();
    for (const c of Object.values(this.scenes)) c.accent?.(accent);
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
    // (a frame's timestamp can fall a hair before the moment the loop was started: never go back in time)
    const realDt = Math.max(0, Math.min(0.25, (real - this.last) / 1000));
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
    const ctl = this.ctl;
    this.time += dt * ctl.timeRate(lvl);
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
    ctl.step(now, dt, idle);

    // The sky: the galaxy drifts so slowly while you write that ~30fps is plenty then. Rain never
    // slows down — falling drops stutter visibly at anything less than every frame — and nor does
    // the solar eclipse while something's happening in it, or the ink in the water.
    const throttle = !ctl.busy() && this.energy < 0.4 ? 32 : 0;
    if (this.sky && ctl.drawsSky() && (ctl.mustRender() || now - this.lastSky > throttle || this.flare > 0.02 || this.shocks.length)) {
      this.renderSky(now);
    }

    ctl.behind(now, dt, idle);
    this.drawOverlay(now, dt);
  };

  private renderSky(now: number) {
    if (!this.sky) return;
    this.lastSky = now;
    this.shocks = this.shocks.filter((s) => now - s.t0 < s.dur);
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
      eclipse: this.scene === "eclipse" && !this.panelCircle && this.panelEl ? this.galaxy.eclipseNow : 0,
      corona: this.scene === "eclipse" && !this.panelCircle ? this.galaxy.coronaNow : 1,
      // each scene's part (the renderer reads its own)
      rain: this.rainScene.frame(),
      solar: this.solarScene.frame(),
      ink: this.inkCtl.frame(),
      sky: this.skyCtl.frame(),
    });
    this.ctl.rendered?.();
    this.matchBars(now);
  }

  // ── particular scenes ────────────────────────────────────────────────────
  // (what the app asks of a particular scene, handed to its controller)

  /** The layer behind the UI is the galaxy's: a scene without one clears it, once. */
  clearBehind() {
    const ctx = this.dctx;
    if (!ctx) return;
    if (this.dustClear) this.wipe(ctx);
    this.dustClear = false;
  }

  // the galaxy
  meteor(o: { fireball?: boolean } = {}) {
    this.galaxy.meteor(o);
  }

  /** The galaxy's own eclipse: a moon hanging in the sky beside your writing, its corona streaming out into the nebula. */
  setGalaxyEclipse(on: boolean, middle = false) {
    this.galaxy.setEclipse(on, middle);
  }

  /** Where an eclipse hangs in the layout as it is now (the solar eclipse's spot, at the usual distance). */
  eclipseHome() {
    return this.solarScene.homeFor(0.5);
  }

  // the solar eclipse
  setSolar(o: Parameters<SolarScene["setSolar"]>[0]) {
    this.solarScene.setSolar(o);
  }

  setBackdrop(id: string) {
    this.solarScene.setBackdrop(id);
    this.inkCtl.setBackdrop(id);
  }

  /** Until when (performance.now(), ms) slow frames don't count against the sky's resolution. */
  private adaptHold = 0;

  /** A burst of work that's meant to be heavy (the water warming up): don't take its slow frames
   *  as a sign the device can't keep up — or the sky would stay at a lower resolution after it. */
  holdAdapt(ms: number) {
    this.adaptHold = Math.max(this.adaptHold, performance.now() + ms);
  }

  get sunScale() {
    return this.solarScene.sunScale;
  }

  get sunSpot() {
    return this.solarScene.sunSpot;
  }

  glint() {
    this.solarScene.glint();
  }

  erupt() {
    this.solarScene.erupt();
  }

  lensFlare(at?: { x: number; y: number }, delay = 0, strength = 1) {
    this.solarScene.lensFlare(at, delay, strength);
  }

  holdSun(spot: { x: number; y: number; r: number } | null, o: { fromBlack?: boolean } = {}) {
    this.solarScene.holdSun(spot, o);
  }

  setApproach(moon: { x: number; y: number } | null) {
    this.solarScene.setApproach(moon);
  }

  // the rain
  setRain(o: Partial<RainOptions>) {
    this.rainScene.setRain(o);
  }

  get lightningOn() {
    return this.rainScene.lightningOn;
  }

  strike(o: { bolt?: boolean; power?: number; x?: number } = {}) {
    return this.rainScene.strike(o);
  }

  // the ink
  inkArrive(on: Parameters<InkScene["inkArrive"]>[0] = {}) {
    return this.inkCtl.inkArrive(on);
  }

  inkSkip() {
    this.inkCtl.inkSkip();
  }

  get arriving() {
    return this.inkCtl.arriving;
  }

  inkWelcome(x: number, y: number, hold = 2600) {
    return this.inkCtl.inkWelcome(x, y, hold);
  }

  inkLinger(ms: number, behind = 0.6) {
    this.inkCtl.inkLinger(ms, behind);
  }

  inkRipple(x: number, y: number, strength = 1) {
    this.inkCtl.inkRipple(x, y, strength);
  }

  inkBloom(x: number, y: number, o: Parameters<InkScene["inkBloom"]>[2] = {}) {
    this.inkCtl.inkBloom(x, y, o);
  }

  /** Ink's own settings (its colours). */
  setInk(o: Parameters<InkScene["setInk"]>[0]) {
    this.inkCtl.setInk(o);
  }

  // the Sky
  /** The Sky's own settings: its colours, how cloudy, the wind. */
  setSky(o: Partial<SkyOptions>) {
    this.skyCtl.setSky(o);
  }

  /** Rising up through the clouds into the Sky (the mist holds `hold` ms, then opens over `open` ms). */
  skyArrive(o: { hold?: number; open?: number } = {}) {
    this.skyCtl.arrive(o);
  }

  /** The mist opens at once. */
  skySkip() {
    this.skyCtl.skipArrival();
  }

  /** The Sky's sun (CSS px). */
  get skySun() {
    return this.skyCtl.sunSpot;
  }

  /** A gust of wind through the Sky. */
  windGust() {
    if (this.scene === "sky" && this.active) this.skyCtl.windGust();
  }

  /** A contrail across the Sky (it comes by itself now and then). */
  contrail() {
    if (this.scene === "sky" && this.full) this.skyCtl.contrail();
  }

  /** A paragraph finished (Enter) with the caret at x, y (CSS px): the scene may mark it. */
  paragraph(x: number, y: number) {
    if (this.active) this.inkCtl.paragraph(x, y);
  }

  // ── the phone's bars ─────────────────────────────────────────────────────

  /** When to look at the sky's edges next, and what the bars were last given. */
  private barsAt = 0;
  private barTop = "";
  private barBottom = "";

  /** Look at the edges again shortly (the scene, its look or the accent changed). */
  barsSoon() {
    this.barsAt = Math.min(this.barsAt, performance.now() + 900);
  }

  /**
   * Now and then, the colour along the top and bottom edges of the sky goes to the phone's status
   * bar and to the strip under its gesture bar, so the sky seems to run right to the screen's
   * edges. (Two thin reads every few seconds: nothing you'd notice.)
   */
  private matchBars(now: number) {
    if (now < this.barsAt || !this.sky || document.hidden) return;
    this.barsAt = now + 3000;
    const e = this.sky.edgeColors();
    if (!e) return;
    const hex = (c: [number, number, number]) => "#" + c.map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, "0")).join("");
    const top = hex(e.top);
    const bottom = hex(e.bottom);
    if (top === this.barTop && bottom === this.barBottom) return;
    this.barTop = top;
    this.barBottom = bottom;
    setBarColors(top, bottom);
  }

  // ── the panel (the moon the corona streams from behind) ─────────────────

  private trackPanel() {
    if (this.panelCircle) {
      const c = this.panelCircle();
      this.panel = { x: c.x - c.r, y: c.y - c.r, w: c.r * 2, h: c.r * 2, r: c.r, circle: true };
      return;
    }
    const el = this.panelEl;
    if (el && el.isConnected) {
      const r = el.getBoundingClientRect();
      if (r.width > 0) {
        this.pageRect = { x: r.left, y: r.top, w: r.width, h: r.height };
        // The galaxy's own eclipse: the corona pours from its moon, hanging in the sky, instead.
        const moon = this.scene === "eclipse" ? this.galaxy.moonNow() : null;
        this.panel = moon
          ? { x: moon.x - moon.r, y: moon.y - moon.r, w: moon.r * 2, h: moon.r * 2, r: moon.r, circle: true }
          : { x: r.left, y: r.top, w: r.width, h: r.height, r: this.panelRadius, circle: false };
      }
    } else {
      // No panel: a dim, distant sun far below the horizon.
      this.panel = { x: this.W * 0.5 - 1, y: this.H * 1.6, w: 2, h: 2, r: 1, circle: false };
    }
  }

  // ── overlay: the effects above the UI ────────────────────────────────────

  sprite(c: C255): HTMLCanvasElement {
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
    const drops = this.ctl.drops;

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
        ctx.drawImage(drops ? this.dropSprite(p.color) : this.sprite(p.color), p.x - s, p.y - s, s * 2, s * 2);
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
    const wet = this.ctl.drops;
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
    // (on paper a flash of light becomes a wash of ink, which needs far less of it)
    const alpha = (o.alpha ?? 0.5) * this.ctl.flashK;
    this.flashes.push({ x, y, r, t0: this.clock + (o.delay ?? 0), dur: o.dur ?? 500, color: o.color ?? this.accent, alpha });
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
    // (each scene may play its own: lightning in the rain, the real diamond ring under the solar
    // eclipse, a drop of ink on paper)
    if (this.ctl.newNote?.()) return;
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

  /** Checking off a to-do: a tiny sunburst (each scene may have its own: a splash, in the rain). */
  sunburst(x: number, y: number) {
    if (!this.active) return;
    if (this.ctl.checked?.(x, y)) return;
    const now = this.clock;
    this.rays.push({ x, y, n: 12, r0: 11, len: this.full ? 26 : 16, color: this.accentHot, spin: 0.35, width: 1.5, t0: now, dur: 520 });
    this.ring(x, y, 9, 34, { dur: 520, width: 1.4 });
    this.flash(x, y, 46, { dur: 380, alpha: 0.55 });
    this.burst(x, y, { count: 18, speed: 150, size: 1.7, life: 0.65, sparks: 0.5 });
  }

  /** A soft flourish of light (sharing, saving a copy). (Each scene may have its own: in a storm, it calls down the lightning.) */
  beam(x: number, y: number) {
    if (!this.active) return;
    if (this.ctl.beam?.(x, y)) return;
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

  /** Solar prominence: an arc of light erupting from a small eclipse. (Each scene may have its own: in the rain, a drop and its rings.) */
  prominence(x: number, y: number, r: number) {
    if (!this.full) return;
    if (this.ctl.prominence?.(x, y, r)) return;
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
    this.glyphs.push({ ch, x, y: baseline, font, ash, drip: ash && this.ctl.drops, vx: rand(-14, 14), spin: rand(-0.5, 0.5), t0: this.clock, dur: ash ? 900 : 650 });
    this.overDirty = true;
  }

  /** Embers rising off a region (used when something dissolves into light). */
  embers(rect: { left: number; top: number; width: number; height: number }, o: { sweep?: number; colors?: C255[]; density?: number } = {}) {
    if (!this.active) return;
    const area = rect.width * rect.height;
    const n = Math.min(this.full ? 220 : 50, Math.round((area / 30) * (o.density ?? 1) * (this.full ? 1 : 0.3)));
    const drops = this.ctl.drops;
    const colors = o.colors ?? (drops ? [WATER, WHITE, this.accentHot] : [this.accentHot, this.accent, [235, 225, 255]]);
    if (drops) {
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
    // (the page's own panel — even while the galaxy's eclipse has the corona pouring from its moon)
    if (this.panel.circle && this.panelEl && !this.panelCircle) return { ...this.pageRect, r: this.panelRadius, circle: false };
    return { ...this.panel };
  }
}

export const fx = new FxEngine();
