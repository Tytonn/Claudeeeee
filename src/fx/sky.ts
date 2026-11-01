import { FRAG, VERT } from "./shaders";
import type { RGB } from "./color";

export type SkyFrame = {
  time: number;
  mouse: { x: number; y: number }; // CSS px
  panel: { x: number; y: number; w: number; h: number; r: number; circle: boolean }; // CSS px rect
  a: RGB;
  b: RGB;
  energy: number;
  flare: number;
  dim: number;
  ring: { x: number; y: number; v: number };
  shocks: { x: number; y: number; age: number; strength: number }[];
};

const UNIFORMS = [
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
] as const;

export class Sky {
  private gl: WebGLRenderingContext;
  private loc = {} as Record<(typeof UNIFORMS)[number], WebGLUniformLocation | null>;
  private lost = false;
  private cssH = 0;
  scale = 1;
  quality = 1;

  static create(canvas: HTMLCanvasElement): Sky | null {
    try {
      const gl = canvas.getContext("webgl", {
        alpha: false,
        antialias: false,
        depth: false,
        stencil: false,
        premultipliedAlpha: false,
        preserveDrawingBuffer: false,
        powerPreference: "high-performance",
      });
      if (!gl) return null;
      const sky = new Sky(canvas, gl);
      return sky.ok ? sky : null;
    } catch {
      return null;
    }
  }

  private ok = false;

  private constructor(
    private canvas: HTMLCanvasElement,
    gl: WebGLRenderingContext,
  ) {
    this.gl = gl;
    this.setup();
    canvas.addEventListener("webglcontextlost", (e) => {
      e.preventDefault();
      this.lost = true;
    });
    canvas.addEventListener("webglcontextrestored", () => {
      this.lost = false;
      this.setup();
    });
  }

  private setup() {
    const gl = this.gl;
    const compile = (type: number, src: string) => {
      const sh = gl.createShader(type)!;
      gl.shaderSource(sh, src);
      gl.compileShader(sh);
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
        console.warn("sky shader:", gl.getShaderInfoLog(sh));
        return null;
      }
      return sh;
    };
    const vs = compile(gl.VERTEX_SHADER, VERT);
    const fs = compile(gl.FRAGMENT_SHADER, FRAG);
    if (!vs || !fs) return;
    const prog = gl.createProgram()!;
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.bindAttribLocation(prog, 0, "aPos");
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      console.warn("sky program:", gl.getProgramInfoLog(prog));
      return;
    }
    gl.useProgram(prog);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    for (const name of UNIFORMS) this.loc[name] = gl.getUniformLocation(prog, name);
    this.ok = true;
  }

  resize(cssW: number, cssH: number, scale: number) {
    this.scale = scale;
    this.cssH = cssH;
    const w = Math.max(1, Math.round(cssW * scale));
    const h = Math.max(1, Math.round(cssH * scale));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    this.gl.viewport(0, 0, w, h);
  }

  render(f: SkyFrame) {
    if (this.lost || !this.ok) return;
    const gl = this.gl;
    const k = this.scale;
    const W = this.canvas.width;
    const H = this.canvas.height;
    const fy = (y: number) => (this.cssH - y) * k; // CSS (y down) → GL (y up)
    const L = this.loc;
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
    const shocks = [L.uShock0, L.uShock1, L.uShock2];
    shocks.forEach((loc, i) => {
      const s = f.shocks[i];
      if (s) gl.uniform4f(loc, s.x * k, fy(s.y), s.age, s.strength);
      else gl.uniform4f(loc, 0, 0, 0, 0);
    });
    gl.uniform1f(L.uScale, Math.min(W, H));
    gl.uniform1f(L.uQuality, this.quality);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
}
