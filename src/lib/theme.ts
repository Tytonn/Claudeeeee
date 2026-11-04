import type { AccentId, BackdropId, FontId, RainAmountId, SceneId, Settings, SizeId, SolarTintId, TitleAlignId, TitleFontId, TitleSizeId, TitleStyle, TodoColor } from "./types";
import { PAPER, isLightScene, plainOf, sceneOf } from "../scenes/meta";

// (where they've always been imported from)
export { PAPER, isLightScene, sceneOf };

/**
 * `nebula` is a second hue the sky blends with the accent, so space never looks flat. `paper` is
 * the same colour as ink would carry it on paper (the Ink scene): deeper, so it reads on a light page.
 */
export const ACCENTS: Record<AccentId, { name: string; color: string; nebula: string; paper: string }> = {
  iris: { name: "Iris", color: "oklch(0.77 0.125 286)", nebula: "oklch(0.52 0.15 245)", paper: "oklch(0.5 0.15 284)" },
  moon: { name: "Moon", color: "oklch(0.93 0.008 270)", nebula: "oklch(0.5 0.06 255)", paper: "oklch(0.34 0.014 268)" },
  sky: { name: "Sky", color: "oklch(0.8 0.105 232)", nebula: "oklch(0.5 0.15 285)", paper: "oklch(0.52 0.12 240)" },
  mint: { name: "Mint", color: "oklch(0.84 0.115 168)", nebula: "oklch(0.5 0.12 215)", paper: "oklch(0.53 0.095 172)" },
  corona: { name: "Corona", color: "oklch(0.86 0.115 82)", nebula: "oklch(0.55 0.16 35)", paper: "oklch(0.6 0.12 72)" },
  ember: { name: "Ember", color: "oklch(0.76 0.145 46)", nebula: "oklch(0.5 0.17 355)", paper: "oklch(0.57 0.155 42)" },
  rose: { name: "Rose", color: "oklch(0.79 0.115 356)", nebula: "oklch(0.5 0.15 300)", paper: "oklch(0.53 0.15 2)" },
};

/** Settings → Transparency: how much of the scene shows through the panels, least to most — Frosted
 *  (heavy frosted glass, or paper), Soft (lighter, more of the scene), Clear (the scene almost fully,
 *  a soft shade behind your words), Outline (no glass, just outlines) and Full (nothing at all). Saved
 *  by their old names, from when it was Background: dark, glass, clear, crystal, bare. */
export const TRANSPARENCY: readonly { id: BackdropId; name: string }[] = [
  { id: "dark", name: "Frosted" },
  { id: "glass", name: "Soft" },
  { id: "clear", name: "Clear" },
  { id: "crystal", name: "Outline" },
  { id: "bare", name: "Full" },
];

/** The accent as this scene shows it: light on the dark skies, ink-deep on paper (`inkDark`: Ink is set to Dark). */
export function accentColor(id: AccentId | string | undefined, scene: SceneId | string | undefined, inkDark?: unknown): string {
  const a = ACCENTS[id as AccentId] ?? ACCENTS.iris;
  return isLightScene(scene, inkDark) ? a.paper : a.color;
}

/** The corona's colours in the solar eclipse. Pearl is the real thing; the rest are for fun. */
export const SOLAR_TINTS: Record<SolarTintId, { name: string; color: string }> = {
  pearl: { name: "Pearl", color: "#f3eee6" },
  gold: { name: "Gold", color: "#ffcf7a" },
  ember: { name: "Ember", color: "#ff8f5e" },
  rose: { name: "Rose", color: "#ff93be" },
  violet: { name: "Violet", color: "#b59cff" },
  ice: { name: "Ice", color: "#8fc8ff" },
  mint: { name: "Mint", color: "#86efc6" },
};

/** "#rrggbb" → 0..1 */
export function hexRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

/**
 * The colors a to-do can wear: bright enough to read on the dark glass, soft enough to sit
 * together — and their deeper `paper` versions for the Ink scene.
 */
export const TODO_COLORS: Record<TodoColor, { name: string; color: string; paper: string }> = {
  red: { name: "Red", color: "oklch(0.72 0.17 22)", paper: "oklch(0.56 0.17 25)" },
  orange: { name: "Orange", color: "oklch(0.79 0.15 58)", paper: "oklch(0.64 0.15 52)" },
  yellow: { name: "Yellow", color: "oklch(0.87 0.14 95)", paper: "oklch(0.7 0.135 84)" },
  green: { name: "Green", color: "oklch(0.79 0.14 155)", paper: "oklch(0.57 0.12 155)" },
  blue: { name: "Blue", color: "oklch(0.75 0.13 240)", paper: "oklch(0.54 0.13 245)" },
  purple: { name: "Purple", color: "oklch(0.73 0.15 300)", paper: "oklch(0.53 0.15 302)" },
};

/** How hard it rains, as the engine understands it. */
export const RAIN_AMOUNT: Record<RainAmountId, number> = { drizzle: 0.15, rain: 0.5, downpour: 0.95 };

