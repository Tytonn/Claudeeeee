import { buildProgram, type GL, type Program } from "./gl";
import type { SceneRenderer, SkyContext } from "./renderer";
import { GalaxyRenderer } from "../scenes/galaxy/renderer";
import { SolarRenderer } from "../scenes/solar/renderer";
import { RainRenderer } from "../scenes/rain/renderer";
import { InkRenderer } from "../scenes/ink/renderer";
import type { RGB } from "./color";
import type { SceneId } from "../lib/types";

export type { SceneId };

export type RainFrame = {
  /** Lightning brightness right now (0..~1.2). */
  flash: number;
  /** Where the bolt is, in layout units (x / screen height), its shape seed, and how visible it is. */
  boltX: number;
  boltSeed: number;
  bolt: number;
  amount: number;
  /** 0 → 1 as the rain sets in. */
  wet: number;
  fog: number;
  city: number;
  wind: number;
  /** Fades the whole scene in when it first appears. */
  fade: number;
  /** How out of focus the city is, 0..1. */
  blur: number;
};

export type SolarFrame = {
  /** The sun: center and radius, CSS px. */
  sun: { x: number; y: number; r: number };
  /** The moon's offset from the sun's center, in sun radii (y down). */
  moon: { x: number; y: number };
  /** How much sunlight gets past the moon, 0 (totality) .. 1. */
  light: number;
  /** The diamond ring: where on the rim it breaks out (a unit vector, y down), and how bright. */
  glare: { x: number; y: number; v: number };
  /** How much of the corona shows, 0..1. */
  corona: number;
  /** A prominence erupting: angle (radians, y down), progress 0..1, size (sun radii), brightness. */
  erupt: [number, number, number, number];
  /** Fades the scene up from black. */
  fade: number;
  /** How much cloud there is, 0..1 (they can be turned off). */
  clouds: number;
  /** The Golden look, 0..1. */
  gold: number;
  /** The corona's chosen colour (rgb) and how much of it, 0..1. */
  tint: [number, number, number, number];
  /** The Golden look turned to the accent's colours: an angle round the gray axis, and colourfulness (0, 1: as it is). */
  goldShift: [number, number];
};

/** One step of the ink's simulation. */
export type InkStep = {
  /** The current's clock (s), and how long this step is. */
  t: number;
  dt: number;
  /** The blooms under way: where, size, age; how much ink, indigo, push, seed (INK_BLOOMS of each). */
  A: Float32Array;
  B: Float32Array;
};

export type InkFrame = {
  /** Simulation steps to run before drawing, oldest first. */
  steps: InkStep[];
  /** How far between the last two states to draw (the simulation steps less often than the screen). */
  mix: number;
  /** Start over with clean water. */
  reset: boolean;
  /** Aspect of the simulation's space (width / height). */
  aspect: number;
  /** The note, kept clear: x0, y0, x1, y1 in screen heights (y up). */
  panel: [number, number, number, number];
  /** How firmly it's kept clear (lower while a drop is arriving). */
  clear: number;
  /** The cursor stirring the water: where and how fast (screen heights). */
  stir: [number, number, number, number];
  flow: number;
  /** How much ink shows behind the note. */
  behind: number;
  /** Ripples: x, y (CSS px), age (s), strength. */
  ripples: [number, number, number, number][];
  /** The arrival: darkness, how far the paper has opened (screen heights), the drop falling 0..1, the ring's flash. */
  intro: [number, number, number, number];
  /** Where the drop lands (CSS px). */
  drop: { x: number; y: number };
  fade: number;
  /** In real water only: the words' column, kept softer behind (CSS px: x, y, w, h; w 0: none). */
  column: [number, number, number, number];
  /** In real water only: how much light from the surface plays on the paper. */
  light: number;
};

export type SkyFrame = {
  scene: SceneId;
  time: number;
  mouse: { x: number; y: number }; // CSS px
  panel: {
    x: number;
    y: number;
    w: number;
    h: number;
    r: number;
    circle: boolean;
  }; // CSS px rect
  a: RGB;
  b: RGB;
  energy: number;
  flare: number;
  dim: number;
  ring: { x: number; y: number; v: number };
  shocks: { x: number; y: number; age: number; strength: number }[];
  /** How much the cursor lights things up, 0..1 (it can be turned off). */
  cursor: number;
  /** 1 when nothing is drawn over the sky ("Bare"): the light ignores the panel's outline. */
  open: number;
  rain: RainFrame;
  solar: SolarFrame;
  ink: InkFrame;
};

/**
 * The WebGL sky. Every scene shares one context; each scene's renderer (scenes/<id>/renderer.ts)
 * compiles what it needs the first time it's needed, so nobody pays for a scene they never pick.
 * The galaxy is built with the sky itself — no galaxy, no sky — and any scene that can't be drawn
 * here falls back on it.
 */
