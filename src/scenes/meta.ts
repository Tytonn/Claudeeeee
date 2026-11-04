import type { AccentId, SceneId, Settings } from "../lib/types";

/** The accent that goes with the Golden eclipse: Corona, the warm yellow gold. */
export const GOLDEN_ACCENT: AccentId = "corona";

/** The first time the Golden eclipse is chosen, the accent turns gold to match; after that, it's left alone. */
export function goldenFirstTime(s: Settings): Partial<Settings> {
  return s.solarGoldenTried ? {} : { accent: GOLDEN_ACCENT, solarGoldenTried: true };
}

/**
 * The scenes: everything about each one that isn't drawing it — what it's called, how it's
 * described, whether it's a light one (the whole interface goes to paper), the colour of the
 * page where nothing is drawn, its sounds, its intro, how it arrives and how a deleted note
 * leaves it. Plain data, so anything can read it (the engine, the theme, the sounds) without
 * pulling in React.
 *
 * ── Adding a scene ─────────────────────────────────────────────────────────
 *  1. its id in `SceneId` (lib/types.ts), and an entry here (and in SCENE_ORDER);
 *  2. its card picture, settings rows and palette commands: scenes/<id>/ui.tsx, listed in
 *     scenes/ui.ts;
 *  3. its sky: a renderer (scenes/<id>/renderer.ts, with its shaders beside it), listed in
 *     fx/sky.ts — the SceneRenderer interface is in fx/renderer.ts;
 *  4. what it does from moment to moment, and its take on the effects: a controller
 *     (scenes/<id>/controller.ts), listed in fx/engine.ts — the SceneController interface is
 *     in fx/scene.ts; what it hands its renderer each frame is its part of SkyFrame (fx/sky.ts),
 *     passed on in the engine's renderSky; anything it leaves out, the engine does as the
 *     galaxy does;
 *  5. its sounds, intro, arrival and farewell for a deleted note: pick from the kinds below,
 *     or add one (sounds: lib/sound.ts; intros: fx/Intro.tsx; farewells: lib/actions.ts — each
 *     a list typed by its kind; arrivals: fx/transitions.ts);
 *  6. a light scene: `light: true` puts the interface on paper (styles/light.css, through
 *     html[data-tone="light"]); its own touches go in a stylesheet of its own (keyed on
 *     html[data-scene="<id>"] where they change the shared interface; Ink's: styles/ink.css);
 *     and public/boot.js should know its paper, so the page starts out the right colour.
 * Every list above is typed by SceneId, so TypeScript points out whatever is still missing.
 */

/** Which set of little sounds goes with a scene (see lib/sound.ts). */
export type SoundTheme = "eclipse" | "rain" | "ink" | "sky";

/** The launch intro a scene plays (see fx/Intro.tsx). */
export type IntroKind = "eclipse" | "rain" | "solar" | "ink" | "sky";

/** How a scene arrives when it's chosen (see fx/transitions.ts). */
export type EnterKind = "circle" | "rain" | "sun" | "drop" | "clouds";

/** How the open note leaves when it's deleted (see fx/dom.ts). */
export type WipeKind = "moon" | "rain" | "ink" | "mist";

export type SceneMeta = {
  id: SceneId;
  /** Its name, on its card in Settings. */
  name: string;
  /** A line under the name. */
  tagline: string;
  /** Its command in the palette, and the words that find it. */
  command: string;
  keywords: string;
  /** A light scene: paper, ink-dark type and deeper accents (styles/light.css). */
  light: boolean;
  /** The page's own colour where nothing is drawn over it (the phone's bars with effects off, the launch veil). */
  plain: string;
  /** Its sounds — and whether they stay with effects off (else the plain ones). */
  sounds: SoundTheme;
  soundsWithoutEffects: boolean;
  intro: IntroKind;
  enter: EnterKind;
  wipe: WipeKind;
  /** Settings → Effects and Cursor light, as they are in this scene. */
  effectsDesc: string;
  cursorDesc: string;
  /** Settings → Transparency: what shows through. */
  backdropDesc: string;
  /** Anything else that changes with it when it's chosen (the Golden eclipse turns the accent gold). */
  chosen?: (settings: Settings) => Partial<Settings>;
  /** Kept out of sight for now: no card in Settings (unless it's the scene you're in), and in the
   *  command palette only for someone who searches for it by name. */
  hidden?: boolean;
};

/** Paper: the light scenes' page. (Keep in step with styles/light.css and public/boot.js.) */
export const PAPER = "#f1ede5";
/** The dark scenes' page. */
export const NIGHT = "#08090a";
/** The Sky's page: a pale summer blue. (Keep in step with styles/sky.css and public/boot.js.) */
export const SKY_PLAIN = "#d6e8f8";

