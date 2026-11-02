import { FRAG, VERT } from "./shaders";
import { rainShaders } from "./rain";
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
  rain: RainFrame;
};

type GL = WebGLRenderingContext | WebGL2RenderingContext;
type Program = {
  prog: WebGLProgram;
  loc: Record<string, WebGLUniformLocation | null>;
};

const ECLIPSE_UNIFORMS = [
  "uRes",
  "uTime",
  "uMouse",
  "uPanel",
  "uRadius",
  "uShape",
  "uA",
  "uB",
  "uEnergy",
  "uFlare",
  "uDim",
  "uRing",
  "uShock0",
  "uShock1",
  "uShock2",
  "uScale",
  "uQuality",
];
const SCENE_UNIFORMS = ["uRes", "uAspect", "uTime", "uA", "uCity", "uAmount", "uWet", "uFlash", "uWind", "uDim", "uQuality", "uBlur"];
const GLASS_UNIFORMS = [
  "uScene",
  "uRes",
  "uDpr",
  "uTime",
  "uMouse",
  "uFlash",
  "uAmount",
  "uWet",
  "uFog",
  "uA",
  "uDim",
  "uQuality",
  "uLodBase",
  "uScale",
  "uShock0",
  "uShock1",
  "uShock2",
  "uFade",
  "uSceneSize",
  "uWind",
  "uBlur",
];

const pow2 = (n: number) => Math.pow(2, Math.round(Math.log2(Math.max(1, n))));

/**
 * The WebGL sky. Two scenes share one context: the eclipse (one pass) and the rain
 * (the city into a mipmapped texture, then the glass on top). The rain is compiled the
 * first time it's needed, so nobody pays for it until they pick it.
 */
