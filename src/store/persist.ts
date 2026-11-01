import { createStore, delMany, entries, getMany, set as idbSet, setMany } from "idb-keyval";
import type { Countdown, Note, Settings, ShareRecord, Todo } from "../lib/types";
import { DEFAULT_SETTINGS, useApp } from "./app";
import { seedData } from "./seed";

const db = createStore("umbra", "kv");
const SETTINGS_KEY = "umbra:settings";
const UI_KEY = "umbra:ui";
const TRASH_TTL = 30 * 86_400_000;

function readLocal<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? ({ ...fallback, ...JSON.parse(raw) } as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeLocal(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* quota / private mode */
  }
}

export let storageOk = true;

export async function loadAll() {
  let rows: [IDBValidKey, unknown][] = [];
  try {
    rows = await entries(db);
  } catch (err) {
    console.warn("IndexedDB unavailable", err);
    storageOk = false;
  }

  const notes: Record<string, Note> = {};
  let todos: Todo[] | null = null;
  let countdowns: Countdown[] | null = null;
  let shares: Record<string, ShareRecord> = {};
  let seeded = false;
  const expired: string[] = [];

  for (const [k, v] of rows) {
    const key = String(k);
    if (key.startsWith("note:")) {
      const note = v as Note;
      if (note.deletedAt && Date.now() - note.deletedAt > TRASH_TTL) expired.push(key);
      else notes[note.id] = note;
    } else if (key === "todos") todos = v as Todo[];
    else if (key === "countdowns") countdowns = v as Countdown[];
    else if (key === "shares") shares = v as Record<string, ShareRecord>;
    else if (key === "meta") seeded = Boolean((v as { seeded?: boolean })?.seeded);
  }
  if (expired.length) void delMany(expired, db).catch(() => {});

  const settings = readLocal<Settings>(SETTINGS_KEY, DEFAULT_SETTINGS);
  const ui = readLocal<{ activeId: string | null }>(UI_KEY, { activeId: null });

  if (!seeded && Object.keys(notes).length === 0 && storageOk) {
    const seed = seedData();
    for (const n of seed.notes) notes[n.id] = n;
    todos = seed.todos;
    countdowns = seed.countdowns;
    ui.activeId = seed.notes[0]?.id ?? null;
    try {
      await setMany(
        [
          ...seed.notes.map((n) => [`note:${n.id}`, n] as [string, unknown]),
          ["todos", todos],
          ["countdowns", countdowns],
          ["meta", { seeded: true, at: Date.now() }],
        ],
        db,
      );
    } catch {
      /* ignore */
    }
  } else if (!seeded) {
    void idbSet("meta", { seeded: true, at: Date.now() }, db).catch(() => {});
  }

  return { notes, todos: todos ?? [], countdowns: countdowns ?? [], shares, settings, activeId: ui.activeId };
}