export const SCENES: Record<SceneId, SceneMeta> = {
  // (its id is "eclipse" for history's sake: it's the galaxy, with the note as the moon)
  eclipse: {
    id: "eclipse",
    name: "Galaxy",
    tagline: "A living corona in deep space",
    command: "Scene: Galaxy",
    keywords: "scene theme space stars galaxy nebula sky background corona",
    light: false,
    plain: NIGHT,
    sounds: "eclipse",
    soundsWithoutEffects: true,
    intro: "eclipse",
    enter: "circle",
    wipe: "moon",
    effectsDesc: "The living sky, solar flares, light trails and embers. Calm it down any time.",
    cursorDesc: "Your cursor is a light: it catches the edges of things and brightens the corona.",
    backdropDesc: "How much of the sky shows through. Your words always stay readable.",
  },
  solar: {
    id: "solar",
    name: "Solar eclipse",
    tagline: "Totality, low over the clouds",
    command: "Scene: Solar eclipse",
    keywords: "scene theme sun eclipse totality corona diamond ring clouds sunset sky background",
    light: false,
    plain: NIGHT,
    sounds: "eclipse",
    soundsWithoutEffects: true,
    intro: "solar",
    enter: "sun",
    wipe: "moon",
    effectsDesc: "The eclipse, the diamond ring, light trails and embers. Calm it down any time.",
    // the Golden eclipse comes with its own colour the first time: the accent turns gold (and then
    // stays whatever you pick)
    chosen: (s) => (s.solarLook === "golden" ? goldenFirstTime(s) : {}),
    cursorDesc: "Your cursor is a faint, warm light in the dusk: it catches the edges of things.",
    backdropDesc: "How much of the sky shows through. Your words always stay readable.",
  },
  rain: {
    id: "rain",
    name: "Rain",
    tagline: "A city at night, through a wet window",
    command: "Make it rain",
    keywords: "scene theme rain storm city night window background",
    light: false,
    plain: NIGHT,
    sounds: "rain",
    soundsWithoutEffects: false,
    intro: "rain",
    enter: "rain",
    wipe: "rain",
    effectsDesc: "The rain, the lightning, splashes and drips. Calm it down any time.",
    cursorDesc: "Your cursor is a warm light held up to the glass, catching the drops.",
    backdropDesc: "How much of the sky shows through. Your words always stay readable.",
  },
  ink: {
    id: "ink",
    name: "Ink",
    tagline: "Ink plunging into clear water, on paper",
    command: "Scene: Ink",
    keywords: "scene theme ink water paper light bright white day drop sumi calligraphy background",
    light: true,
    plain: PAPER,
    sounds: "ink",
    soundsWithoutEffects: true,
    intro: "ink",
    enter: "drop",
    wipe: "ink",
    effectsDesc: "The ink in the water, the drop, the flecks and washes of ink. Calm it down any time.",
    cursorDesc: "Your cursor stirs the water as it passes, and darkens the edges of things a little.",
    backdropDesc: "How much of the water shows through. Your words always stay readable.",
  },
  sky: {
    id: "sky",
    name: "Sky",
    tagline: "A summer sky, heaped with cloud",
    command: "Scene: Sky",
    keywords: "scene theme sky clouds cloud blue day sun sunny summer anime cumulus sunset golden pastel twilight wind light bright background",
    light: true,
    plain: SKY_PLAIN,
    sounds: "sky",
    soundsWithoutEffects: true,
    intro: "sky",
    enter: "clouds",
    wipe: "mist",
    effectsDesc: "The clouds drifting on the wind, the sun and its rays, gusts and bursts of sunlight. Calm it down any time.",
    cursorDesc: "Your cursor is a breath of wind: the clouds near it drift along as it passes.",
    backdropDesc: "How much of the sky shows through. Your words always stay readable.",
    // (not ready to be shown yet: search the command palette for "sky" to try it)
    hidden: true,
  },
};

/** The order they're offered in (Settings, the command palette). */
export const SCENE_ORDER: readonly SceneId[] = ["eclipse", "solar", "rain", "ink", "sky"];
export const SCENE_LIST: readonly SceneMeta[] = SCENE_ORDER.map((id) => SCENES[id]);

/** Whether a search (in the command palette) asks for a hidden scene by name. */
export function asksForScene(sc: SceneMeta, query: string): boolean {
  return query.trim().toLowerCase().includes(sc.name.toLowerCase());
}

/** A saved scene, or the Galaxy if it isn't one we know. */
export function sceneOf(s: unknown): SceneId {
  return typeof s === "string" && Object.prototype.hasOwnProperty.call(SCENES, s) ? (s as SceneId) : "eclipse";
}

/** A light scene: the interface goes to paper. */
export function isLightScene(s: unknown): boolean {
  return SCENES[sceneOf(s)].light;
}
