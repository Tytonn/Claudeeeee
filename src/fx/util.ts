/* Small things the light engine and every scene's controller share. */

/** An RGB colour, 0..255. */
export type C255 = [number, number, number];

/** Something that plays out over time: when it starts and how long it lasts (ms, effects clock). */
export type Timed = { t0: number; dur: number };

export const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);
export const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
export const clamp01 = (t: number) => Math.min(1, Math.max(0, t));
export const rand = (a: number, b: number) => a + Math.random() * (b - a);
export const smooth = (a: number, b: number, x: number) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};

export const WHITE: C255 = [255, 255, 255];
export const WATER: C255 = [196, 222, 255];
export const SUNLIGHT: C255 = [255, 222, 186];
