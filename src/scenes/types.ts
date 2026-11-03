import type { ComponentType, ReactNode } from "react";
import type { Settings } from "../lib/types";

/** A command a scene adds to the palette while you're in it (filed under Appearance). */
export type SceneCommand = {
  id: string;
  label: string;
  icon: ReactNode;
  keywords?: string;
  hidden?: boolean;
  meta?: string;
  run: () => void;
};

/** A scene, as the interface shows it. */
export type SceneUI = {
  /** Its card's picture in Settings (240 × 72, cropped to the card). */
  Art: ComponentType;
  /** Its icon, in the command palette. */
  icon: ReactNode;
  /** Its own rows in Settings, under the scenes (each decides for itself when to show). */
  Settings?: ComponentType;
  /** Its own commands in the palette, while it's the scene you're in. */
  commands?: (settings: Settings, set: (patch: Partial<Settings>) => void) => SceneCommand[];
};