export const FONTS: Record<FontId, { name: string; stack: string }> = {
  sans: { name: "Sans", stack: `"Geist Variable", "Geist", ui-sans-serif, system-ui, sans-serif` },
  serif: { name: "Serif", stack: `"Newsreader Variable", "Newsreader", "Iowan Old Style", Georgia, serif` },
  mono: { name: "Mono", stack: `"Geist Mono Variable", "Geist Mono", ui-monospace, "SF Mono", Menlo, monospace` },
};

/** The typefaces a note's title can wear (all already loaded: nothing new to download). */
export const TITLE_FONTS: Record<TitleFontId, { name: string; stack: string; italic?: boolean }> = {
  display: { name: "Display", stack: `"Instrument Serif", "Iowan Old Style", Georgia, serif` },
  italic: { name: "Display italic", stack: `"Instrument Serif", "Iowan Old Style", Georgia, serif`, italic: true },
  serif: { name: "Serif", stack: `"Newsreader Variable", "Newsreader", "Iowan Old Style", Georgia, serif` },
  sans: { name: "Sans", stack: `"Geist Variable", "Geist", ui-sans-serif, system-ui, sans-serif` },
  mono: { name: "Mono", stack: `"Geist Mono Variable", "Geist Mono", ui-monospace, "SF Mono", Menlo, monospace` },
};

export const SIZES: Record<SizeId, { name: string; px: number }> = {
  s: { name: "Small", px: 15 },
  m: { name: "Medium", px: 16.5 },
  l: { name: "Large", px: 18.5 },
};

/** A title's sizes (as a step up or down from the usual), and its alignments. */
export const TITLE_SIZES: Record<TitleSizeId, { name: string; short: string }> = {
  s: { name: "Small", short: "S" },
  m: { name: "Medium", short: "M" },
  l: { name: "Large", short: "L" },
  xl: { name: "Extra large", short: "XL" },
};
export const TITLE_ALIGNS: Record<TitleAlignId, { name: string }> = {
  left: { name: "Left" },
  center: { name: "Center" },
};

/** A note's own title look as attributes for its page (the styles read them; see editor.css). */
export function titleAttrs(style: TitleStyle | null | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (style?.font && style.font in TITLE_FONTS) out["data-title-font"] = style.font;
  if (style?.size && style.size in TITLE_SIZES) out["data-title-size"] = style.size;
  if (style?.align && style.align in TITLE_ALIGNS) out["data-title-align"] = style.align;
  return out;
}

export function applyTheme(s: Pick<Settings, "accent" | "font" | "size"> & Partial<Pick<Settings, "backdrop" | "titleFont" | "titleSize" | "titleAlign" | "scene" | "inkDark">>) {
  const root = document.documentElement;
  root.dataset.backdrop = s.backdrop === "dark" || s.backdrop === "glass" || s.backdrop === "crystal" || s.backdrop === "bare" ? s.backdrop : "clear";
  root.style.setProperty("--accent", accentColor(s.accent, sceneOf(s.scene), s.inkDark));
  root.style.setProperty("--font-editor", FONTS[s.font]?.stack ?? FONTS.sans.stack);
  // Serif text reads best a touch larger; mono a touch smaller.
  const base = SIZES[s.size]?.px ?? 16.5;
  const adjust = s.font === "serif" ? 1.08 : s.font === "mono" ? 0.92 : 1;
  root.style.setProperty("--editor-size", `${(base * adjust).toFixed(2)}px`);
  root.dataset.font = s.font;
  root.dataset.titleFont = s.titleFont && s.titleFont in TITLE_FONTS ? s.titleFont : "display";
  root.dataset.titleSize = s.titleSize && s.titleSize in TITLE_SIZES ? s.titleSize : "m";
  root.dataset.titleAlign = s.titleAlign && s.titleAlign in TITLE_ALIGNS ? s.titleAlign : "left";
}

/**
 * The colours a phone paints around the page: its status bar (and toolbar) at the top, from
 * theme-color, and the strip under the gesture bar at the bottom, from the page's background.
 * Matched to the edges of the sky while it's showing, so the sky seems to run right to the edge
 * of the screen; the plain dark otherwise.
 */
export function setBarColors(top: string | null, bottom: string | null) {
  const meta = document.querySelector('meta[name="theme-color"]');
  // with nothing to match, the page's own plain colour: the dark, or paper in a light scene
  // (Ink set to Dark: its own night)
  const root = document.documentElement;
  const plain = plainOf(root.dataset.scene, root.dataset.tone === "dark");
  if (meta && meta.getAttribute("content") !== (top ?? plain)) meta.setAttribute("content", top ?? plain);
  document.documentElement.style.backgroundColor = bottom ?? "";
  // (an iPhone may fill any space below the page with the body's colour: the sky's, then)
  if (document.body) document.body.style.backgroundColor = bottom ?? "";
}

export const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad|iPod/i.test(navigator.platform || navigator.userAgent);
export const MOD = isMac ? "⌘" : "Ctrl";
export const ALT = isMac ? "⌥" : "Alt";
export const SHIFT = isMac ? "⇧" : "Shift";
