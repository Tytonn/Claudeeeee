import { flushSync } from "react-dom";
import { useApp } from "../store/app";
import { sameTheme, type SharedTheme } from "../lib/sharedTheme";
import { webkit } from "../lib/platform";
import { fx } from "./engine";

/**
 * Wearing a shared note's theme (see AppState.borrowed), and taking it off again.
 *
 * Opening a note shared with its owner's theme — or going back to your own notes — isn't a
 * scene change of the dramatic kind (no drop, no curtain of rain): the whole page simply
 * crossfades from one look to the other, quickly, and the new scene comes in already settled.
 * Going straight from one such note to another crossfades once, not out to yours and back.
 */

let swapping = false;
/** A look being put on or taken off right now: its scene comes in as it is (the crossfade is its arrival). */
export const swappingLook = () => swapping;

let pendingOff = 0;

const reducedMotion = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

type ViewTransition = { ready: Promise<void>; finished: Promise<void> };
type StartViewTransition = (cb: () => void) => ViewTransition;

/** Changes the look with a quiet crossfade (where the browser can; else the sky fades over). */
export function crossfadeLook(change: () => void) {
  const run = () => {
    swapping = true;
    try {
      change();
    } finally {
      swapping = false;
    }
  };
  const startVT = (document as Partial<{ startViewTransition: StartViewTransition }>).startViewTransition;
  if (typeof startVT !== "function" || webkit || !fx.active || reducedMotion()) {
    run();
    if (fx.active && !reducedMotion()) fx.fadeSky(700);
    return;
  }
  const root = document.documentElement;
  root.classList.add("vt-look");
  const t = startVT.call(document, () => {
    flushSync(run);
    fx.renderNow();
  });
  const timing = { duration: 560, easing: "cubic-bezier(0.33, 0, 0.2, 1)" };
  t.ready
    .then(() => {
      root.animate({ opacity: [1, 0] }, { ...timing, pseudoElement: "::view-transition-old(root)" });
      root.animate({ opacity: [0, 1] }, { ...timing, pseudoElement: "::view-transition-new(root)" });
    })
    .catch(() => {});
  t.finished.finally(() => root.classList.remove("vt-look"));
}

/** Puts on a shared note's theme (`from`: its link; `by`: whose it is, "@name"). */
export function wearTheme(theme: SharedTheme, from: string, by?: string) {
  window.clearTimeout(pendingOff);
  pendingOff = 0;
  const s = useApp.getState();
  const b = s.borrowed;
  if (b && b.from === from && sameTheme(b.theme, theme)) return;
  const next = { ...(b?.own ?? s.settings), ...theme };
  // (it looks no different from what's showing: no need for a moment of its own)
  if (sameTheme(s.settings, next)) s.borrowTheme(theme, from, by);
  else crossfadeLook(() => useApp.getState().borrowTheme(theme, from, by));
}

/**
 * Back to your own theme. `soon`: a beat later — unless another shared note's theme goes on
 * meanwhile (opening one straight after another).
 */
export function takeOffTheme(from?: string, soon = false) {
  window.clearTimeout(pendingOff);
  pendingOff = 0;
  const go = () => {
    pendingOff = 0;
    const s = useApp.getState();
    if (!s.borrowed || (from !== undefined && s.borrowed.from !== from)) return;
    if (sameTheme(s.settings, s.borrowed.own)) s.returnTheme(from);
    else crossfadeLook(() => useApp.getState().returnTheme(from));
  };
  if (soon) pendingOff = window.setTimeout(go, 90);
  else go();
}
