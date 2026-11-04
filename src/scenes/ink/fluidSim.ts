import { VERT, dropTarget, type GL, type Program, type Target } from "../../fx/gl";
import type { SkyContext } from "../../fx/renderer";
import type { InkFrame, InkStep } from "../../fx/sky";
import {
  FL_ADVECT_FRAG,
  FL_ADVECT_UNIFORMS,
  FL_BLUR_FRAG,
  FL_BLUR_UNIFORMS,
  FL_COPY_FRAG,
  FL_COPY_UNIFORMS,
  FL_CURL_FRAG,
  FL_CURL_UNIFORMS,
  FL_DIV_FRAG,
  FL_DIV_UNIFORMS,
  FL_DYE_FRAG,
  FL_DYE_UNIFORMS,
  FL_FORCE_FRAG,
  FL_FORCE_UNIFORMS,
  FL_GRAD_FRAG,
  FL_GRAD_UNIFORMS,
  FL_MIX_FRAG,
  FL_MIX_UNIFORMS,
  FL_PRESSURE_FRAG,
  FL_PRESSURE_UNIFORMS,
  FL_VORT_FRAG,
  FL_VORT_UNIFORMS,
} from "./fluid";

/** How the water behaves (tuned by eye; the test harness may try others). */
export const FLUID = {
  /** Current texels per sky pixel, and the most along the longer side. */
  velScale: 0.125,
  velMax: 300,
  /** Pressure steps per simulation step (fewer on a phone). */
  iterations: 22,
  iterationsSmall: 14,
  /** How strongly swirls are kept turning. */
  confine: 6,
  /** How quickly the water gives up its motion (per s). */
  drag: 0.12,
  /** How heavily ink sinks. */
  buoy: 0.04,
  /** How hard blooms and splashes turn the water. */
  kick: 2.6,
  /** How quickly ink gives itself to the water (per s). */
  fade: 0.016,
  /** How quickly ink diffuses (per s). */
  soften: 0.35,
  /** How deep the paper is behind the water (1: as painted), and how brightly the surface's light shows on it. */
  paper: 0.86,
  caustics: 0.78,
};

/** How finely the ink is drawn (the Ink detail setting): ink texels per sky pixel, and the most along the longer side. */
const DETAIL = {
  standard: [0.5, 1600],
  high: [0.75, 2400],
} as const;

/** The softly blurred ink: texels per sky pixel, the most along the longer side, and how far each blur step reaches (its texels). */
const BLUR = { scale: 0.2, most: 560, reach: 1.6 };

type Passes = {
  force: Program;
  curl: Program;
  vort: Program;
  div: Program;
  pressure: Program;
  grad: Program;
  advect: Program;
  dye: Program;
  mix: Program;
  blur: Program;
  copy: Program;
};

/**
 * The water and its ink, on the GPU: the current (and the textures its solve needs) at a coarse
 * scale, the ink at a finer one, and this frame's ink (between the last two steps) with mipmaps,
 * for the picture to read softly from.
 */
export class InkFluid {
  private p: Passes | null = null;
  private broken = false;
  private vel: [Target, Target] | null = null;
  private pres: [Target, Target] | null = null;
  private div: Target | null = null;
  private curl: Target | null = null;
  /** The ink, twice (one read, one written): [0] is the newest. */
  private dye: [Target, Target] | null = null;
  /** This frame's ink, and the same softly blurred (one direction, then both). */
  private now: Target | null = null;
  private blurA: Target | null = null;
  private blurB: Target | null = null;
  /** Whether this frame's ink has mipmaps (else the picture blurs with a few taps). */
  mips = true;
  /** How finely the ink is drawn (its textures are remade, the ink carried across, when it changes). */
  detail: keyof typeof DETAIL = "high";

  constructor(private sky: SkyContext) {}

  /** Whether this device can run it: WebGL 2, drawing into half-floats. */
  static capable(gl: GL, gl2: boolean): boolean {
    if (!gl2) return false;
    return Boolean(gl.getExtension("EXT_color_buffer_float") || gl.getExtension("EXT_color_buffer_half_float"));
  }

