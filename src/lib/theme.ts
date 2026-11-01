import type { AccentId, FontId, Settings, SizeId } from "./types";

export const ACCENTS: Record<AccentId, { name: string; color: string }> = {
  iris: { name: "Iris", color: "oklch(0.77 0.125 286)" },
  moon: { name: "Moon", color: "oklch(0.93 0.008 270)" },
  sky: { name: "Sky", color: "oklch(0.8 0.105 232)" },
  mint: { name: "Mint", color: "oklch(0.84 0.115 168)" },
  corona: { name: "Corona", color: "oklch(0.86 0.115 82)" },
  ember: { name: "Ember", color: "oklch(0.76 0.145 46)" },
  rose: { name: "Rose", color: "oklch(0.79 0.115 356)" },
};

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

export function applyTheme(s: Pick<Settings, "accent" | "font" | "size">) {
  const root = document.documentElement;
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
