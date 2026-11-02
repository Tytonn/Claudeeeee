/**
 * A few platform facts the layout and effects need to work around.
 */

const nav = typeof navigator !== "undefined" ? (navigator as Navigator & { standalone?: boolean }) : null;
const ua = nav?.userAgent ?? "";
const mq = (q: string) => typeof matchMedia !== "undefined" && matchMedia(q).matches;

const iOS = /iPhone|iPad|iPod/.test(ua) || (nav?.platform === "MacIntel" && (nav?.maxTouchPoints ?? 0) > 1);

/** Opened from the Home Screen (no browser around it). */
export const standalone = nav?.standalone === true || mq("(display-mode: standalone)");

/** An iPhone Home Screen app: it owns the whole screen, under a see-through status bar. */
export const iPhoneApp = /iPhone|iPod/.test(ua) && standalone;

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
  if (!iPhoneApp) return;
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
