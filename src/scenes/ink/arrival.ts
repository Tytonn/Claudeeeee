import type { InkBloom } from "./blooms";

/**
 * Arriving in Ink, as numbers: the dark, the drop falling through it, its landing, the paper
 * opening out of the dark. Shared by the engine and the test harness, so both play it alike.
 * Times are in seconds from the start of the fall.
 */

/** How long the drop takes to fall to the middle of the screen (fast: a drop of ink, let go). */
export const FALL = 0.3;
/** When the page may start coming back up (it fades in over the paper as that opens). */
export const REVEAL = FALL + 0.72;
/** When the last of the dark lifts. */
export const CLEARED = FALL + 1.65;
/** How quickly a skip brings everything back (ms). */
export const SKIP_MS = 260;

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/**
 * The arrival's look `t` seconds in: [how dark, how far the paper has opened around the drop
 * (screen heights), how far the drop has fallen (0..1; 0 once it has landed), the flash of its
 * landing]. `out` is how far a skip has got, 0..1.
 */
export function arrivalLook(t: number, out = 0): [number, number, number, number] {
  let dark = 1;
  let open = 0;
  let fall = Math.min(1, Math.max(0, t / FALL));
  let flash = 0;
  if (t >= FALL) {
    const u = t - FALL;
    fall = 0;
    // the paper opens around the drop slowly while its ink blooms, then the clearing gathers
    // pace and sweeps out to the edges
    const k = Math.min(1, u / 1.6);
    open = Math.pow(k, 1.55) * 2.1;
    flash = Math.exp(-u * 3.2) * smooth(0, 0.03, u);
    // what's left of the dark (the far corners) thins away
    dark = 1 - smooth(FALL + 0.95, CLEARED, t);
  }
  if (out > 0) {
    dark *= 1 - out;
    open = Math.max(open, 2.1 * out);
    if (fall > 0) fall = 0;
  }
  return [dark, open, fall, flash];
}

/**
 * The ink the drop brings with it, landing at (x, y) (screen heights, y up) at `t0` on the
 * simulation's clock: one deep cloud bursting open, and a smaller, bluer one rolling out of it
 * a moment later. `scale` is the cloud size for the screen (smaller on a phone).
 */
export function dropInk(x: number, y: number, t0: number, seed: () => number, scale = 1): InkBloom[] {
  return [
    // (a seed past 1000 marks it as a drop's splash: see the simulation)
    { x, y, r: 0.066 * scale, t0, amount: 1.7, indigo: 0.22, push: 0.3 * scale, seed: 1000 + seed() * 100 },
    { x: x + 0.03 * scale, y: y - 0.02 * scale, r: 0.034 * scale, t0: t0 + 0.35, amount: 0.9, indigo: 0.7, push: 0.08 * scale, seed: seed() * 100 },
  ];
}
