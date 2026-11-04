import type { SceneId } from "../lib/types";
import type { SceneUI } from "./types";
import { galaxyUI } from "./galaxy/ui";
import { solarUI } from "./solar/ui";
import { rainUI } from "./rain/ui";
import { inkUI } from "./ink/ui";
import { skyUI } from "./sky/ui";

export type { SceneCommand, SceneUI } from "./types";

/** Each scene as the interface shows it: its card, its icon, its own settings and commands. */
export const SCENE_UI: Record<SceneId, SceneUI> = {
  eclipse: galaxyUI,
  solar: solarUI,
  rain: rainUI,
  ink: inkUI,
  sky: skyUI,
};