/** Mirrors store changes into IndexedDB (per-record, batched) and keeps other tabs in sync. */
export function startPersistence() {
  let prev = useApp.getState();
  let pending = new Map<string, unknown>();
  let deletions = new Set<string>();
  let timer = 0;
  let applyingRemote = false;
  const channel = typeof BroadcastChannel !== "undefined" ? new BroadcastChannel("umbra-sync") : null;

  const flush = async () => {
    if (timer) {
      clearTimeout(timer);
      timer = 0;
    }
    if (!pending.size && !deletions.size) return;
    const sets = [...pending.entries()];
    const dels = [...deletions];
    pending = new Map();
    deletions = new Set();
    try {
      if (sets.length) await setMany(sets, db);
      if (dels.length) await delMany(dels, db);
      useApp.getState().setUI({ savedAt: Date.now() });
      channel?.postMessage({ keys: [...sets.map(([k]) => k), ...dels] });
    } catch (err) {
      console.error("Save failed", err);
      // Re-queue so the next change retries.
      for (const [k, v] of sets) if (!pending.has(k)) pending.set(k, v);
      for (const k of dels) deletions.add(k);
    }
  };

  useApp.subscribe((s) => {
    if (!s.ready || applyingRemote) {
      prev = s;
      return;
    }
    if (s.notes !== prev.notes) {
      for (const id in s.notes) {
        if (s.notes[id] !== prev.notes[id]) {
          pending.set(`note:${id}`, s.notes[id]);
          deletions.delete(`note:${id}`);
        }
      }
      for (const id in prev.notes) {
        if (!s.notes[id]) {
          pending.delete(`note:${id}`);
          deletions.add(`note:${id}`);
        }
      }
    }
    if (s.todos !== prev.todos) pending.set("todos", s.todos);
    if (s.countdowns !== prev.countdowns) pending.set("countdowns", s.countdowns);
    if (s.shares !== prev.shares) pending.set("shares", s.shares);
    if (s.settings !== prev.settings) writeLocal(SETTINGS_KEY, s.settings);
    if (s.ui.activeId !== prev.ui.activeId) writeLocal(UI_KEY, { activeId: s.ui.activeId });
    prev = s;
    if ((pending.size || deletions.size) && !timer) timer = window.setTimeout(() => void flush(), 140);
  });

  // Pull any debounced editor text into the store first, then write synchronously-started IDB txns.
  const flushAll = () => {
    window.dispatchEvent(new Event("umbra:flush-editor"));
    void flush();
  };
  window.addEventListener("pagehide", flushAll);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flushAll();
  });

  if (channel) {
    channel.onmessage = async (event: MessageEvent<{ keys?: string[] }>) => {
      const keys = (event.data?.keys ?? []).filter((k) => typeof k === "string");
      if (!keys.length) return;
      const values = await getMany(keys, db).catch(() => null);
      if (!values) return;
      applyingRemote = true;
      try {
        useApp.setState((s) => {
          const next: Partial<typeof s> = {};
          let notes = s.notes;
          keys.forEach((key, i) => {
            const value = values[i];
            if (key.startsWith("note:")) {
              const id = key.slice(5);
              if (notes === s.notes) notes = { ...s.notes };
              if (value) notes[id] = value as Note;
              else delete notes[id];
            } else if (key === "todos" && value) next.todos = value as Todo[];
            else if (key === "countdowns" && value) next.countdowns = value as Countdown[];
            else if (key === "shares" && value) next.shares = value as Record<string, ShareRecord>;
          });
          if (notes !== s.notes) next.notes = notes;
          return next;
        });
      } finally {
        applyingRemote = false;
      }
    };
  }

  // Settings changed in another tab.
  window.addEventListener("storage", (e) => {
    if (e.key === SETTINGS_KEY && e.newValue) {
      try {
        applyingRemote = true;
        useApp.setState({ settings: { ...DEFAULT_SETTINGS, ...JSON.parse(e.newValue) } });
      } catch {
        /* ignore */
      } finally {
        applyingRemote = false;
      }
    }
  });

  // Ask (silently, where supported) for storage that the browser won't evict.
  try {
    const isFirefox = /firefox/i.test(navigator.userAgent);
    if (!isFirefox) void navigator.storage?.persist?.();
  } catch {
    /* noop */
  }

  return flushAll;
}

export async function exportAll(): Promise<Blob> {
  const s = useApp.getState();
  const data = {
    app: "umbra",
    version: 1,
    exportedAt: new Date().toISOString(),
    notes: Object.values(s.notes),
    todos: s.todos,
    countdowns: s.countdowns,
    settings: s.settings,
  };
  return new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
}

export function importBackup(raw: unknown): { notes: number; todos: number; countdowns: number } {
  const data = raw as { app?: string; notes?: Note[]; todos?: Todo[]; countdowns?: Countdown[] };
  if (!data || data.app !== "umbra") throw new Error("This doesn't look like an umbra backup.");
  const s = useApp.getState();
  const notes = { ...s.notes };
  let n = 0;
  for (const note of data.notes ?? []) {
    if (!note?.id) continue;
    const existing = notes[note.id];
    if (!existing || existing.updatedAt < note.updatedAt) {
      notes[note.id] = note;
      n++;
    }
  }
  const todoIds = new Set(s.todos.map((t) => t.id));
  const newTodos = (data.todos ?? []).filter((t) => t?.id && !todoIds.has(t.id));
  const cdIds = new Set(s.countdowns.map((c) => c.id));
  const newCds = (data.countdowns ?? []).filter((c) => c?.id && !cdIds.has(c.id));
  useApp.setState({ notes, todos: [...s.todos, ...newTodos], countdowns: [...s.countdowns, ...newCds] });
  return { notes: n, todos: newTodos.length, countdowns: newCds.length };
}
