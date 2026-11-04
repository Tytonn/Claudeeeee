declare const __BUILD_SHA__: string;
declare const __BUILD_TIME__: string;

/**
 * umbra's version: what you see next to the logo (Settings → About → Show version) and in
 * Settings. It goes up by one with every update.
 */
export const VERSION = "1.33";

/** Exactly which build this is: its commit, and when it was built (filled in at build time). */
export const BUILD_SHA: string = typeof __BUILD_SHA__ === "string" ? __BUILD_SHA__ : "dev";
export const BUILD_TIME: string = typeof __BUILD_TIME__ === "string" ? __BUILD_TIME__ : "";
