import { VERT, type Program } from "../../fx/gl";
import type { SceneRenderer, SkyContext } from "../../fx/renderer";
import type { SkyFrame } from "../../fx/sky";
import { FRAG } from "./shaders";

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
  "uCursor",
  "uOpen",
  "uMoon",
  "uCoronaK",
];

/**
 * The galaxy: one pass — deep space, the nebula, the stars, and the corona streaming out from
 * behind the note. It's built with the sky itself: every other scene falls back on it.
 */
export class GalaxyRenderer implements SceneRenderer {
  private prog: Program | null = null;

  constructor(private sky: SkyContext) {}

  /** Compiles it (with the sky: without it there's no sky at all). */
  build(): boolean {
    this.prog = this.sky.build(VERT, FRAG, ECLIPSE_UNIFORMS, "sky");
    return Boolean(this.prog);
  }

  supported() {
    return Boolean(this.prog);
  }

  ready() {
    return Boolean(this.prog);
  }

  invalidate() {}

  restore() {
    this.prog = null;
  }

  render(f: SkyFrame) {
    const gl = this.sky.gl;
    const P = this.prog!;
    gl.useProgram(P.prog);
    const k = this.sky.scale;
    const W = this.sky.canvas.width;
    const H = this.sky.canvas.height;
    const fy = (y: number) => (this.sky.cssH - y) * k; // CSS (y down) → GL (y up)
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
    this.sky.shocks(L, f, fy);
    gl.uniform1f(L.uScale, Math.min(W, H));
    gl.uniform1f(L.uQuality, this.sky.quality);
    gl.uniform1f(L.uCursor, f.cursor);
    gl.uniform1f(L.uOpen, f.open);
    gl.uniform1f(L.uMoon, f.eclipse);
    gl.uniform1f(L.uCoronaK, f.corona);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
}
