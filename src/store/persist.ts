import { createStore, delMany, entries, getMany, set as idbSet, setMany } from "idb-keyval";
import type { Countdown, Note, Settings, ShareRecord, Todo } from "../lib/types";
import { normalizeCountdown, normalizeList, normalizeNote, normalizeShareRecord, normalizeTodo } from "../lib/sanitize";
import { safeDoc } from "../components/editor/safeDoc";
import { DEFAULT_SETTINGS, useApp } from "./app";
import { seedData } from "./seed";

const db = createStore("umbra", "kv");
const SETTINGS_KEY = "umbra:settings";
const UI_KEY = "umbra:ui";
const TRASH_TTL = 30 * 86_400_000;

/*
 * Storage layout (IndexedDB "umbra"/"kv"):
 *   note:<id>        one record per note
 *   share:<anchor>   one record per live link (anchor = note id or "board")
 *   todos            the to-do list (ordered array)
 *   countdowns       the countdowns (array)
 *   meta             { seeded }
 * Settings + the open note id live in localStorage so first paint is instant.
 */

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

/** False when saved data couldn't be read — we then refuse to write, so nothing gets overwritten. */
export let storageOk = true;

let applyingRemote = false;
/** True while a change that originated in another tab is being applied to this tab's store. */
export const isApplyingRemote = () => applyingRemote;

async function readAll(): Promise<[IDBValidKey, unknown][] | null> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await entries(db);
    } catch (err) {
      console.warn(`Reading saved data failed (attempt ${attempt + 1})`, err);
      await new Promise((r) => setTimeout(r, 200 * (attempt + 1)));
    }
  }
  return null;
}

