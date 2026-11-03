import { VERT, dropTarget, type Program, type Target } from "../../fx/gl";
import type { SceneRenderer, SkyContext } from "../../fx/renderer";
import type { SkyFrame } from "../../fx/sky";
import { INK_COPY_FRAG, INK_COPY_UNIFORMS, INK_PAPER_FRAG, INK_PAPER_UNIFORMS, INK_SIM_FRAG, INK_SIM_UNIFORMS, INK_VIEW_FRAG, INK_VIEW_UNIFORMS } from "./shaders";

/**
 * The ink: a small fluid-style simulation stepped in two textures (one read, one written), then
 * the picture — paper (painted once per size), the ink soaking the light out of it, ripples, and
 * the drop arriving. Compiled the first time it's needed.
 */
export class InkRenderer implements SceneRenderer {
  private inkSim: Program | null = null;
  private inkView: Program | null = null;
  private inkPaper: Program | null = null;
  private inkCopy: Program | null = null;
  private inkBroken = false;
  /** The ink, twice (the simulation reads one and writes the other). [0] is the newest. */
  private dye: [Target, Target] | null = null;
  /** Half-float ink (else 8 bits, square-root encoded). */
  private dyeHalf = false;
  private paper: Target | null = null;
  /** Ink texels per sky pixel: tendrils need some, but it's all soft enough for half. */
  inkScale = 0.5;

  constructor(private sky: SkyContext) {}

  /** Compiles the ink the first time it's asked for. False if this device can't run it. */
  supported(): boolean {
    if (this.inkBroken) return false;
    if (this.inkSim && this.inkView && this.inkPaper && this.inkCopy) return true;
    this.inkSim = this.sky.build(VERT, INK_SIM_FRAG, INK_SIM_UNIFORMS, "ink sim");
    this.inkView = this.inkSim ? this.sky.build(VERT, INK_VIEW_FRAG, INK_VIEW_UNIFORMS, "ink view") : null;
    this.inkPaper = this.inkView ? this.sky.build(VERT, INK_PAPER_FRAG, INK_PAPER_UNIFORMS, "ink paper") : null;
    this.inkCopy = this.inkPaper ? this.sky.build(VERT, INK_COPY_FRAG, INK_COPY_UNIFORMS, "ink copy") : null;
    if (!this.inkSim || !this.inkView || !this.inkPaper || !this.inkCopy) {
      this.inkBroken = true;
      return false;
    }
    return true;
  }

