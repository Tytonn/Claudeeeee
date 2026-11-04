import { flushSync } from "react-dom";
import { useApp } from "../store/app";
import { accentColor } from "../lib/theme";
import { GOLDEN_ACCENT, SCENES, goldenFirstTime } from "../scenes/meta";
import { webkit } from "../lib/platform";
import { play } from "../lib/sound";
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
  const c = to255(oklchToRgb(accentColor(id, s.settings.scene, s.settings.inkDark)));
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

/**
 * Arriving in Ink. Whatever was on screen fades to near-black; a single drop of ink falls
 * through the dark to the middle of the screen; where it lands a ripple runs out and the ink
 * blooms and curls away from it — and the paper opens out of the dark around it, until the
 * page is back, on paper, with the ink drifting on.
 *
 * The dark, the drop and the paper are the Ink scene's own (the engine draws them, see
 * `inkArrive`); here is only what goes around them: the curtain that takes the old scene down,
 * keeping the page out of sight meanwhile, and letting you skip it — a tap, a click or a key
 * brings the page straight back. Choosing another scene part-way calls it all off cleanly.
 *
 * Returns false where it can't play (effects off, reduced motion, no WebGL): then it's a plain
 * change of scene.
 */
type Arrival = { to: SceneId; cancel: () => void };
let arrival: Arrival | null = null;
/** Each arrival's own number: whatever an older one left scheduled checks it and does nothing. */
let arrivalGen = 0;

const CURTAIN_MS = 380;

