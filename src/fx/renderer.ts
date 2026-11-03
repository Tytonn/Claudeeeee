import type { GL, Program } from "./gl";
import type { SkyFrame } from "./sky";

/** What a scene's renderer can see of the sky it draws into (the Sky itself). */
export interface SkyContext {
  readonly gl: GL;
  readonly gl2: boolean;
  readonly canvas: HTMLCanvasElement;
  /** The screen's size in CSS px, and buffer px per CSS px. */
  readonly cssW: number;
  readonly cssH: number;
  readonly scale: number;
  /** 1: full detail; 0: the lighter version. */
  readonly quality: number;
  /** City texels per CSS pixel (the rain's). */
  readonly cityScale: number;
  /** Compiles a program (null, with a warning, if it won't build). */
  build(vert: string, frag: string, uniforms: string[], label: string): Program | null;
  /** Sets the three shockwave uniforms (the galaxy's and the rain's). */
  shocks(loc: Program["loc"], f: SkyFrame, fy: (y: number) => number): void;
}

/**
 * A scene's sky: everything it draws with, and how it draws a frame. One per scene, listed in
 * fx/sky.ts; each lives with its scene (scenes/<id>/renderer.ts).
 */
export interface SceneRenderer {
  /** Compiles what it needs, the first time it's asked. False if this device can't draw it. */
  supported(): boolean;
  /** Ready to draw this frame: compiled, and its textures made at the right size. */
  ready(): boolean;
  render(f: SkyFrame): void;
  /** Repaint anything it keeps between frames, next time (e.g. for a view transition's snapshot). */
  invalidate(): void;
  /** The context was lost and has come back: everything on the GPU has to be made again. */
  restore(): void;
}