export class Sky implements SkyContext {
  readonly gl: GL;
  readonly gl2: boolean;
  private lost = false;
  cssH = 0;
  cssW = 0;
  scale = 1;
  quality = 1;
  /** City texels per CSS pixel. */
  cityScale = 0.75;
  private galaxy: GalaxyRenderer;
  private ink: InkRenderer;
  /** Each scene's renderer. */
  private renderers: Record<SceneId, SceneRenderer>;

  static create(canvas: HTMLCanvasElement): Sky | null {
    try {
      const attrs: WebGLContextAttributes = {
        alpha: false,
        antialias: false,
        depth: false,
        stencil: false,
        premultipliedAlpha: false,
        preserveDrawingBuffer: false,
        powerPreference: "high-performance",
      };
      const gl2 = canvas.getContext("webgl2", attrs);
      const gl = gl2 ?? canvas.getContext("webgl", attrs);
      if (!gl) return null;
      const sky = new Sky(canvas, gl, Boolean(gl2));
      return sky.galaxy.supported() ? sky : null;
    } catch {
      return null;
    }
  }
  private constructor(
    readonly canvas: HTMLCanvasElement,
    gl: GL,
    gl2: boolean,
  ) {
    this.gl = gl;
    this.gl2 = gl2;
    this.galaxy = new GalaxyRenderer(this);
    this.ink = new InkRenderer(this);
    this.renderers = { eclipse: this.galaxy, solar: new SolarRenderer(this), rain: new RainRenderer(this), ink: this.ink };
    this.setup();
    canvas.addEventListener("webglcontextlost", (e) => {
      e.preventDefault();
      this.lost = true;
    });
    canvas.addEventListener("webglcontextrestored", () => {
      this.lost = false;
      for (const r of Object.values(this.renderers)) r.restore();
      this.setup();
    });
  }

  build(vert: string, frag: string, uniforms: string[], label: string): Program | null {
    return buildProgram(this.gl, vert, frag, uniforms, label);
  }

  private setup() {
    const gl = this.gl;
    if (!this.galaxy.build()) return;
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  }

  /** Whether a scene can be drawn here (compiles it, if needed). */
  supports(scene: SceneId): boolean {
    return !this.lost && this.galaxy.supported() && this.renderers[scene].supported();
  }

  /** Whether the ink can actually be drawn here (compiles it, and makes its textures, if needed). */
  inkReady(): boolean {
    return !this.lost && this.galaxy.supported() && this.ink.ready();
  }

  /** Whether the ink is kept in half-floats (else 8 bits). */
  get inkHalf() {
    return this.ink.half;
  }

  /** Whether the ink is in real water here (a fluid simulation), else the lighter fluid-style ink. */
  get inkFluid() {
    return this.ink.fluidMode;
  }

  /** Whether the solar eclipse can actually be drawn here (compiles it if needed). */
  solarReady(): boolean {
    return this.supports("solar");
  }

  /** Whether the rain can actually be drawn here (compiles it if needed). */
  rainReady(): boolean {
    return this.supports("rain");
  }

  /** Repaint everything on the next frame (e.g. for a view transition's snapshot). */
  invalidate() {
    for (const r of Object.values(this.renderers)) r.invalidate();
  }

  resize(cssW: number, cssH: number, scale: number) {
    this.scale = scale;
    this.cssH = cssH;
    this.cssW = cssW;
    const w = Math.max(1, Math.round(cssW * scale));
    const h = Math.max(1, Math.round(cssH * scale));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    this.gl.viewport(0, 0, w, h);
  }
  /**
   * The colour along the top and bottom edges of the frame just drawn (for the phone's bars).
   * Two one-pixel rows, read straight after drawing.
   */
  edgeColors(): { top: [number, number, number]; bottom: [number, number, number] } | null {
    if (this.lost) return null;
    const gl = this.gl;
    const w = this.canvas.width;
    const h = this.canvas.height;
    if (w < 4 || h < 4) return null;
    try {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      const row = new Uint8Array(w * 4);
      const avg = (y: number): [number, number, number] => {
        gl.readPixels(0, y, w, 1, gl.RGBA, gl.UNSIGNED_BYTE, row);
        let r = 0;
        let g = 0;
        let b = 0;
        for (let i = 0; i < w; i++) {
          r += row[i * 4];
          g += row[i * 4 + 1];
          b += row[i * 4 + 2];
        }
        return [r / w, g / w, b / w];
      };
      // (GL counts rows from the bottom.)
      return { top: avg(h - 1), bottom: avg(0) };
    } catch {
      return null;
    }
  }
  render(f: SkyFrame) {
    if (this.lost || !this.galaxy.supported()) return;
    const r = this.renderers[f.scene];
    if (r !== this.galaxy && r.ready()) r.render(f);
    else this.galaxy.render(f);
  }

  shocks(loc: Program["loc"], f: SkyFrame, fy: (y: number) => number) {
    const gl = this.gl;
    const k = this.scale;
    [loc.uShock0, loc.uShock1, loc.uShock2].forEach((l, i) => {
      const s = f.shocks[i];
      if (s) gl.uniform4f(l, s.x * k, fy(s.y), s.age, s.strength);
      else gl.uniform4f(l, 0, 0, 0, 0);
    });
  }}