export class Sky {
  private gl: GL;
  private gl2: boolean;
  private lost = false;
  private cssH = 0;
  private cssW = 0;
  private eclipse: Program | null = null;
  private rainScene: Program | null = null;
  private rainGlass: Program | null = null;
  private rainBroken = false;
  private lodExt = false;
  private target: {
    fb: WebGLFramebuffer;
    tex: WebGLTexture;
    w: number;
    h: number;
  } | null = null;
  /** When the city was last painted (scene time); it's redrawn at most 30 times a second. */
  private cityAt = -1;
  scale = 1;
  quality = 1;
  /** City texels per CSS pixel. */
  cityScale = 0.75;

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
      return sky.eclipse ? sky : null;
    } catch {
      return null;
    }
  }

  private constructor(
    private canvas: HTMLCanvasElement,
    gl: GL,
    gl2: boolean,
  ) {
    this.gl = gl;
    this.gl2 = gl2;
    this.setup();
    canvas.addEventListener("webglcontextlost", (e) => {
      e.preventDefault();
      this.lost = true;
    });
    canvas.addEventListener("webglcontextrestored", () => {
      this.lost = false;
      this.eclipse = this.rainScene = this.rainGlass = null;
      this.target = null;
      this.rainBroken = false;
      this.setup();
    });
  }

  private build(vert: string, frag: string, uniforms: string[], label: string): Program | null {
    const gl = this.gl;
    const compile = (type: number, src: string) => {
      const sh = gl.createShader(type)!;
      gl.shaderSource(sh, src);
      gl.compileShader(sh);
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
        console.warn(`${label} shader:`, gl.getShaderInfoLog(sh));
        return null;
      }
      return sh;
    };
    const vs = compile(gl.VERTEX_SHADER, vert);
    const fs = compile(gl.FRAGMENT_SHADER, frag);
    if (!vs || !fs) return null;
    const prog = gl.createProgram()!;
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.bindAttribLocation(prog, 0, "aPos");
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      console.warn(`${label} program:`, gl.getProgramInfoLog(prog));
      return null;
    }
    const loc: Program["loc"] = {};
    for (const name of uniforms) loc[name] = gl.getUniformLocation(prog, name);
    return { prog, loc };
  }

  private setup() {
    const gl = this.gl;
    this.eclipse = this.build(VERT, FRAG, ECLIPSE_UNIFORMS, "sky");
    if (!this.eclipse) return;
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  }

  /** Compiles the rain the first time it's asked for. False if this device can't run it. */
  private ensureRain(): boolean {
    if (this.rainBroken) return false;
    if (this.rainScene && this.rainGlass) return true;
    if (!this.gl2) this.lodExt = Boolean(this.gl.getExtension("EXT_shader_texture_lod"));
    const src = rainShaders(this.gl2, this.lodExt);
    this.rainScene = this.build(src.vert, src.scene, SCENE_UNIFORMS, "rain scene");
    this.rainGlass = this.rainScene ? this.build(src.vert, src.glass, GLASS_UNIFORMS, "rain glass") : null;
    if (!this.rainScene || !this.rainGlass) {
      this.rainBroken = true;
      return false;
    }
    return true;
  }

  /** The texture the city is painted into: about the screen's own resolution. */
  private ensureTarget(): boolean {
    const gl = this.gl;
    const k = Math.min(this.cityScale, 2048 / Math.max(1, this.cssW, this.cssH));
    let w = Math.max(64, Math.round(this.cssW * k));
    let h = Math.max(64, Math.round(this.cssH * k));
    // WebGL1 can only mipmap power-of-two textures; the stretch doesn't matter, it's sampled by uv.
    if (!this.gl2) {
      w = Math.min(2048, pow2(w));
      h = Math.min(2048, pow2(h));
    }
    if (this.target && this.target.w === w && this.target.h === h) return true;
    if (this.target) {
      gl.deleteFramebuffer(this.target.fb);
      gl.deleteTexture(this.target.tex);
      this.target = null;
    }
    const tex = gl.createTexture();
    const fb = gl.createFramebuffer();
    if (!tex || !fb) return false;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    const ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    if (!ok) {
      gl.deleteFramebuffer(fb);
      gl.deleteTexture(tex);
      this.rainBroken = true;
      return false;
    }
    this.target = { fb, tex, w, h };
    this.cityAt = -1;
    return true;
  }

  /** Whether the rain can actually be drawn here (compiles it if needed). */
  rainReady(): boolean {
    return !this.lost && Boolean(this.eclipse) && this.ensureRain();
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

  render(f: SkyFrame) {
    if (this.lost || !this.eclipse) return;
    if (f.scene === "rain" && this.ensureRain() && this.ensureTarget()) this.renderRain(f);
    else this.renderEclipse(f);
  }

  private shocks(loc: Program["loc"], f: SkyFrame, fy: (y: number) => number) {
    const gl = this.gl;
    const k = this.scale;
    [loc.uShock0, loc.uShock1, loc.uShock2].forEach((l, i) => {
      const s = f.shocks[i];
      if (s) gl.uniform4f(l, s.x * k, fy(s.y), s.age, s.strength);
      else gl.uniform4f(l, 0, 0, 0, 0);
    });
  }

  private renderEclipse(f: SkyFrame) {
    const gl = this.gl;
    const P = this.eclipse!;
    gl.useProgram(P.prog);
    const k = this.scale;
    const W = this.canvas.width;
    const H = this.canvas.height;
    const fy = (y: number) => (this.cssH - y) * k; // CSS (y down) → GL (y up)
    const L = P.loc;
    gl.viewport(0, 0, W, H);
    gl.uniform2f(L.uRes, W, H);
    gl.uniform1f(L.uTime, f.time);
    gl.uniform2f(L.uMouse, f.mouse.x * k, fy(f.mouse.y));
    gl.uniform4f(L.uPanel, (f.panel.x + f.panel.w / 2) * k, fy(f.panel.y + f.panel.h / 2), (f.panel.w / 2) * k, (f.panel.h / 2) * k);
    gl.uniform1f(L.uRadius, f.panel.r * k);
    gl.uniform1f(L.uShape, f.panel.circle ? 1 : 0);
    gl.uniform3f(L.uA, f.a[0], f.a[1], f.a[2]);
    gl.uniform3f(L.uB, f.b[0], f.b[1], f.b[2]);
    gl.uniform1f(L.uEnergy, f.energy);
    gl.uniform1f(L.uFlare, f.flare);
    gl.uniform1f(L.uDim, f.dim);
    gl.uniform4f(L.uRing, f.ring.x * k, fy(f.ring.y), f.ring.v, 0);
    this.shocks(L, f, fy);
    gl.uniform1f(L.uScale, Math.min(W, H));
    gl.uniform1f(L.uQuality, this.quality);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  private renderRain(f: SkyFrame) {
    const gl = this.gl;
    const T = this.target!;
    const r = f.rain;
    const W = this.canvas.width;
    const H = this.canvas.height;
    const k = this.scale;
    const fy = (y: number) => (this.cssH - y) * k;

    // 1 · the city, into the texture — it moves slowly, so 30 times a second is plenty
    // (except while lightning flickers or the glass ripples)
    const S = this.rainScene!;
    const fresh = this.cityAt < 0 || f.time - this.cityAt > 1 / 31 || f.time < this.cityAt || r.flash > 0.004 || f.dim > 0.01;
    if (fresh) this.cityAt = f.time;
    if (fresh) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, T.fb);
      gl.viewport(0, 0, T.w, T.h);
      gl.useProgram(S.prog);
      gl.uniform2f(S.loc.uRes, T.w, T.h);
      gl.uniform1f(S.loc.uAspect, this.cssW / Math.max(1, this.cssH));
      gl.uniform1f(S.loc.uTime, f.time);
      gl.uniform3f(S.loc.uA, f.a[0], f.a[1], f.a[2]);
      gl.uniform1f(S.loc.uCity, r.city);
      gl.uniform1f(S.loc.uAmount, r.amount);
      gl.uniform1f(S.loc.uWet, r.wet);
      gl.uniform4f(S.loc.uFlash, r.flash, r.boltX, r.boltSeed, r.bolt);
      gl.uniform1f(S.loc.uWind, r.wind);
      gl.uniform1f(S.loc.uDim, f.dim);
      gl.uniform1f(S.loc.uQuality, this.quality);
      gl.uniform1f(S.loc.uBlur, r.blur);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.bindTexture(gl.TEXTURE_2D, T.tex);
      gl.generateMipmap(gl.TEXTURE_2D);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }

    // 2 · the glass
    const G = this.rainGlass!;
    gl.viewport(0, 0, W, H);
    gl.useProgram(G.prog);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, T.tex);
    gl.uniform1i(G.loc.uScene, 0);
    gl.uniform2f(G.loc.uRes, W, H);
    gl.uniform1f(G.loc.uDpr, k);
    gl.uniform1f(G.loc.uTime, f.time);
    gl.uniform2f(G.loc.uMouse, f.mouse.x * k, fy(f.mouse.y));
    gl.uniform4f(G.loc.uFlash, r.flash, r.boltX, r.boltSeed, r.bolt);
    gl.uniform1f(G.loc.uAmount, r.amount);
    gl.uniform1f(G.loc.uWet, r.wet);
    gl.uniform1f(G.loc.uFog, r.fog);
    gl.uniform3f(G.loc.uA, f.a[0], f.a[1], f.a[2]);
    gl.uniform1f(G.loc.uDim, f.dim);
    gl.uniform1f(G.loc.uQuality, this.quality);
    gl.uniform1f(G.loc.uLodBase, Math.log2(T.w / W));
    gl.uniform1f(G.loc.uScale, Math.min(W, H));
    gl.uniform1f(G.loc.uFade, r.fade);
    gl.uniform2f(G.loc.uSceneSize, T.w, T.h);
    gl.uniform1f(G.loc.uWind, r.wind);
    gl.uniform1f(G.loc.uBlur, r.blur);
    this.shocks(G.loc, f, fy);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
}
