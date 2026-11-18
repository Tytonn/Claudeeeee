import { create } from "zustand";
import { standalone } from "./platform";
import { toast } from "../store/toasts";

/**
 * umbra as an app.
 *
 *  - Kept on this device, so it opens without the internet: a service worker (pwa/sw.js, made
 *    into /sw.js by the build) keeps the app's files. Your notes were always kept here; signed
 *    in, they sync again by themselves once you're back online.
 *  - Installable — a window of its own, its icon in the launcher, pinned to a Chromebook's shelf
 *    or a computer's taskbar: from Settings → App (when the browser offers it), or the browser's
 *    own Install. Its shortcuts (right-click the icon) start a new note or a search.
 */

type InstallPrompt = Event & { prompt(): Promise<void>; userChoice: Promise<{ outcome: "accepted" | "dismissed" }> };
type LaunchQueue = { setConsumer(fn: (params: { targetURL?: string }) => void): void };

export type OfflineState = "setting-up" | "ready" | "unsupported" | "dev";

export const usePwa = create<{
  /** The browser will install umbra if asked (Chrome and Edge: on a Chromebook, Windows, a Mac, Android). */
  canInstall: boolean;
  /** This is the installed app (its own window). */
  installed: boolean;
  /** Whether it'll open without the internet. */
  offline: OfflineState;
  /** Connected, as far as the browser knows. */
  online: boolean;
}>(() => ({
  canInstall: false,
  installed: standalone,
  offline: import.meta.env.DEV ? "dev" : "setting-up",
  online: typeof navigator === "undefined" ? true : navigator.onLine !== false,
}));

let offer: InstallPrompt | null = null;

// The browser's install offer comes once, soon after the page loads — maybe before the app has
// finished starting — so it's listened for as soon as this file is.
if (typeof window !== "undefined") {
  addEventListener("beforeinstallprompt", (e) => {
    // (no banner of the browser's own: Settings → App asks, when you want it to)
    e.preventDefault();
    offer = e as InstallPrompt;
    usePwa.setState({ canInstall: true });
  });
  addEventListener("appinstalled", () => {
    offer = null;
    usePwa.setState({ canInstall: false });
    toast("umbra is installed — open it from your launcher, and pin it to your shelf or taskbar", { tone: "success", duration: 8000 });
  });
}

/** Asks the browser to install umbra (it shows its own little window to confirm). */
export async function installApp(): Promise<boolean> {
  const ask = offer;
  if (!ask) return false;
  offer = null;
  usePwa.setState({ canInstall: false });
  await ask.prompt();
  const { outcome } = await ask.userChoice.catch(() => ({ outcome: "dismissed" as const }));
  return outcome === "accepted";
}

/**
 * Starts it all: keeping the app for offline (in a built app — not while developing), the install
 * offer, online and offline, and what a launch asks for (`?new`, `?search`: the icon's shortcuts).
 * Call once, early (the browser's install offer can come soon after the page loads).
 */
export function startPwa(launch: { newNote: () => void; search: () => void }) {
  const app = matchMedia("(display-mode: standalone)");
  app.addEventListener?.("change", () => usePwa.setState({ installed: app.matches || standalone }));

  addEventListener("online", () => usePwa.setState({ online: true }));
  addEventListener("offline", () => usePwa.setState({ online: false }));

  // The installed app keeps what's saved here safe from the browser's clear-outs when space runs low.
  if (standalone) void navigator.storage?.persisted?.().then((kept) => kept || navigator.storage.persist?.()).catch(() => {});

  // What the launch asked for (once the app's there to do it): the address it opened at, and —
  // the app already open (it's brought to the front, not opened twice) — each launch after.
  const opened = location.href;
  let openedDone = false;
  const handle = (url: string | undefined) => {
    if (!url) return false;
    let params: URLSearchParams;
    try {
      params = new URL(url, location.href).searchParams;
    } catch {
      return false;
    }
    if (params.has("new")) window.setTimeout(launch.newNote, 400);
    else if (params.has("search")) window.setTimeout(launch.search, 400);
    else return false;
    // (and out of the address, so a reload doesn't do it again)
    if (/[?&](new|search)\b/.test(location.search)) history.replaceState(history.state, "", location.pathname + location.hash);
    return true;
  };
  openedDone = handle(opened);
  const queue = (window as unknown as { launchQueue?: LaunchQueue }).launchQueue;
  queue?.setConsumer((params) => {
    // (the launch that opened this window: done already, just above)
    if (openedDone && params.targetURL === opened) {
      openedDone = false;
      return;
    }
    handle(params.targetURL);
  });

  if (import.meta.env.DEV) return;
  if (!("serviceWorker" in navigator)) {
    usePwa.setState({ offline: "unsupported" });
    return;
  }
  const sw = navigator.serviceWorker;
  // (kept already when this page opened: a new version taking over later is an update)
  const kept = Boolean(sw.controller);
  const register = () =>
    sw.register("/sw.js").catch(() => {
      // (a private window that won't keep files, or a browser that won't let it)
      usePwa.setState({ offline: "unsupported" });
    });
  if (document.readyState === "complete") void register();
  else addEventListener("load", () => void register(), { once: true });
  void sw.ready.then(() => usePwa.setState({ offline: "ready" }));

  // A new version comes in by itself (it's looked for each time umbra opens, and — umbra left open
  // for days, as an app is — when you come back to it after a while, or the connection's back).
  // Should this page be older than it, a word to say so: the installed app has no reload button.
  let looked = Date.now();
  const look = () => {
    looked = Date.now();
    void sw.getRegistration().then((reg) => reg?.update()).catch(() => {});
  };
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && Date.now() - looked > 30 * 60_000) look();
  });
  addEventListener("online", look);
  sw.addEventListener("controllerchange", () => {
    if (kept) void announceUpdate();
  });
}

/** This page's own scripts — are they all among the files of the version now in charge? If not, it's older: say so. */
async function announceUpdate() {
  const now = navigator.serviceWorker.controller;
  const mine = [...document.querySelectorAll<HTMLScriptElement>('script[type="module"][src]')].map((s) => new URL(s.src).pathname).filter((p) => p.startsWith("/assets/"));
  if (!now || !mine.length) return;
  const answer = await new Promise<{ has: boolean } | null>((resolve) => {
    const ch = new MessageChannel();
    const t = window.setTimeout(() => resolve(null), 3000);
    ch.port1.onmessage = (e) => {
      window.clearTimeout(t);
      resolve(e.data as { has: boolean });
    };
    now.postMessage({ has: mine }, [ch.port2]);
  });
  if (!answer || answer.has) return;
  toast("A new version of umbra is ready", { duration: 60_000, action: { label: "Reload", run: () => location.reload() } });
}
