import { VERT, type Program } from "../../fx/gl";
import type { SceneRenderer, SkyContext } from "../../fx/renderer";
import type { SkyFrame } from "../../fx/sky";
import { SKY_CLOUD_FRAG, SKY_CLOUD_UNIFORMS, SKY_VIEW_FRAG, SKY_VIEW_UNIFORMS } from "./shaders";

/** The palette's uniforms, in the order of paletteVector (palettes.ts). */
const PALETTE = ["uZenith", "uMid", "uHorizon", "uHaze", "uSunCore", "uSunGlow", "uLit", "uShade", "uRim", "uSunAt"] as const;

/**
 * The Sky: two passes, as the solar eclipse does. The clouds are soft, so they're lit into a
 * texture at half the resolution (at most 30 times a second: they drift slowly — more often
 * while they're being pushed about); then the sky, the sun, its rays and the clouds over them
 * at full resolution. Compiled the first time it's needed.
 */
export class SkyRenderer implements SceneRenderer {
  private clouds: Program | null = null;
  private view: Program | null = null;
  private broken = false;
  private target: { fb: WebGLFramebuffer; tex: WebGLTexture; w: number; h: number } | null = null;
  /** When the clouds were last lit (ms). */
  private cloudsAt = -1;
  /** Cloud texels per sky pixel: they're soft, half is plenty. */
  cloudScale = 0.5;

  constructor(private sky: SkyContext) {}

  supported(): boolean {
    if (this.broken) return false;
    if (this.clouds && this.view) return true;
    this.clouds = this.sky.build(VERT, SKY_CLOUD_FRAG, SKY_CLOUD_UNIFORMS, "sky clouds");
    this.view = this.clouds ? this.sky.build(VERT, SKY_VIEW_FRAG, SKY_VIEW_UNIFORMS, "sky") : null;
    if (!this.clouds || !this.view) {
      this.broken = true;
      return false;
    }
    return true;
  }

  /** The small texture the clouds are lit into. */
  private ensureTarget(): boolean {
    const gl = this.sky.gl;
    const w = Math.max(16, Math.round(this.sky.canvas.width * this.cloudScale));
    const h = Math.max(16, Math.round(this.sky.canvas.height * this.cloudScale));
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
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    const ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    if (!ok) {
      gl.deleteFramebuffer(fb);
      gl.deleteTexture(tex);
      this.broken = true;
      return false;
    }
    this.target = { fb, tex, w, h };
    this.cloudsAt = -1;
    return true;
  }

  ready() {
    return this.supported() && this.ensureTarget();
  }

  invalidate() {
    this.cloudsAt = -1;
  }

  restore() {
    this.clouds = this.view = null;
    this.target = null;
    this.broken = false;
  }

  render(f: SkyFrame) {
    const gl = this.sky.gl;
    const s = f.sky;
    const T = this.target!;
    const W = this.sky.canvas.width;
    const H = this.sky.canvas.height;
    const k = this.sky.scale;
    const fy = (y: number) => (this.sky.cssH - y) * k;
    const pal = s.palette;
    const palette = (L: Program["loc"]) => PALETTE.forEach((n, i) => gl.uniform3f(L[n], pal[i * 3], pal[i * 3 + 1], pal[i * 3 + 2]));

    // 1 · the clouds, small — fresh at most 30 times a second, or every frame while something's
    // moving them quickly (a gust, the colours changing, the arrival)
    const now = performance.now();
    if (this.cloudsAt < 0 || now - this.cloudsAt > 32 || now < this.cloudsAt || s.lively) {
      this.cloudsAt = now;
      const C = this.clouds!;
      const L = C.loc;
      gl.bindFramebuffer(gl.FRAMEBUFFER, T.fb);
      gl.viewport(0, 0, T.w, T.h);
      gl.useProgram(C.prog);
      gl.uniform2f(L.uRes, T.w, T.h);
      gl.uniform2f(L.uView, W, H);
      gl.uniform1f(L.uTime, f.time);
      gl.uniform4f(L.uDrift, s.drift[0], s.drift[1], s.drift[2], s.drift[3]);
      gl.uniform1f(L.uCover, s.cover);
      gl.uniform2f(L.uPar, s.par[0], s.par[1]);
      gl.uniform4f(L.uGust, s.gust[0] * k, fy(s.gust[1]), s.gust[2], s.gust[3]);
      gl.uniform4f(L.uPart, s.part[0] * k, fy(s.part[1]), s.part[2], s.part[3]);
      gl.uniform1f(L.uQuality, this.sky.quality);
      palette(L);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }

    // 2 · the sky, the sun and its rays, the clouds laid over them
    const V = this.view!;
    const L = V.loc;
    gl.viewport(0, 0, W, H);
    gl.useProgram(V.prog);
    gl.uniform2f(L.uRes, W, H);
    gl.uniform1f(L.uTime, f.time);
    gl.uniform1f(L.uRays, s.rays);
    gl.uniform1f(L.uFade, s.fade);
    gl.uniform4f(L.uIntro, s.intro[0], s.intro[1], s.intro[2], 0);
    gl.uniform2f(L.uMouse, f.mouse.x * k, fy(f.mouse.y));
    gl.uniform1f(L.uCursor, f.cursor);
    gl.uniform1f(L.uBurst, s.burst);
    gl.uniform4f(L.uTrail, s.trail[0], s.trail[1], s.trail[2], s.trail[3]);
    gl.uniform1f(L.uTrailAge, s.trailAge);
    palette(L);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, T.tex);
    gl.uniform1i(L.uClouds, 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
}
