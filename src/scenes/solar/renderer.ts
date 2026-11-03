import { VERT, type Program } from "../../fx/gl";
import type { SceneRenderer, SkyContext } from "../../fx/renderer";
import type { SkyFrame } from "../../fx/sky";
import { SOLAR_CLOUD_FRAG, SOLAR_CLOUD_UNIFORMS, SOLAR_SKY_FRAG, SOLAR_SKY_UNIFORMS } from "./shaders";

/**
 * The solar eclipse: two passes. The clouds go into a small texture (they're soft, and drift
 * slowly: at most 30 times a second); then the sky and the eclipse at full resolution, with
 * the clouds laid over them. Compiled the first time it's needed.
 */
export class SolarRenderer implements SceneRenderer {
  private solarClouds: Program | null = null;
  private solarSky: Program | null = null;
  private solarBroken = false;
  private cloudTarget: { fb: WebGLFramebuffer; tex: WebGLTexture; w: number; h: number } | null = null;
  /** When the clouds were last painted (ms); like the city, at most 30 times a second. */
  private cloudsAt = -1;
  /** The cloud texture is empty (clear skies): nothing to repaint. */
  private cloudsClear = false;
  /** Cloud texels per sky pixel: they're soft, half is plenty. */
  cloudScale = 0.5;

  constructor(private sky: SkyContext) {}

  /** Compiles the solar eclipse the first time it's asked for. False if this device can't run it. */
  supported(): boolean {
    if (this.solarBroken) return false;
    if (this.solarClouds && this.solarSky) return true;
    this.solarClouds = this.sky.build(VERT, SOLAR_CLOUD_FRAG, SOLAR_CLOUD_UNIFORMS, "solar clouds");
    this.solarSky = this.solarClouds ? this.sky.build(VERT, SOLAR_SKY_FRAG, SOLAR_SKY_UNIFORMS, "solar sky") : null;
    if (!this.solarClouds || !this.solarSky) {
      this.solarBroken = true;
      return false;
    }
    return true;
  }

  /** The small texture the clouds are painted into. */
  private ensureCloudTarget(): boolean {
    const gl = this.sky.gl;
    const w = Math.max(16, Math.round(this.sky.canvas.width * this.cloudScale));
    const h = Math.max(16, Math.round(this.sky.canvas.height * this.cloudScale));
    if (this.cloudTarget && this.cloudTarget.w === w && this.cloudTarget.h === h) return true;
    if (this.cloudTarget) {
      gl.deleteFramebuffer(this.cloudTarget.fb);
      gl.deleteTexture(this.cloudTarget.tex);
      this.cloudTarget = null;
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
      this.solarBroken = true;
      return false;
    }
    this.cloudTarget = { fb, tex, w, h };
    this.cloudsAt = -1;
    this.cloudsClear = false;
    return true;
  }

  ready() {
    return this.supported() && this.ensureCloudTarget();
  }

  invalidate() {
    this.cloudsAt = -1;
  }

  restore() {
    this.solarClouds = this.solarSky = null;
    this.cloudTarget = null;
    this.solarBroken = false;
  }

  render(f: SkyFrame) {
    const gl = this.sky.gl;
    const s = f.solar;
    const T = this.cloudTarget!;
    const W = this.sky.canvas.width;
    const H = this.sky.canvas.height;
    const k = this.sky.scale;
    const fy = (y: number) => (this.sky.cssH - y) * k;
    const shared = (L: Program["loc"], w: number, h: number) => {
      gl.uniform2f(L.uRes, w, h);
      gl.uniform2f(L.uView, W, H);
      gl.uniform1f(L.uTime, f.time);
      gl.uniform1f(L.uScale, Math.min(W, H));
      gl.uniform1f(L.uQuality, this.sky.quality);
      gl.uniform3f(L.uSun, s.sun.x * k, fy(s.sun.y), s.sun.r * k);
      gl.uniform1f(L.uLight, s.light);
      gl.uniform3f(L.uGlare, s.glare.x, -s.glare.y, s.glare.v);
      gl.uniform1f(L.uCorona, s.corona);
      gl.uniform2f(L.uMouse, f.mouse.x * k, fy(f.mouse.y));
      gl.uniform3f(L.uA, f.a[0], f.a[1], f.a[2]);
      gl.uniform3f(L.uB, f.b[0], f.b[1], f.b[2]);
      gl.uniform1f(L.uGold, s.gold);
    };

    // 1 · the clouds, small. They drift slowly, so 30 times a second is plenty — except while
    // the light on them is changing quickly (the diamond ring, the intro).
    const now = performance.now();
    if (s.clouds <= 0) {
      // Clear skies: an empty texture, and nothing to paint into it.
      if (!this.cloudsClear) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, T.fb);
        gl.viewport(0, 0, T.w, T.h);
        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        this.cloudsClear = true;
      }
    } else {
      const fresh =
        this.cloudsClear ||
        this.cloudsAt < 0 ||
        now - this.cloudsAt > 32 ||
        now < this.cloudsAt ||
        s.glare.v > 0.002 ||
        s.light > 0.0004 ||
        s.fade < 0.999 ||
        s.clouds < 1 ||
        (s.gold > 0.001 && s.gold < 0.999);
      if (fresh) {
        this.cloudsAt = now;
        this.cloudsClear = false;
        const C = this.solarClouds!;
        gl.bindFramebuffer(gl.FRAMEBUFFER, T.fb);
        gl.viewport(0, 0, T.w, T.h);
        gl.useProgram(C.prog);
        shared(C.loc, T.w, T.h);
        gl.uniform1f(C.loc.uCloudy, s.clouds);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      }
    }

    // 2 · the sky, the eclipse, the clouds laid over it, the glare
    const S = this.solarSky!;
    const L = S.loc;
    gl.viewport(0, 0, W, H);
    gl.useProgram(S.prog);
    shared(L, W, H);
    gl.uniform2f(L.uMoon, s.moon.x, -s.moon.y);
    gl.uniform4f(L.uTint, s.tint[0], s.tint[1], s.tint[2], s.tint[3]);
    gl.uniform2f(L.uGoldShift, s.goldShift[0], s.goldShift[1]);
    gl.uniform4f(L.uErupt, -s.erupt[0], s.erupt[1], s.erupt[2], s.erupt[3]);
    gl.uniform1f(L.uCursor, f.cursor);
    gl.uniform1f(L.uDim, f.dim);
    gl.uniform1f(L.uFade, s.fade);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, T.tex);
    gl.uniform1i(L.uClouds, 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
}
