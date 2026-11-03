import { flushSync } from "react-dom";
import { useApp } from "../store/app";
import { ACCENTS } from "../lib/theme";
import { webkit } from "../lib/platform";
import type { AccentId, SceneId } from "../lib/types";
import { fx } from "./engine";
import { oklchToRgb, to255 } from "./color";

/**
 * The big changes — a new accent, a new scene — get a moment of their own.
 *
 * Where view transitions can be trusted they use them: the new look floods out from where you
 * tapped, or comes down like a sheet of rain. WebKit's view-transition snapshots leave out
 * backdrop blur (the frosted glass goes clear for a second), so on Safari and on iPhone the same
 * moments are drawn live instead: the colour glides, light spills out from the tap, and the sky
 * fades over.
 */

type ViewTransition = { ready: Promise<void>; finished: Promise<void> };
type StartViewTransition = (cb: () => void) => ViewTransition;

function viewTransitions(): StartViewTransition | null {
  const start = (document as Partial<{ startViewTransition: StartViewTransition }>).startViewTransition;
  return typeof start === "function" && !webkit && fx.active ? start.bind(document) : null;
}

const coverRadius = (x: number, y: number) => Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y));

/** The new accent floods out from the swatch, like light spilling across the room. */
export function changeAccent(id: AccentId, x: number, y: number) {
  const s = useApp.getState();
  if (s.settings.accent === id) return;
  const set = () => s.setSettings({ accent: id });
  const c = to255(oklchToRgb(ACCENTS[id].color));
  const sparkle = () => {
    fx.ring(x, y, 8, 120, { dur: 700, color: c });
    fx.burst(x, y, {
      count: 30,
      speed: 260,
      colors: [c, [255, 255, 255]],
      life: 0.9,
    });
  };
  const start = viewTransitions();
  if (!start) {
    set();
    if (fx.active) {
      fx.flash(x, y, coverRadius(x, y), { dur: 1100, alpha: 0.2, color: c });
      sparkle();
    }
    return;
  }
  const root = document.documentElement;
  root.classList.add("vt-accent");
  const t = start(() => flushSync(set));
  t.ready
    .then(() => {
      root.animate(
        {
          clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${coverRadius(x, y)}px at ${x}px ${y}px)`],
        },
        {
          duration: 780,
          easing: "cubic-bezier(0.22, 0.9, 0.25, 1)",
          pseudoElement: "::view-transition-new(root)",
        },
      );
      sparkle();
    })
    .catch(() => {});
  t.finished.finally(() => root.classList.remove("vt-accent"));
}

/** Where the falling sheet of rain has got to: its lower edge, with drips running ahead. */
const DRIPS = Array.from({ length: 29 }, (_, i) => (i % 2 ? 0.25 + Math.random() * 0.75 : Math.random() * 0.25));
function curtain(k: number) {
  const pts = ["0% -20%", "100% -20%"];
  for (let i = DRIPS.length - 1; i >= 0; i--) pts.push(`${((i / (DRIPS.length - 1)) * 100).toFixed(2)}% ${(k * 100 + DRIPS[i] * 16 - 8).toFixed(2)}%`);
  return `polygon(${pts.join(", ")})`;
}

/**
 * Changing the scene. Rain comes down over everything like a sheet of water running down
 * the window; the galaxy opens out from where you clicked, like the accent does; the solar
 * eclipse opens out from the sun itself — and greets you with the diamond ring.
 */
/** The accent that goes with the Golden eclipse: Corona, the warm yellow gold. */
export const GOLDEN_ACCENT: AccentId = "corona";

/**
 * The solar eclipse's look. Choosing Golden always turns the accent gold to match — every time,
 * even if it's chosen again — and you're free to pick another accent after.
 */
export function changeSolarLook(look: "corona" | "golden") {
  const s = useApp.getState();
  if (look === "golden") s.setSettings({ solarLook: look, accent: GOLDEN_ACCENT });
  else if (s.settings.solarLook !== look) s.setSettings({ solarLook: look });
}

export function changeScene(id: SceneId, x = innerWidth / 2, y = innerHeight / 2) {
  const s = useApp.getState();
  if (s.settings.scene === id) return;
  // The Golden eclipse comes with its own colour: the accent turns gold (you can change it after).
  const set = () => s.setSettings(id === "solar" && s.settings.solarLook === "golden" ? { scene: id, accent: GOLDEN_ACCENT } : { scene: id });
  const start = viewTransitions();
  if (!start) {
    set();
    if (fx.active) {
      fx.fadeSky();
      if (fx.solar) window.setTimeout(() => fx.diamondRing(), 650);
    }
    return;
  }
  const root = document.documentElement;
  root.classList.add("vt-accent");
  const t = start(() => {
    flushSync(set);
    fx.renderNow();
  });
  t.ready
    .then(() => {
      if (fx.rain) {
        root.animate(
          { clipPath: [curtain(-0.18), curtain(0.5), curtain(1.2)] },
          {
            duration: 1300,
            easing: "cubic-bezier(0.5, 0, 0.3, 1)",
            pseudoElement: "::view-transition-new(root)",
          },
        );
      } else if (fx.solar) {
        const sun = fx.sunSpot;
        root.animate(
          {
            clipPath: [`circle(${sun.r}px at ${sun.x}px ${sun.y}px)`, `circle(${coverRadius(sun.x, sun.y)}px at ${sun.x}px ${sun.y}px)`],
          },
          {
            duration: 1150,
            easing: "cubic-bezier(0.45, 0, 0.2, 1)",
            pseudoElement: "::view-transition-new(root)",
          },
        );
        window.setTimeout(() => fx.diamondRing(), 700);
      } else {
        root.animate(
          {
            clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${coverRadius(x, y)}px at ${x}px ${y}px)`],
          },
          {
            duration: 900,
            easing: "cubic-bezier(0.22, 0.9, 0.25, 1)",
            pseudoElement: "::view-transition-new(root)",
          },
        );
      }
    })
    .catch(() => {});
  t.finished.finally(() => root.classList.remove("vt-accent"));
}
