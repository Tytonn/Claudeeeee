/*
 * umbra's service worker: the app, kept on this device, so it opens without the internet.
 *
 * (A template: the build fills in VERSION and FILES — see pwa/plugin.ts — and writes it out as
 * /sw.js. Plain JavaScript, run by the browser as it is.)
 *
 *  - Pages: from the network when it answers (so a new version shows up the moment it's out),
 *    else the copy kept here.
 *  - The app's own files (/assets/…, named for their contents, so a name never changes what's
 *    in it): from here first, from the network the first time.
 *  - The other files it needs (boot.js, the icons, the manifest): from the network when it
 *    answers, else from here.
 *  - The server's API is never touched: your notes sync on their own, and know when you're offline.
 *
 * Each version keeps its files in a cache of its own; a new one copies across what hasn't changed
 * rather than fetching it all again, takes over at once, and clears out all but the version
 * before it (a page still open on that one may yet ask for its files).
 */

const VERSION = "__VERSION__";
const FILES = __FILES__;
const PREFIX = "umbra-app-";
const CACHE = PREFIX + VERSION;
/** How long a page waits for the network before it opens from here instead. */
const PATIENCE = 4000;

const hashed = (path) => path.startsWith("/assets/");
/** A file kept here is found by its address alone (see `kept`). */
const SAME = { ignoreVary: true };

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      const earlier = await Promise.all(
        (await caches.keys()).filter((k) => k.startsWith(PREFIX) && k !== CACHE).map((k) => caches.open(k)),
      );
      await Promise.all(
        FILES.map(async (path) => {
          if (hashed(path)) {
            // (the same file the last version had: copied across, not fetched again)
            for (const old of earlier) {
              const hit = await old.match(path, SAME);
              if (hit) return cache.put(path, hit);
            }
          }
          // (anything else asks the server whether it's changed — a small question, if it hasn't)
          const res = await fetch(new Request(path, { cache: hashed(path) ? "default" : "no-cache" }));
          if (!res.ok) throw new Error(`Couldn't keep ${path} (${res.status})`);
          await cache.put(path, res);
        }),
      );
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      // this version, and the one before it; any older go
      const others = (await caches.keys()).filter((k) => k.startsWith(PREFIX) && k !== CACHE).sort();
      await Promise.all(others.slice(0, -1).map((k) => caches.delete(k)));
      if (self.registration.navigationPreload) await self.registration.navigationPreload.enable().catch(() => {});
      await self.clients.claim();
    })(),
  );
});

// "Are these files yours?" — a page asks whether the version now in charge is the one it's running
// (all its scripts among this version's files), or a newer one it should reload into.
self.addEventListener("message", (event) => {
  const ask = event.data;
  if (ask && Array.isArray(ask.has)) event.ports[0]?.postMessage({ has: ask.has.every((p) => FILES.includes(p)), version: VERSION });
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/.netlify/")) return;
  if (req.mode === "navigate") {
    event.respondWith(page(event, url));
    return;
  }
  if (hashed(url.pathname)) {
    event.respondWith(kept(req));
    return;
  }
  if (FILES.includes(url.pathname)) event.respondWith(fresh(req, url.pathname));
});

/** A page: the network's, if it answers in time — else the one kept here (a shared link's page for a link). */
async function page(event, url) {
  const shell = url.pathname.startsWith("/s/") ? "/share.html" : "/index.html";
  try {
    // (the network's answer — begun already, if the browser could — within the time we'll wait)
    return await within(
      Promise.resolve(event.preloadResponse).then((pre) => pre ?? fetch(event.request)),
      PATIENCE,
    );
  } catch {
    const here = await mine(shell);
    if (here) return here;
    return fetch(event.request);
  }
}

/** One of the app's own files: the copy kept here, or fetched (and kept) the first time. */
async function kept(req) {
  // (by its address alone: the page asks for its scripts with an Origin, which some servers say
  // their answers vary by — but the app's own files are the same whoever asks)
  const here = await caches.match(req, SAME);
  if (here) return here;
  const res = await fetch(req);
  if (res.ok && res.type === "basic") {
    const copy = res.clone();
    void caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
  }
  return res;
}

/** Network first (kept up to date here), the copy kept here when there's no network. */
async function fresh(req, path) {
  try {
    const res = await fetch(req);
    if (res.ok && res.type === "basic") {
      const copy = res.clone();
      void caches.open(CACHE).then((c) => c.put(path, copy)).catch(() => {});
    }
    return res;
  } catch (err) {
    const here = await mine(path);
    if (here) return here;
    throw err;
  }
}

/** This version's copy of a file (else an earlier version's). */
async function mine(path) {
  return (await (await caches.open(CACHE)).match(path, SAME)) ?? (await caches.match(path, SAME));
}

function within(promise, ms) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("timed out")), ms);
    promise.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}