  supported(): boolean {
    if (this.broken) return false;
    if (this.p) return true;
    const b = (frag: string, u: string[], label: string) => this.sky.build(VERT, frag, u, label);
    const force = b(FL_FORCE_FRAG, FL_FORCE_UNIFORMS, "ink force");
    const curl = force && b(FL_CURL_FRAG, FL_CURL_UNIFORMS, "ink curl");
    const vort = curl && b(FL_VORT_FRAG, FL_VORT_UNIFORMS, "ink vorticity");
    const div = vort && b(FL_DIV_FRAG, FL_DIV_UNIFORMS, "ink divergence");
    const pressure = div && b(FL_PRESSURE_FRAG, FL_PRESSURE_UNIFORMS, "ink pressure");
    const grad = pressure && b(FL_GRAD_FRAG, FL_GRAD_UNIFORMS, "ink gradient");
    const advect = grad && b(FL_ADVECT_FRAG, FL_ADVECT_UNIFORMS, "ink advect");
    const dye = advect && b(FL_DYE_FRAG, FL_DYE_UNIFORMS, "ink dye");
    const mix = dye && b(FL_MIX_FRAG, FL_MIX_UNIFORMS, "ink mix");
    const blur = mix && b(FL_BLUR_FRAG, FL_BLUR_UNIFORMS, "ink blur");
    const copy = blur && b(FL_COPY_FRAG, FL_COPY_UNIFORMS, "ink copy");
    if (!force || !curl || !vort || !div || !pressure || !grad || !advect || !dye || !mix || !blur || !copy) {
      this.broken = true;
      return false;
    }
    this.p = { force, curl, vort, div, pressure, grad, advect, dye, mix, blur, copy };
    return true;
  }

