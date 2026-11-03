import type { Program } from "../../fx/gl";
import type { SceneRenderer, SkyContext } from "../../fx/renderer";
import type { SkyFrame } from "../../fx/sky";
import { rainShaders } from "./shaders";

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
  "uCursor",
];

const pow2 = (n: number) => Math.pow(2, Math.round(Math.log2(Math.max(1, n))));

/**
 * The rain: two passes. The city goes into a mipmapped texture (it moves slowly, so at most 30
 * times a second); then the glass, with every drop a little lens onto it. Compiled the first
 * time it's needed.
 */
export class RainRenderer implements SceneRenderer {
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

  constructor(private sky: SkyContext) {}

  /** Compiles the rain the first time it's asked for. False if this device can't run it. */
  supported(): boolean {
    if (this.rainBroken) return false;
    if (this.rainScene && this.rainGlass) return true;
    if (!this.sky.gl2) this.lodExt = Boolean(this.sky.gl.getExtension("EXT_shader_texture_lod"));
    const src = rainShaders(this.sky.gl2, this.lodExt);
    this.rainScene = this.sky.build(src.vert, src.scene, SCENE_UNIFORMS, "rain scene");
    this.rainGlass = this.rainScene ? this.sky.build(src.vert, src.glass, GLASS_UNIFORMS, "rain glass") : null;
    if (!this.rainScene || !this.rainGlass) {
      this.rainBroken = true;
      return false;
    }
    return true;
  }

  /** The texture the city is painted into: about the screen's own resolution. */
  private ensureTarget(): boolean {
    const gl = this.sky.gl;
    const k = Math.min(this.sky.cityScale, 2048 / Math.max(1, this.sky.cssW, this.sky.cssH));
    let w = Math.max(64, Math.round(this.sky.cssW * k));
    let h = Math.max(64, Math.round(this.sky.cssH * k));
    // WebGL1 can only mipmap power-of-two textures; the stretch doesn't matter, it's sampled by uv.
    if (!this.sky.gl2) {
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

  ready() {
    return this.supported() && this.ensureTarget();
  }

  invalidate() {
    this.cityAt = -1;
  }

  restore() {
    this.rainScene = this.rainGlass = null;
    this.target = null;
    this.rainBroken = false;
  }

  render(f: SkyFrame) {
    const gl = this.sky.gl;
    const T = this.target!;
    const r = f.rain;
    const W = this.sky.canvas.width;
    const H = this.sky.canvas.height;
    const k = this.sky.scale;
    const fy = (y: number) => (this.sky.cssH - y) * k;

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
      gl.uniform1f(S.loc.uAspect, this.sky.cssW / Math.max(1, this.sky.cssH));
      gl.uniform1f(S.loc.uTime, f.time);
      gl.uniform3f(S.loc.uA, f.a[0], f.a[1], f.a[2]);
      gl.uniform1f(S.loc.uCity, r.city);
      gl.uniform1f(S.loc.uAmount, r.amount);
      gl.uniform1f(S.loc.uWet, r.wet);
      gl.uniform4f(S.loc.uFlash, r.flash, r.boltX, r.boltSeed, r.bolt);
      gl.uniform1f(S.loc.uWind, r.wind);
      gl.uniform1f(S.loc.uDim, f.dim);
      gl.uniform1f(S.loc.uQuality, this.sky.quality);
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
    gl.uniform1f(G.loc.uQuality, this.sky.quality);
    gl.uniform1f(G.loc.uLodBase, Math.log2(T.w / W));
    gl.uniform1f(G.loc.uScale, Math.min(W, H));
    gl.uniform1f(G.loc.uFade, r.fade);
    gl.uniform2f(G.loc.uSceneSize, T.w, T.h);
    gl.uniform1f(G.loc.uWind, r.wind);
    gl.uniform1f(G.loc.uBlur, r.blur);
    gl.uniform1f(G.loc.uCursor, f.cursor);
    this.sky.shocks(G.loc, f, fy);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
}