export async function loadAll() {
  const rows = await readAll();
  if (!rows) storageOk = false;

  const notes: Record<string, Note> = {};
  let todos: Todo[] | null = null;
  let countdowns: Countdown[] | null = null;
  const shares: Record<string, ShareRecord> = {};
  let legacyShares = false;
  let seeded = false;
  const expired: string[] = [];

  for (const [k, v] of rows ?? []) {
    const key = String(k);
    if (key.startsWith("note:")) {
      const note = normalizeNote(v);
      if (!note) continue;
      // Trash empties itself after 30 days. (Any live link is revoked by shareSync on start.)
      if (note.deletedAt && Date.now() - note.deletedAt > TRASH_TTL) expired.push(key);
      else notes[note.id] = note;
    } else if (key.startsWith("share:")) {
      const record = normalizeShareRecord(v);
      if (record) shares[record.anchor] = record;
    } else if (key === "shares") {
      // Older layout kept every link under one key.
      legacyShares = true;
      for (const raw of Object.values((v ?? {}) as Record<string, unknown>)) {
        const record = normalizeShareRecord(raw);
        if (record && !shares[record.anchor]) shares[record.anchor] = record;
      }
    } else if (key === "todos") todos = normalizeList(v, normalizeTodo);
    else if (key === "countdowns") countdowns = normalizeList(v, normalizeCountdown);
    else if (key === "meta") seeded = Boolean((v as { seeded?: boolean })?.seeded);
  }

  if (storageOk) {
    if (expired.length) void delMany(expired, db).catch(() => {});
    if (legacyShares) {
      void setMany(Object.values(shares).map((r) => [`share:${r.anchor}`, r] as [string, unknown]), db)
        .then(() => delMany(["shares"], db))
        .catch(() => {});
    }
  }

  const settings = readLocal<Settings>(SETTINGS_KEY, DEFAULT_SETTINGS);
  const ui = readLocal<{ activeId: string | null }>(UI_KEY, { activeId: null });

  if (storageOk && !seeded && Object.keys(notes).length === 0) {
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
  } else if (storageOk && !seeded) {
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
      // Re-queue (without clobbering anything newer) so the next change retries.
      for (const [k, v] of sets) if (!pending.has(k) && !deletions.has(k)) pending.set(k, v);
      for (const k of dels) if (!pending.has(k)) deletions.add(k);
    }
  };

  const diffRecords = <T,>(prefix: string, next: Record<string, T>, before: Record<string, T>) => {
    for (const id in next) {
      if (next[id] !== before[id]) {
        pending.set(prefix + id, next[id]);
        deletions.delete(prefix + id);
      }
    }
    for (const id in before) {
      if (!next[id]) {
        pending.delete(prefix + id);
        deletions.add(prefix + id);
      }
    }
  };

  useApp.subscribe((s) => {
    if (!s.ready || applyingRemote) {
      prev = s;
      return;
    }
    if (s.notes !== prev.notes) diffRecords("note:", s.notes, prev.notes);
    if (s.shares !== prev.shares) diffRecords("share:", s.shares, prev.shares);
    if (s.todos !== prev.todos) pending.set("todos", s.todos);
    if (s.countdowns !== prev.countdowns) pending.set("countdowns", s.countdowns);
    if (s.settings !== prev.settings) writeLocal(SETTINGS_KEY, s.settings);
    if (s.ui.activeId !== prev.ui.activeId) writeLocal(UI_KEY, { activeId: s.ui.activeId });
    prev = s;
    if ((pending.size || deletions.size) && !timer) timer = window.setTimeout(() => void flush(), 140);
  });

  // Pull any debounced editor text into the store first, then start the IDB writes.
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
      const keys = (event.data?.keys ?? []).filter((k): k is string => typeof k === "string");
      if (!keys.length) return;
      const values = await getMany(keys, db).catch(() => null);
      if (!values) return;
      // The other tab's write is newer than anything we still have queued for these keys.
      for (const key of keys) {
        pending.delete(key);
        deletions.delete(key);
      }
      applyingRemote = true;
      try {
        useApp.setState((s) => {
          const next: Partial<typeof s> = {};
          let notes = s.notes;
          let shares = s.shares;
          keys.forEach((key, i) => {
            const value = values[i];
            if (key.startsWith("note:")) {
              const id = key.slice(5);
              if (notes === s.notes) notes = { ...s.notes };
              const note = value ? normalizeNote(value) : null;
              if (note) notes[id] = note;
              else delete notes[id];
            } else if (key.startsWith("share:")) {
              const anchor = key.slice(6);
              if (shares === s.shares) shares = { ...s.shares };
              const record = value ? normalizeShareRecord(value) : null;
              if (record) shares[anchor] = record;
              else delete shares[anchor];
            } else if (key === "todos" && value) next.todos = normalizeList(value, normalizeTodo);
            else if (key === "countdowns" && value) next.countdowns = normalizeList(value, normalizeCountdown);
          });
          if (notes !== s.notes) next.notes = notes;
          if (shares !== s.shares) next.shares = shares;
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
  const data = raw as { app?: string; notes?: unknown; todos?: unknown; countdowns?: unknown };
  if (!data || data.app !== "umbra") throw new Error("This doesn't look like an umbra backup.");
  const s = useApp.getState();
  const notes = { ...s.notes };
  let n = 0;
  for (const note of normalizeList(data.notes, normalizeNote)) {
    note.doc = safeDoc(note.doc, note.text);
    const existing = notes[note.id];
    if (!existing || existing.updatedAt < note.updatedAt) {
      notes[note.id] = note;
      n++;
    }
  }
  const todoIds = new Set(s.todos.map((t) => t.id));
  const newTodos = normalizeList(data.todos, normalizeTodo).filter((t) => !todoIds.has(t.id));
  const cdIds = new Set(s.countdowns.map((c) => c.id));
  const newCds = normalizeList(data.countdowns, normalizeCountdown).filter((c) => !cdIds.has(c.id));
  useApp.setState({ notes, todos: [...s.todos, ...newTodos], countdowns: [...s.countdowns, ...newCds] });
  return { notes: n, todos: newTodos.length, countdowns: newCds.length };
}
