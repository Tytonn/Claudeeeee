/**
 * Is anyone at the keyboard? Live notes and shared pages only check in with the server while
 * someone's there to see the answer — so a tab left open overnight costs nothing.
 */

/** No key, click, touch or wheel for this long: idle (check in less often). */
export const IDLE_AFTER = 120_000;
/** …this long: asleep (barely check in). */
export const ASLEEP_AFTER = 600_000;
/** …this long: away (stop checking in until they're back). */
export const AWAY_AFTER = 1_800_000;

let lastInput = Date.now();
const wakers = new Set<() => void>();

if (typeof window !== "undefined") {
  for (const type of ["keydown", "pointerdown", "pointermove", "wheel", "touchstart"] as const) {
    addEventListener(
      type,
      () => {
        const now = Date.now();
        const gap = now - lastInput;
        lastInput = now;
        // back after a quiet spell: whoever stopped checking in starts again right away
        if (gap > IDLE_AFTER) wakers.forEach((wake) => wake());
      },
      { passive: true, capture: true },
    );
  }
}

/** When the person at this keyboard last did anything. */
export const lastInputAt = () => lastInput;

/** Calls `fn` whenever someone comes back after being idle (or longer). */
export function onWake(fn: () => void): () => void {
  wakers.add(fn);
  return () => wakers.delete(fn);
}
