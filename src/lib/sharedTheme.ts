import type { Settings } from "./types";
import { ACCENTS, RAIN_AMOUNT, SOLAR_TINTS, TRANSPARENCY } from "./theme";
import { SCENES } from "../scenes/meta";
import { SKY_PALETTES } from "../scenes/sky/palettes";

/**
 * "Share my theme": a shared note can carry how its owner sees it — the scene and its look, the
 * accent, how much of the sky shows through — so a friend opens it in that theme (and can switch
 * back to their own with one tap). Not how it reads (fonts, sizes: the reader's own), and not
 * what's up to each device (effects, detail, the cursor light).
 */
export const THEME_KEYS = [
  "scene",
  "accent",
  "backdrop",
  "galaxyEclipse",
  "galaxyEclipseSpot",
  "solarClouds",
  "solarSize",
  "solarLook",
  "solarTint",
  "lightning",
  "cityLights",
  "rainAmount",
  "cityBlur",
  "inkColours",
  "inkDark",
  "skyColours",
  "skyClouds",
  "skyWind",
] as const satisfies readonly (keyof Settings)[];

export type ThemeKey = (typeof THEME_KEYS)[number];
/** A theme as it travels: the scene always, anything else it has (what's missing stays the viewer's own). */
export type SharedTheme = Partial<Pick<Settings, ThemeKey>> & Pick<Settings, "scene">;

const THEME_KEY_SET = new Set<string>(THEME_KEYS);
export const isThemeKey = (k: string) => THEME_KEY_SET.has(k);

/** Your theme, from your settings. */
export function themeOf(s: Settings): SharedTheme {
  const out = {} as Record<string, unknown>;
  for (const k of THEME_KEYS) if (s[k] !== undefined) out[k] = s[k];
  return out as SharedTheme;
}

/** Whether two sets of settings look the same. */
export function sameTheme(a: Partial<Settings>, b: Partial<Settings>): boolean {
  return THEME_KEYS.every((k) => a[k] === b[k]);
}

/** What the theme is called: "Ink", "Ink by night", "Solar eclipse"… */
export function themeName(t: Partial<Settings>): string {
  const sc = t.scene && Object.prototype.hasOwnProperty.call(SCENES, t.scene) ? SCENES[t.scene] : SCENES.eclipse;
  return sc.id === "ink" && t.inkDark === true ? "Ink by night" : sc.name;
}

const has = (o: object, k: unknown) => typeof k === "string" && Object.prototype.hasOwnProperty.call(o, k);
const unit = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : undefined);
const bool = (v: unknown) => (typeof v === "boolean" ? v : undefined);
const oneOf = <T extends string>(v: unknown, ok: readonly T[]) => (typeof v === "string" && (ok as readonly string[]).includes(v) ? (v as T) : undefined);

/** A theme someone else sent: only what we know, only values that make sense (else null). */
export function sanitizeTheme(raw: unknown): SharedTheme | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  if (!has(SCENES, r.scene)) return null;
  const out: Record<string, unknown> = {
    scene: r.scene,
    accent: has(ACCENTS, r.accent) ? r.accent : undefined,
    backdrop: oneOf(r.backdrop, TRANSPARENCY.map((t) => t.id)),
    galaxyEclipse: bool(r.galaxyEclipse),
    galaxyEclipseSpot: oneOf(r.galaxyEclipseSpot, ["beside", "middle"] as const),
    solarClouds: bool(r.solarClouds),
    solarSize: unit(r.solarSize),
    solarLook: oneOf(r.solarLook, ["corona", "golden"] as const),
    solarTint: has(SOLAR_TINTS, r.solarTint) ? r.solarTint : undefined,
    lightning: bool(r.lightning),
    cityLights: bool(r.cityLights),
    rainAmount: has(RAIN_AMOUNT, r.rainAmount) ? r.rainAmount : undefined,
    cityBlur: unit(r.cityBlur),
    inkColours: oneOf(r.inkColours, ["sumi", "accent"] as const),
    inkDark: bool(r.inkDark),
    skyColours: r.skyColours === "auto" || has(SKY_PALETTES, r.skyColours) ? r.skyColours : undefined,
    skyClouds: unit(r.skyClouds),
    skyWind: unit(r.skyWind),
  };
  for (const k of Object.keys(out)) if (out[k] === undefined) delete out[k];
  return out as SharedTheme;
}
