import type { AccentId, FontId, RainAmountId, Settings, SizeId } from "./types";

/** `nebula` is a second hue the sky blends with the accent, so space never looks flat. */
export const ACCENTS: Record<AccentId, { name: string; color: string; nebula: string }> = {
  iris: { name: "Iris", color: "oklch(0.77 0.125 286)", nebula: "oklch(0.52 0.15 245)" },
  moon: { name: "Moon", color: "oklch(0.93 0.008 270)", nebula: "oklch(0.5 0.06 255)" },
  sky: { name: "Sky", color: "oklch(0.8 0.105 232)", nebula: "oklch(0.5 0.15 285)" },
  mint: { name: "Mint", color: "oklch(0.84 0.115 168)", nebula: "oklch(0.5 0.12 215)" },
  corona: { name: "Corona", color: "oklch(0.86 0.115 82)", nebula: "oklch(0.55 0.16 35)" },
  ember: { name: "Ember", color: "oklch(0.76 0.145 46)", nebula: "oklch(0.5 0.17 355)" },
  rose: { name: "Rose", color: "oklch(0.79 0.115 356)", nebula: "oklch(0.5 0.15 300)" },
};

/** How hard it rains, as the engine and the sound understand it. */
export const RAIN_AMOUNT: Record<RainAmountId, number> = { drizzle: 0.15, rain: 0.5, downpour: 0.95 };

export const FONTS: Record<FontId, { name: string; stack: string }> = {
  sans: { name: "Sans", stack: `"Geist Variable", "Geist", ui-sans-serif, system-ui, sans-serif` },
  serif: { name: "Serif", stack: `"Newsreader Variable", "Newsreader", "Iowan Old Style", Georgia, serif` },
  mono: { name: "Mono", stack: `"Geist Mono Variable", "Geist Mono", ui-monospace, "SF Mono", Menlo, monospace` },
};

export const SIZES: Record<SizeId, { name: string; px: number }> = {
  s: { name: "Small", px: 15 },
  m: { name: "Medium", px: 16.5 },
  l: { name: "Large", px: 18.5 },
};

/** Keeps a chosen text color readable on the dark sky: very dark picks get lifted toward white. */
export function readableInk(hex: string): string | null {
  const m = /^#([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  let [r, g, b] = [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16) / 255);
  const lum = (c: number[]) => {
    const lin = c.map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
  };
  for (let i = 0; i < 12 && lum([r, g, b]) < 0.3; i++) {
    r += (1 - r) * 0.18;
    g += (1 - g) * 0.18;
    b += (1 - b) * 0.18;
  }
  return `#${[r, g, b].map((v) => Math.round(v * 255).toString(16).padStart(2, "0")).join("")}`;
}

export function applyTheme(s: Pick<Settings, "accent" | "font" | "size"> & Partial<Pick<Settings, "backdrop" | "ink">>) {
  const root = document.documentElement;
  root.dataset.backdrop = s.backdrop === "glass" || s.backdrop === "clear" || s.backdrop === "crystal" ? s.backdrop : "dark";
  const ink = s.ink ? readableInk(s.ink) : null;
  if (ink) {
    root.style.setProperty("--ink", ink);
    root.dataset.ink = "";
  } else {
    root.style.removeProperty("--ink");
    delete root.dataset.ink;
  }
  root.style.setProperty("--accent", ACCENTS[s.accent]?.color ?? ACCENTS.iris.color);
  root.style.setProperty("--font-editor", FONTS[s.font]?.stack ?? FONTS.sans.stack);
  // Serif text reads best a touch larger; mono a touch smaller.
  const base = SIZES[s.size]?.px ?? 16.5;
  const adjust = s.font === "serif" ? 1.08 : s.font === "mono" ? 0.92 : 1;
  root.style.setProperty("--editor-size", `${(base * adjust).toFixed(2)}px`);
  root.dataset.font = s.font;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", "#08090a");
}

export const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad|iPod/i.test(navigator.platform || navigator.userAgent);
export const MOD = isMac ? "⌘" : "Ctrl";
export const ALT = isMac ? "⌥" : "Alt";
export const SHIFT = isMac ? "⇧" : "Shift";
