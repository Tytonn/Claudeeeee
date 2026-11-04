import { KIND_DROP } from "./fluid";

/**
 * Where and how new ink blooms in the Ink scene: mostly low, and along the sides, now and then
 * up in a corner — never right behind the note. Shared by the engine and the test harness.
 * Coordinates are in screen heights: x 0..aspect, y 0..1 (up).
 */
export type InkBloom = {
  x: number;
  y: number;
  /** Its size (screen heights). */
  r: number;
  /** When it starts (s, on the simulation's clock). */
  t0: number;
  /** How much ink, at its height (per second). */
  amount: number;
  /** How much of it is indigo, 0..1 (the rest charcoal). */
  indigo: number;
  /** How hard it opens out. */
  push: number;
  seed: number;
};

export type Rect = { x0: number; y0: number; x1: number; y1: number };

/** Ink's colours: charcoal and indigo, or with the accent's ink among them too. */
export type InkColours = "sumi" | "accent";

/**
 * A bloom's colours, as the simulations read them: 0..1 how much of it is indigo (the rest
 * charcoal); 2..3 how much of it is the accent's (the rest charcoal; real water only).
 */
export function inkColour(rand: () => number, colours: InkColours = "sumi"): number {
  const between = (a: number, b: number) => a + (b - a) * rand();
  if (colours === "accent" && rand() < 0.42) return 2 + between(0.6, 1);
  return rand() < 0.38 ? between(0.3, 0.8) : between(0, 0.1);
}


/**
 * A drop of ink plunging into the water from its surface (the top of the screen), in real water:
 * mostly beside your words, where it shows best, now and then over them. `column` is the words'
 * column (screen heights); `scale` as for newBloom.
 */
export function newDrop(rand: () => number, t0: number, aspect: number, column: Rect | null, scale = 1, colours: InkColours = "sumi"): InkBloom {
  const between = (a: number, b: number) => a + (b - a) * rand();
  let x = between(0.05, aspect - 0.05);
  if (column && rand() < 0.78) {
    const left = column.x0 - 0.04;
    const right = aspect - 0.04 - column.x1;
    if (left > 0.05 || right > 0.05) {
      const toLeft = rand() < left / Math.max(1e-3, left + right);
      x = toLeft ? between(0.04, Math.max(0.05, column.x0 - 0.02)) : between(Math.min(aspect - 0.05, column.x1 + 0.02), aspect - 0.04);
    }
  }
  return {
    x,
    y: 0.995,
    r: between(0.03, 0.048) * scale,
    t0,
    amount: between(2.3, 3.3),
    indigo: inkColour(rand, colours),
    push: between(0.9, 1.4) * scale,
    seed: KIND_DROP + rand() * 100,
  };
}

/**
 * `scale` shrinks the clouds on narrow screens (a phone is tall: a cloud sized by the screen's
 * height would fill its width).
 */
export function newBloom(rand: () => number, t0: number, aspect: number, panel: Rect | null, big = false, scale = 1, colours: InkColours = "sumi"): InkBloom {
  const between = (a: number, b: number) => a + (b - a) * rand();
  let x = 0;
  let y = 0;
  const pick = rand();
  const low = pick < 0.52;
  if (low) {
    // low: anywhere along the bottom
    x = between(0.04, aspect - 0.04);
    y = between(0.03, 0.2);
  } else if (pick < 0.9) {
    // along a side
    const left = rand() < 0.5;
    const w = Math.min(0.2, aspect * 0.14);
    x = left ? between(0.02, w) : between(aspect - w, aspect - 0.02);
    y = between(0.12, 0.82);
  } else {
    // up in a corner
    const left = rand() < 0.5;
    x = left ? between(0.03, 0.2) : between(aspect - 0.2, aspect - 0.03);
    y = between(0.8, 0.96);
  }
  // never behind the note: slide out to its nearest side (or below it)
  if (panel && x > panel.x0 - 0.04 && x < panel.x1 + 0.04 && y > panel.y0 - 0.04 && y < panel.y1 + 0.04) {
    const toLeft = x - (panel.x0 - 0.06);
    const toRight = panel.x1 + 0.06 - x;
    const toBottom = y - (panel.y0 - 0.06);
    const m = Math.min(toLeft, toRight, toBottom);
    if (m === toBottom && panel.y0 > 0.12) y = Math.max(0.03, panel.y0 - between(0.05, 0.1));
    else if (m === toLeft && panel.x0 > 0.1) x = Math.max(0.02, panel.x0 - between(0.04, 0.1));
    else if (panel.x1 < aspect - 0.1) x = Math.min(aspect - 0.02, panel.x1 + between(0.04, 0.1));
    // nowhere beside it: hug the bottom edge, under it
    else y = between(0, Math.max(0.02, panel.y0 - 0.01));
  }
  const indigo = inkColour(rand, colours);
  return {
    x,
    y,
    r: (big ? between(0.08, 0.11) : low ? between(0.07, 0.13) : between(0.05, 0.1)) * scale,
    t0,
    amount: big ? between(2.4, 3.0) : between(1.5, 2.6),
    indigo,
    push: (big ? between(0.12, 0.16) : between(0.07, 0.13)) * scale,
    seed: rand() * 100,
  };
}

/** A small, repeatable random-number generator (so a test can ask for the same ink twice). */
export function seeded(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return ((s >>> 0) % 1_000_000) / 1_000_000;
  };
}
