/**
 * The sky's colours (Settings → Sky colours): each a whole sky — its gradient from the horizon to
 * overhead, the sun and its glow, and the clouds' light, shade and the glow along their edges.
 * The sun sits where the light comes from for each (low for golden hour and sunset; below the
 * horizon at twilight, when the first stars are out).
 */

import type { SkyPaletteId } from "../../lib/types";

export type { SkyPaletteId };

type RGB = [number, number, number];

export type SkyPalette = {
  name: string;
  /** For the swatch in Settings: the sky at its middle, and a cloud's glow. */
  swatch: [string, string];
  zenith: RGB;
  mid: RGB;
  horizon: RGB;
  /** The low haze along the horizon. */
  haze: RGB;
  sunCore: RGB;
  sunGlow: RGB;
  cloudLit: RGB;
  cloudShade: RGB;
  /** The glow along a cloud's edges toward the sun. */
  cloudRim: RGB;
  /** Where the sun is: x across the screen 0..1, y up from the bottom 0..1 (below 0: set). */
  sun: [number, number];
  /** How many stars are out, 0..1. */
  stars: number;
};

const hex = (h: string): RGB => {
  const n = parseInt(h.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
};

export const SKY_PALETTES: Record<SkyPaletteId, SkyPalette> = {
  // the reference: a deep, saturated blue overhead, bright cyan at the horizon, white clouds
  // with lavender undersides blushing pink, and the sun low on the left pouring rays through
  azure: {
    name: "Azure",
    swatch: ["#2f7deb", "#ffd6ec"],
    zenith: hex("#0d3cc4"),
    mid: hex("#2a78ee"),
    horizon: hex("#9fd8ff"),
    haze: hex("#d9f0ff"),
    sunCore: hex("#fffbf0"),
    sunGlow: hex("#fff2cf"),
    cloudLit: hex("#ffffff"),
    cloudShade: hex("#8f9fe6"),
    cloudRim: hex("#ffb8dc"),
    sun: [0.2, 0.2],
    stars: 0,
  },
  // cotton candy: periwinkle overhead melting into pink, clouds of pink and lilac
  pastel: {
    name: "Pastel",
    swatch: ["#b9b5f5", "#ffc4dc"],
    zenith: hex("#6f86ea"),
    mid: hex("#b4b4f6"),
    horizon: hex("#ffd2e2"),
    haze: hex("#fff0f5"),
    sunCore: hex("#fffaf8"),
    sunGlow: hex("#ffe6ee"),
    cloudLit: hex("#fffafc"),
    cloudShade: hex("#b8a0e0"),
    cloudRim: hex("#ff9ec8"),
    sun: [0.78, 0.66],
    stars: 0,
  },
  // golden hour: blue overhead, warm gold along the horizon, clouds lit amber and peach
  golden: {
    name: "Golden",
    swatch: ["#e9b56d", "#ffe2a8"],
    zenith: hex("#2a5ac4"),
    mid: hex("#7e9fd8"),
    horizon: hex("#ffc98a"),
    haze: hex("#fff0d0"),
    sunCore: hex("#fff6dc"),
    sunGlow: hex("#ffcf7a"),
    cloudLit: hex("#fff0d2"),
    cloudShade: hex("#9a8bb8"),
    cloudRim: hex("#ffad60"),
    sun: [0.24, 0.15],
    stars: 0,
  },
  // sunset: the sun down on the horizon, the sky burning orange and rose into violet
  sunset: {
    name: "Sunset",
    swatch: ["#f08a5d", "#ff6f91"],
    zenith: hex("#3a2f86"),
    mid: hex("#c45f8a"),
    horizon: hex("#ff9a5a"),
    haze: hex("#ffd2a0"),
    sunCore: hex("#fff0d0"),
    sunGlow: hex("#ff9a52"),
    cloudLit: hex("#ffc39a"),
    cloudShade: hex("#6d4d8e"),
    cloudRim: hex("#ff6f7d"),
    sun: [0.5, 0.07],
    stars: 0,
  },
  // twilight: the sun just set, indigo overhead, a band of rose along the horizon, the first stars
  twilight: {
    name: "Twilight",
    swatch: ["#3b3a8c", "#ff9ab0"],
    zenith: hex("#10164a"),
    mid: hex("#4a3f8c"),
    horizon: hex("#f39aa6"),
    haze: hex("#ffc2bc"),
    sunCore: hex("#ffe2d4"),
    sunGlow: hex("#ff9a8a"),
    cloudLit: hex("#e2a6c8"),
    cloudShade: hex("#3c3570"),
    cloudRim: hex("#ff8ca0"),
    sun: [0.56, -0.05],
    stars: 1,
  },
};

export const SKY_PALETTE_ORDER: readonly SkyPaletteId[] = ["azure", "pastel", "golden", "sunset", "twilight"];

/** A saved palette, or Azure if it isn't one we know. */
export function skyPaletteOf(id: unknown): SkyPaletteId {
  return typeof id === "string" && Object.prototype.hasOwnProperty.call(SKY_PALETTES, id) ? (id as SkyPaletteId) : "azure";
}

/** The palette's numbers, flat, in the order the sky's shaders want them (see SkyScene). */
export function paletteVector(p: SkyPalette): number[] {
  return [...p.zenith, ...p.mid, ...p.horizon, ...p.haze, ...p.sunCore, ...p.sunGlow, ...p.cloudLit, ...p.cloudShade, ...p.cloudRim, p.sun[0], p.sun[1], p.stars];
}
