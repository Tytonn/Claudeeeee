import type { SceneId } from "../lib/types";
import type { FxLevel } from "./engine";

/**
 * A scene's part in the light engine: what it does from moment to moment, how its sky is drawn
 * (resolution, clock, when it must be redrawn), what it gives the renderer each frame, the layer
 * behind the interface, and its own take on the effects (a new note in the rain is lightning, on
 * paper a drop of ink…). One per scene, listed in fx/engine.ts; each lives with its scene
 * (scenes/<id>/controller.ts). Anything left out falls back on the engine's own (the galaxy's).
 */
export interface SceneController {
  readonly id: SceneId;

  /** Once, when the engine starts (before the first frame). */
  init?(): void;
  /** The engine is up and the sky exists: finish whatever needed it (at startup, in this scene). */
  start?(): void;
  /** Whether this device can show it at all (if not, the engine stays with the galaxy). */
  supported(): boolean;
  /** It's becoming the scene; `instant` at startup (no easing in). */
  enter(instant: boolean): void;
  /** Another scene is taking over. */
  leave(): void;
  /** Effects were turned off: let go of anything in flight. */
  clear?(): void;

  /** The sky's resolution, in buffer px per CSS px (before the engine's own speed-keeping). */
  skyScale(): number;
  /** How far the engine may lower that to keep up. */
  readonly floor: number;
  /** Full-detail shaders even on a small screen. */
  readonly detailOnSmall: boolean;
  /** How fast the sky's own clock runs right now (the galaxy slows while you write). */
  timeRate(level: FxLevel): number;

  /** Each frame, before the sky is drawn. */
  step(now: number, dt: number, idle: boolean): void;
  /** Something's moving: draw the sky every frame (else it may be drawn less often while you write). */
  busy(): boolean;
  /** Draw the sky this frame, whatever else is going on. */
  mustRender(): boolean;
  /** Whether there's a sky to draw at all. */
  drawsSky(): boolean;
  /** The sky has just been drawn. */
  rendered?(): void;
  /** After the sky: the layer behind the interface (the galaxy's dust and shooting stars; most just keep it clear). */
  behind(now: number, dt: number, idle: boolean): void;

  /** The effects fall as drops of water rather than sparks of light. */
  readonly drops: boolean;
  /** How strong a flash of light is here (on paper a little goes a long way). */
  readonly flashK: number;
  /** Its own take on the effects — true when it has played its own. */
  newNote?(): boolean;
  checked?(x: number, y: number): boolean;
  beam?(x: number, y: number): boolean;
  prominence?(x: number, y: number, r: number): boolean;
  /** The accent changed (to this colour). */
  accent?(color: string): void;
}
