/**
 * A few platform facts the layout and effects need to work around.
 */

import { BUILD_SHA, VERSION } from "../version";

const nav = typeof navigator !== "undefined" ? (navigator as Navigator & { standalone?: boolean }) : null;
const ua = nav?.userAgent ?? "";
const mq = (q: string) => typeof matchMedia !== "undefined" && matchMedia(q).matches;

const iOS = /iPhone|iPad|iPod/.test(ua) || (nav?.platform === "MacIntel" && (nav?.maxTouchPoints ?? 0) > 1);

/** Opened from the Home Screen (no browser around it). */
export const standalone = nav?.standalone === true || mq("(display-mode: standalone)");

/**
 * An iPhone Home Screen app: it owns the whole screen, under a see-through status bar. (Also
 * recognised by its tell-tale measurements — see startViewportFit — in case iOS doesn't say so.)
 */
export let iPhoneApp = /iPhone|iPod/.test(ua) && standalone;

/** How far the screen's safe area reaches in from the top and bottom (CSS px). */
function insets(): { top: number; bottom: number } {
  if (typeof document === "undefined" || !document.body) return { top: 0, bottom: 0 };
  const probe = document.createElement("div");
  probe.style.cssText = "position:fixed;left:0;top:0;width:0;padding-top:env(safe-area-inset-top);padding-bottom:env(safe-area-inset-bottom);visibility:hidden;pointer-events:none";
  document.body.appendChild(probe);
  const cs = getComputedStyle(probe);
  const r = { top: parseFloat(cs.paddingTop) || 0, bottom: parseFloat(cs.paddingBottom) || 0 };
  probe.remove();
  return r;
}

/** What the screen and the page measure, for working out what a phone is doing. */
export function screenInfo(): string {
  const i = insets();
  const root = document.documentElement;
  const vv = window.visualViewport;
  return [
    `v${VERSION} (${BUILD_SHA})`,
    `page ${innerWidth}×${innerHeight}`,
    `screen ${screen.width}×${screen.height}`,
    vv ? `visible ${Math.round(vv.width)}×${Math.round(vv.height)}` : "",
    `insets ${i.top}/${i.bottom}`,
    `app ${root.style.getPropertyValue("--app-h") || "-"}`,
    `html ${Math.round(root.getBoundingClientRect().height)}`,
    `standalone ${standalone ? "yes" : "no"}`,
    `iPhone app ${iPhoneApp ? "yes" : "no"}`,
    `dpr ${devicePixelRatio}`,
  ]
    .filter(Boolean)
    .join(" · ");
}

/**
 * WebKit (Safari, and every browser on iPhone/iPad). Its view-transition snapshots leave out
 * backdrop blur, so the frosted glass goes clear for a moment mid-transition — we use
 * transitions that don't rely on snapshots there.
 */
export const webkit = iOS || (/AppleWebKit/.test(ua) && /Safari/.test(ua) && !/Chrome|Chromium|CriOS|Edg|OPR|Android/.test(ua));

/**
 * The height we really have. In an iPhone Home Screen app with a see-through status bar, CSS
 * viewport units (and on some iOS versions innerHeight) come up short by the status bar's
 * height, which left a dark strip along the bottom. The app has the whole screen, so use it.
 */
export function viewportHeight(): number {
  const h = window.innerHeight;
  if (!iPhoneApp) return h;
  const long = Math.max(screen.width, screen.height);
  const short = Math.min(screen.width, screen.height);
  return Math.max(h, mq("(orientation: landscape)") ? short : long);
}

/** Keeps `--app-h` (used for every full-height layer) equal to the real screen height on iPhone apps. */
export function startViewportFit() {
  // Nothing in umbra scrolls the page itself (everything lives in its own scrolling panes), but
  // iOS sometimes leaves it pushed up after the keyboard goes away. Put it back.
  if (iOS)
    addEventListener("focusout", () =>
      window.setTimeout(() => {
        const el = document.activeElement as HTMLElement | null;
        const typing = el?.closest?.("input, textarea, select, [contenteditable='true']");
        if (!typing && (scrollX || scrollY)) scrollTo(0, 0);
      }, 80),
    );
  // The tell-tale of a Home Screen app under a see-through status bar, even if iOS doesn't say
  // it's one: the page comes up short by exactly the status bar's height.
  if (!iPhoneApp && /iPhone|iPod/.test(ua)) {
    const top = insets().top;
    const long = Math.max(screen.width, screen.height);
    const short = Math.min(screen.width, screen.height);
    const full = mq("(orientation: landscape)") ? short : long;
    if (top > 20 && Math.abs(full - (innerHeight + top)) <= 3) iPhoneApp = true;
  }
  if (!iPhoneApp) return;
  // iOS lays the page out short by the status bar's height — and paints nothing below the
  // page, which left a dark band (with the bottom bar under it) along the bottom of the screen.
  // So the page itself is made as tall as the screen, not just what's in it.
  document.documentElement.classList.add("is-iphone-app");
  // (and if iOS nudges the now-taller page up a little, put it back — unless you're typing)
  addEventListener(
    "scroll",
    () => {
      const el = document.activeElement as HTMLElement | null;
      const typing = el?.closest?.("input, textarea, select, [contenteditable='true']");
      if (!typing && (scrollX || scrollY)) scrollTo(0, 0);
    },
    { passive: true },
  );
  // `--vv-gap` is how much of the screen lies below what iOS calls the bottom of the page: fixed
  // layers stretch down by it, and things pinned to the bottom (toasts) move down by it.
  let gap = 0;
  const apply = () => {
    const h = viewportHeight();
    document.documentElement.style.setProperty("--app-h", `${h}px`);
    // The gap is about a status bar's height. Anything much bigger is the keyboard taking
    // space, which isn't screen we should stretch over.
    const g = Math.max(0, h - innerHeight);
    if (g <= 120 && g !== gap) {
      gap = g;
      document.documentElement.style.setProperty("--vv-gap", `${g}px`);
    }
  };
  apply();
  addEventListener("resize", apply);
  addEventListener("orientationchange", () => window.setTimeout(apply, 300));
}
