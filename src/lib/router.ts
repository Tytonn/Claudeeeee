import { useSyncExternalStore } from "react";

export type Route = { kind: "app" } | { kind: "share"; id: string; key: string };

function parse(): Route {
  const m = /^\/s\/([A-Za-z0-9]{8,32})\/?$/.exec(location.pathname);
  if (m) return { kind: "share", id: m[1], key: location.hash.replace(/^#/, "") };
  return { kind: "app" };
}

let current = parse();
const listeners = new Set<() => void>();

function emit() {
  const next = parse();
  if (next.kind !== current.kind || (next.kind === "share" && current.kind === "share" && (next.id !== current.id || next.key !== current.key))) {
    current = next;
  }
  listeners.forEach((l) => l());
}

window.addEventListener("popstate", emit);
window.addEventListener("hashchange", emit);

export function navigate(path: string, replace = false) {
  if (replace) history.replaceState(null, "", path);
  else history.pushState(null, "", path);
  emit();
}

export function useRoute(): Route {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => current,
  );
}