function arriveByDrop(to: SceneId, set: () => void): boolean {
  if (!fx.active || fx.reducedMotion || !fx.inkCapable) return false;
  const gen = ++arrivalGen;
  const root = document.documentElement;
  const mine = () => gen === arrivalGen;
  // the scene we're leaving: if it changes some other way meanwhile (say, from another device),
  // that change wins and the drop is called off
  const from = useApp.getState().settings.scene;

  // the curtain: brings the dark down over the old scene, then stays (clear) to catch the taps
  const curtain = document.createElement("div");
  curtain.className = "ink-curtain";
  curtain.setAttribute("aria-hidden", "true");
  document.body.append(curtain);
  const fade = curtain.animate([{ opacity: 0 }, { opacity: 1 }], { duration: CURTAIN_MS, easing: "cubic-bezier(0.45, 0, 0.55, 1)", fill: "forwards" });

  let phase: "dark" | "drop" | "over" = "dark";
  let timer = 0;

  const finish = () => {
    if (phase === "over") return;
    phase = "over";
    window.clearTimeout(timer);
    removeEventListener("pointerdown", onSkip, true);
    removeEventListener("keydown", onSkip, true);
    fade.cancel();
    curtain.remove();
    root.classList.remove("ink-arriving", "ink-revealing");
    if (mine()) arrival = null;
  };
  // the page comes back up: soon after the drop lands, or at once when skipped
  const reveal = () => {
    if (!mine() || phase === "over") return;
    root.classList.add("ink-revealing");
  };

  const drop = () => {
    if (!mine() || phase !== "dark") return;
    if (useApp.getState().settings.scene !== from) {
      finish();
      return;
    }
    phase = "drop";
    // the page stays out of sight while the drop falls (the sky has its own dark from here on)
    root.classList.add("ink-arriving");
    flushSync(set);
    const ok = fx.inkArrive({
      land: () => mine() && play("inkdrop"),
      reveal,
      done: () => mine() && finish(),
    });
    if (!ok) {
      // the scene has changed, but the ink can't play its part: just lift the dark
      fx.fadeSky(700);
      finish();
      return;
    }
    fx.renderNow();
    // the sky is dark now too: the curtain goes clear (it stays, to catch a tap to skip)
    requestAnimationFrame(() => {
      if (!mine() || phase === "over") return;
      fade.cancel();
      curtain.style.opacity = "0";
    });
  };

  const onSkip = (e: Event) => {
    if (!mine() || phase === "over") return;
    // the tap or key is only for skipping: it mustn't reach the page hidden underneath
    e.preventDefault();
    e.stopImmediatePropagation();
    if (phase === "dark") {
      window.clearTimeout(timer);
      drop();
    }
    reveal();
    fx.inkSkip();
  };

  timer = window.setTimeout(drop, CURTAIN_MS);
  addEventListener("pointerdown", onSkip, true);
  addEventListener("keydown", onSkip, true);

  arrival = {
    to,
    cancel: () => {
      // called off part-way: let the drop go and put the page back as it is
      const was = phase;
      finish();
      arrivalGen++;
      if (was === "drop") fx.inkSkip();
    },
  };
  return true;
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
 * eclipse opens out from the sun itself — and greets you with the diamond ring; the Sky is a
 * climb up through cloud, out into the blue.
 */
export { GOLDEN_ACCENT };

/**
 * The solar eclipse's look. The first time Golden is chosen it comes with its own colour — the
 * accent turns gold to match; after that the accent is left as it is (pick any one: the whole
 * eclipse takes it on).
 */
export function changeSolarLook(look: "corona" | "golden") {
  const s = useApp.getState();
  if (look === "golden") {
    if (s.settings.solarLook === "golden" && s.settings.solarGoldenTried) return;
    s.setSettings({ solarLook: look, ...goldenFirstTime(s.settings) });
  } else if (s.settings.solarLook !== look) s.setSettings({ solarLook: look });
}

/**
 * Ink by day or by night (its Dark setting): it changes as Ink arrives — the dark comes down, a
 * drop falls, and the water opens out of the dark the other way round (paper, or night). With
 * effects off, or anywhere that can't play, it simply changes.
 */
export function changeInkDark(on: boolean) {
  const s = useApp.getState();
  if (arrival) arrival.cancel();
  if ((s.settings.inkDark === true) === on) return;
  const set = () => s.setSettings({ inkDark: on });
  if (s.settings.scene === "ink" && arriveByDrop("ink", set)) return;
  set();
}

export function changeScene(id: SceneId, x = innerWidth / 2, y = innerHeight / 2) {
  const s = useApp.getState();
  // a drop already on its way to Ink: a second click on Ink changes nothing; anything else
  // calls it off, cleanly, and carries on from wherever it had got to
  if (arrival) {
    if (arrival.to === id) return;
    arrival.cancel();
  }
  if (s.settings.scene === id) return;
  // (some scenes bring something with them: the Golden eclipse turns the accent gold)
  const set = () => s.setSettings({ ...SCENES[id].chosen?.(s.settings), scene: id });
  if (SCENES[id].enter === "drop" && arriveByDrop(id, set)) return;
  const start = viewTransitions();
  if (!start) {
    set();
    if (fx.active) {
      fx.fadeSky();
      if (SCENES[fx.scene].enter === "sun") window.setTimeout(() => fx.diamondRing(), 650);
      if (SCENES[fx.scene].enter === "clouds") fx.skyArrive();
    }
    return;
  }
  const root = document.documentElement;
  root.classList.add("vt-accent");
  const t = start(() => {
    flushSync(set);
    // (into the Sky through cloud: the mist is already up in the new scene's first frame)
    if (SCENES[fx.scene].enter === "clouds") fx.skyArrive();
    fx.renderNow();
  });
  t.ready
    .then(() => {
      const enter = SCENES[fx.scene].enter;
      if (enter === "rain") {
        root.animate(
          { clipPath: [curtain(-0.18), curtain(0.5), curtain(1.2)] },
          {
            duration: 1300,
            easing: "cubic-bezier(0.5, 0, 0.3, 1)",
            pseudoElement: "::view-transition-new(root)",
          },
        );
      } else if (enter === "sun") {
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
      } else if (enter === "clouds") {
        // flying into cloud: the old scene whitens away into the mist, which then opens out
        // onto the sky (the sky's own: see SkyScene.arrive)
        root.animate(
          { opacity: [0, 1], filter: ["blur(14px) brightness(1.4)", "blur(0px) brightness(1)"] },
          {
            duration: 750,
            easing: "cubic-bezier(0.3, 0.6, 0.2, 1)",
            pseudoElement: "::view-transition-new(root)",
          },
        );
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