  private target(w: number, h: number, mip = false): Target | null {
    const gl = this.sky.gl as WebGL2RenderingContext;
    const tex = gl.createTexture();
    const fb = gl.createFramebuffer();
    if (!tex || !fb) return null;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, w, h, 0, gl.RGBA, gl.HALF_FLOAT, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, mip ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    const ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
    if (ok) {
      gl.clearColor(0, 0, 0, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    if (!ok) {
      gl.deleteFramebuffer(fb);
      gl.deleteTexture(tex);
      return null;
    }
    if (mip) {
      gl.generateMipmap(gl.TEXTURE_2D);
      if (gl.getError() !== gl.NO_ERROR) {
        this.mips = false;
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      }
    }
    return { fb, tex, w, h };
  }

  private size(scale: number, most: number) {
    const cw = this.sky.canvas.width;
    const ch = this.sky.canvas.height;
    const k = Math.min(scale, most / Math.max(cw, ch, 1));
    return { w: Math.max(16, Math.round(cw * k)), h: Math.max(16, Math.round(ch * k)) };
  }

  /** Its textures, at the right sizes for the canvas (the ink and the current carried across a resize). */
  ensure(): boolean {
    if (!this.supported() || !this.p) return false;
    const v = this.size(FLUID.velScale, FLUID.velMax);
    const [ds, dm] = DETAIL[this.detail] ?? DETAIL.high;
    const d = this.size(ds, dm);
    const bl = this.size(BLUR.scale, BLUR.most);
    if (this.vel && this.vel[0].w === v.w && this.vel[0].h === v.h && this.dye && this.dye[0].w === d.w && this.dye[0].h === d.h && this.blurA?.w === bl.w && this.blurA.h === bl.h) return true;
    const mk = (s: { w: number; h: number }, mip = false) => this.target(s.w, s.h, mip);
    const vel = [mk(v), mk(v)] as const;
    const pres = [mk(v), mk(v)] as const;
    const div = mk(v);
    const curl = mk(v);
    const dye = [mk(d), mk(d)] as const;
    const now = mk(d, true);
    const blurA = mk(bl);
    const blurB = mk(bl);
    const all = [...vel, ...pres, div, curl, ...dye, now, blurA, blurB];
    if (all.some((t) => !t)) {
      for (const t of all) if (t) dropTarget(this.sky.gl, t);
      this.broken = true;
      return false;
    }
    // carry the ink and the current across
    if (this.vel && this.dye) {
      this.copy(this.vel[0], vel[0]!);
      this.copy(this.vel[0], vel[1]!);
      this.copy(this.dye[0], dye[0]!);
      this.copy(this.dye[1], dye[1]!);
    }
    this.drop();
    this.vel = [vel[0]!, vel[1]!];
    this.pres = [pres[0]!, pres[1]!];
    this.div = div;
    this.curl = curl;
    this.dye = [dye[0]!, dye[1]!];
    this.now = now;
    this.blurA = blurA;
    this.blurB = blurB;
    return true;
  }

  private copy(from: Target, to: Target) {
    const gl = this.sky.gl;
    const P = this.p!.copy;
    gl.useProgram(P.prog);
    gl.bindFramebuffer(gl.FRAMEBUFFER, to.fb);
    gl.viewport(0, 0, to.w, to.h);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, from.tex);
    gl.uniform1i(P.loc.uSrc, 0);
    gl.uniform2f(P.loc.uRes, to.w, to.h);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  private drop() {
    const gl = this.sky.gl;
    for (const t of [...(this.vel ?? []), ...(this.pres ?? []), this.div, this.curl, ...(this.dye ?? []), this.now, this.blurA, this.blurB]) if (t) dropTarget(gl, t);
    this.vel = this.pres = this.dye = null;
    this.div = this.curl = this.now = this.blurA = this.blurB = null;
  }

  /** Everything on the GPU is gone (the context was lost): make it all again when next asked. */
  restore() {
    this.p = null;
    this.vel = this.pres = this.dye = null;
    this.div = this.curl = this.now = this.blurA = this.blurB = null;
    this.broken = false;
    this.mips = true;
  }

  /** Clean, still water. */
  clear() {
    const gl = this.sky.gl;
    for (const t of [...(this.vel ?? []), ...(this.pres ?? []), ...(this.dye ?? [])]) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, t.fb);
      gl.clearColor(0, 0, 0, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
    }
  }

  /** One pass: `P` drawn into `to`, with these textures bound in order (units 0, 1, …). */
  private pass(P: Program, to: Target, textures: [string, WebGLTexture][], set: (loc: Program["loc"]) => void) {
    const gl = this.sky.gl;
    gl.useProgram(P.prog);
    gl.bindFramebuffer(gl.FRAMEBUFFER, to.fb);
    gl.viewport(0, 0, to.w, to.h);
    textures.forEach(([name, tex], i) => {
      gl.activeTexture(gl.TEXTURE0 + i);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.uniform1i(P.loc[name], i);
    });
    gl.uniform2f(P.loc.uRes, to.w, to.h);
    set(P.loc);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  /** One step of the water and its ink. */
  step(st: InkStep, I: InkFrame, small: boolean) {
    const gl = this.sky.gl;
    const P = this.p!;
    let vel = this.vel!;
    let pres = this.pres!;
    let dye = this.dye!;
    const vw = vel[0].w;
    const vh = vel[0].h;
    const hx = I.aspect / vw;
    const hy = 1 / vh;
    const H = (loc: Program["loc"]) => gl.uniform2f(loc.uH, hx, hy);
    // pushed
    this.pass(P.force, vel[1], [["uVel", vel[0].tex], ["uDye", dye[0].tex]], (l) => {
      H(l);
      gl.uniform1f(l.uAspect, I.aspect);
      gl.uniform1f(l.uTime, st.t);
      gl.uniform1f(l.uDt, st.dt);
      gl.uniform4fv(l.uBloomA, st.A);
      gl.uniform4fv(l.uBloomB, st.B);
      gl.uniform4f(l.uStir, I.stir[0], I.stir[1], I.stir[2], I.stir[3]);
      gl.uniform1f(l.uFlow, I.flow);
      gl.uniform1f(l.uBuoy, FLUID.buoy);
      gl.uniform1f(l.uKick, FLUID.kick);
    });
    vel = [vel[1], vel[0]];
    // its swirls kept turning
    this.pass(P.curl, this.curl!, [["uVel", vel[0].tex]], H);
    this.pass(P.vort, vel[1], [["uVel", vel[0].tex], ["uCurl", this.curl!.tex]], (l) => {
      H(l);
      gl.uniform1f(l.uDt, st.dt);
      gl.uniform1f(l.uConfine, FLUID.confine);
    });
    vel = [vel[1], vel[0]];
    // kept from piling up or tearing
    this.pass(P.div, this.div!, [["uVel", vel[0].tex]], H);
    const n = small ? FLUID.iterationsSmall : FLUID.iterations;
    for (let i = 0; i < n; i++) {
      this.pass(P.pressure, pres[1], [["uPressure", pres[0].tex], ["uDiv", this.div!.tex]], (l) => {
        H(l);
        gl.uniform1f(l.uKeep, i === 0 ? 0.8 : 1);
      });
      pres = [pres[1], pres[0]];
    }
    this.pass(P.grad, vel[1], [["uPressure", pres[0].tex], ["uVel", vel[0].tex]], H);
    vel = [vel[1], vel[0]];
    // carried along by itself
    this.pass(P.advect, vel[1], [["uVel", vel[0].tex]], (l) => {
      H(l);
      gl.uniform1f(l.uAspect, I.aspect);
      gl.uniform1f(l.uDt, st.dt);
      gl.uniform1f(l.uDrag, FLUID.drag);
    });
    vel = [vel[1], vel[0]];
    // and the ink carried by it
    this.pass(P.dye, dye[1], [["uDye", dye[0].tex], ["uVel", vel[0].tex]], (l) => {
      gl.uniform2f(l.uH, I.aspect / dye[0].w, 1 / dye[0].h);
      gl.uniform1f(l.uAspect, I.aspect);
      gl.uniform1f(l.uTime, st.t);
      gl.uniform1f(l.uDt, st.dt);
      gl.uniform4fv(l.uBloomA, st.A);
      gl.uniform4fv(l.uBloomB, st.B);
      gl.uniform4f(l.uPanel, I.panel[0], I.panel[1], I.panel[2], I.panel[3]);
      gl.uniform1f(l.uClear, I.clear);
      gl.uniform1f(l.uFlow, I.flow);
      gl.uniform1f(l.uFade, FLUID.fade);
      gl.uniform1f(l.uSoften, FLUID.soften);
    });
    dye = [dye[1], dye[0]];
    this.vel = vel;
    this.pres = pres;
    this.dye = dye;
  }

  /** This frame's ink (between the last two steps), and the same softly blurred: their textures. */
  frame(mix: number): { ink: WebGLTexture; soft: WebGLTexture } {
    const gl = this.sky.gl;
    const P = this.p!;
    const dye = this.dye!;
    const now = this.now!;
    this.pass(P.mix, now, [["uA", dye[1].tex], ["uB", dye[0].tex]], (l) => gl.uniform1f(l.uMix, mix));
    if (this.mips) {
      gl.bindTexture(gl.TEXTURE_2D, now.tex);
      gl.generateMipmap(gl.TEXTURE_2D);
    }
    // a Gaussian blur, across and then down, at a low resolution
    this.pass(P.blur, this.blurA!, [["uSrc", now.tex]], (l) => gl.uniform2f(l.uDir, BLUR.reach, 0));
    this.pass(P.blur, this.blurB!, [["uSrc", this.blurA!.tex]], (l) => gl.uniform2f(l.uDir, 0, BLUR.reach));
    return { ink: now.tex, soft: this.blurB!.tex };
  }
}