  /** A texture to draw into: half-float if asked (and possible), else 8 bits. Null if neither works. */
  private makeTarget(w: number, h: number, half: boolean): Target | null {
    const gl = this.sky.gl;
    const tex = gl.createTexture();
    const fb = gl.createFramebuffer();
    if (!tex || !fb) return null;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    if (half && this.sky.gl2) {
      const g2 = gl as WebGL2RenderingContext;
      g2.texImage2D(g2.TEXTURE_2D, 0, g2.RGBA16F, w, h, 0, g2.RGBA, g2.HALF_FLOAT, null);
    } else if (half) {
      const ext = gl.getExtension("OES_texture_half_float");
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, ext ? ext.HALF_FLOAT_OES : gl.UNSIGNED_BYTE, null);
    } else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
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
    return { fb, tex, w, h };
  }

  /** Whether this device can draw ink into half-floats (smoother faint ink) — asked once. */
  private halfOk: boolean | null = null;
  private canHalf(): boolean {
    if (this.halfOk !== null) return this.halfOk;
    const gl = this.sky.gl;
    if (this.sky.gl2) this.halfOk = Boolean(gl.getExtension("EXT_color_buffer_float") || gl.getExtension("EXT_color_buffer_half_float"));
    else this.halfOk = Boolean(gl.getExtension("OES_texture_half_float") && gl.getExtension("OES_texture_half_float_linear") && gl.getExtension("EXT_color_buffer_half_float"));
    return this.halfOk;
  }

  /** The ink's two textures, at about half the sky's resolution — carrying the ink over when the size changes. */
  private ensureDye(): boolean {
    const w = Math.max(32, Math.round(this.sky.canvas.width * this.inkScale));
    const h = Math.max(32, Math.round(this.sky.canvas.height * this.inkScale));
    if (this.dye && this.dye[0].w === w && this.dye[0].h === h) return true;
    const gl = this.sky.gl;
    let half = this.canHalf();
    let a = this.makeTarget(w, h, half);
    let b = a && this.makeTarget(w, h, half);
    if ((!a || !b) && half) {
      if (a) dropTarget(this.sky.gl, a);
      half = false;
      this.halfOk = false;
      a = this.makeTarget(w, h, false);
      b = a && this.makeTarget(w, h, false);
    }
    if (!a || !b) {
      if (a) dropTarget(this.sky.gl, a);
      this.inkBroken = true;
      return false;
    }
    const old = this.dye;
    if (old && this.inkCopy && this.dyeHalf === half) {
      // keep the ink: copy it across, both states
      gl.useProgram(this.inkCopy.prog);
      gl.uniform2f(this.inkCopy.loc.uRes, w, h);
      gl.activeTexture(gl.TEXTURE0);
      gl.uniform1i(this.inkCopy.loc.uSrc, 0);
      for (const [from, to] of [
        [old[0], a],
        [old[1], b],
      ] as const) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, to.fb);
        gl.viewport(0, 0, w, h);
        gl.bindTexture(gl.TEXTURE_2D, from.tex);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
      }
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, this.sky.canvas.width, this.sky.canvas.height);
    }
    if (old) {
      dropTarget(this.sky.gl, old[0]);
      dropTarget(this.sky.gl, old[1]);
    }
    this.dye = [a, b];
    this.dyeHalf = half;
    return true;
  }

  /** The paper, painted once for this size. */
  private ensurePaper(): boolean {
    const w = this.sky.canvas.width;
    const h = this.sky.canvas.height;
    if (this.paper && this.paper.w === w && this.paper.h === h) return true;
    if (this.paper) dropTarget(this.sky.gl, this.paper);
    this.paper = this.makeTarget(w, h, false);
    if (!this.paper || !this.inkPaper) return false;
    const gl = this.sky.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.paper.fb);
    gl.viewport(0, 0, w, h);
    gl.useProgram(this.inkPaper.prog);
    gl.uniform2f(this.inkPaper.loc.uRes, w, h);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return true;
  }

  /** Compiled, with its textures made at the right size. */
  ready() {
    return this.supported() && this.ensureDye() && this.ensurePaper();
  }

  /** Whether the ink is kept in half-floats (else 8 bits). */
  get half() {
    return this.dyeHalf;
  }

  invalidate() {}

  restore() {
    this.inkSim = this.inkView = this.inkPaper = this.inkCopy = null;
    this.dye = null;
    this.paper = null;
    this.inkBroken = false;
  }

  render(f: SkyFrame) {
    const gl = this.sky.gl;
    const I = f.ink;
    const S = this.inkSim!;
    const V = this.inkView!;
    let dye = this.dye!;
    if (I.reset) {
      for (const t of dye) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, t.fb);
        gl.clearColor(0, 0, 0, 1);
        gl.clear(gl.COLOR_BUFFER_BIT);
      }
    }
    // the simulation's steps
    if (I.steps.length) {
      const w = dye[0].w;
      const h = dye[0].h;
      gl.useProgram(S.prog);
      gl.uniform2f(S.loc.uRes, w, h);
      gl.uniform1f(S.loc.uAspect, I.aspect);
      gl.uniform4f(S.loc.uPanel, I.panel[0], I.panel[1], I.panel[2], I.panel[3]);
      gl.uniform4f(S.loc.uStir, I.stir[0], I.stir[1], I.stir[2], I.stir[3]);
      gl.uniform1f(S.loc.uEncode, this.dyeHalf ? 0 : 1);
      gl.uniform1f(S.loc.uClear, I.clear);
      gl.uniform1f(S.loc.uFlow, I.flow);
      gl.activeTexture(gl.TEXTURE0);
      gl.uniform1i(S.loc.uDye, 0);
      gl.viewport(0, 0, w, h);
      for (const st of I.steps) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, dye[1].fb);
        gl.bindTexture(gl.TEXTURE_2D, dye[0].tex);
        gl.uniform1f(S.loc.uTime, st.t);
        gl.uniform1f(S.loc.uDt, st.dt);
        gl.uniform4fv(S.loc.uBloomA, st.A);
        gl.uniform4fv(S.loc.uBloomB, st.B);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        dye = [dye[1], dye[0]];
      }
      this.dye = dye;
    }
    // and the picture
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    const W = this.sky.canvas.width;
    const Hh = this.sky.canvas.height;
    gl.viewport(0, 0, W, Hh);
    gl.useProgram(V.prog);
    const k = this.sky.scale;
    const fy = (y: number) => Hh - y * k;
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, dye[1].tex);
    gl.uniform1i(V.loc.uDye0, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, dye[0].tex);
    gl.uniform1i(V.loc.uDye1, 1);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, this.paper!.tex);
    gl.uniform1i(V.loc.uPaper, 2);
    gl.activeTexture(gl.TEXTURE0);
    gl.uniform1f(V.loc.uMix, I.mix);
    gl.uniform2f(V.loc.uRes, W, Hh);
    gl.uniform1f(V.loc.uTime, f.time);
    gl.uniform1f(V.loc.uEncode, this.dyeHalf ? 0 : 1);
    const p = f.panel;
    gl.uniform4f(V.loc.uPanel, p.x * k, Hh - (p.y + p.h) * k, (p.x + p.w) * k, Hh - p.y * k);
    gl.uniform1f(V.loc.uPanelR, p.r * k);
    gl.uniform1f(V.loc.uBehind, I.behind);
    [V.loc.uRipple0, V.loc.uRipple1, V.loc.uRipple2].forEach((l, i) => {
      const r = I.ripples[i];
      if (r) gl.uniform4f(l, r[0] * k, fy(r[1]), r[2], r[3]);
      else gl.uniform4f(l, 0, 0, 0, 0);
    });
    gl.uniform4f(V.loc.uIntro, I.intro[0], I.intro[1], I.intro[2], I.intro[3]);
    gl.uniform2f(V.loc.uDrop, I.drop.x * k, fy(I.drop.y));
    gl.uniform1f(V.loc.uFade, I.fade);
    gl.uniform1f(V.loc.uQuality, this.sky.quality);
    gl.uniform3f(V.loc.uA, f.a[0], f.a[1], f.a[2]);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
}
