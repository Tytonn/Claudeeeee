import { create } from "zustand";
import { subscribeWithSelector } from "zustand/middleware";
import type { JSONContent } from "@tiptap/core";
import type { Countdown, Note, Settings, SharedLink, ShareRecord, Todo } from "../lib/types";
import { uid } from "../lib/id";
import { isBlank } from "../lib/text";

export const DEFAULT_SETTINGS: Settings = {
  accent: "iris",
  font: "sans",
  size: "m",
  todos: true,
  countdowns: true,
  sounds: true,
  fadeWhileTyping: true,
  effects: "cosmic",
  backdrop: "dark",
  ink: "",
  scene: "eclipse",
  lightning: true,
  cityLights: true,
  rainAmount: "rain",
  rainBlur: 0.25,
  rainSound: false,
  rainVolume: 0.6,
  name: "",
  sidebar: true,
  rail: true,
};

export type UIState = {
  activeId: string | null;
  view: "notes" | "trash";
  palette: boolean;
  settings: boolean;
  shortcuts: boolean;
  /** The account (sign in / sync) dialog. */
  account: boolean;
  share: string | null; // anchor
  /** A link someone shared with you, open in the editor area. */
  openShared: string | null;
  focus: boolean;
  mobile: "list" | "editor" | "rail";
  savedAt: number;
};

type Hydration = {
  notes: Record<string, Note>;
  todos: Todo[];
  countdowns: Countdown[];
  shares: Record<string, ShareRecord>;
  shared: Record<string, SharedLink>;
  settings: Settings;
  activeId: string | null;
};

export type AppState = {
  ready: boolean;
  notes: Record<string, Note>;
  todos: Todo[];
  countdowns: Countdown[];
  shares: Record<string, ShareRecord>;
  shared: Record<string, SharedLink>;
  settings: Settings;
  ui: UIState;

  hydrate(data: Hydration): void;
  setUI(patch: Partial<UIState>): void;
  setSettings(patch: Partial<Settings>): void;

  createNote(init?: Partial<Pick<Note, "title" | "doc" | "text">>): string;
  updateNote(id: string, patch: Partial<Note>, touch?: boolean): void;
  selectNote(id: string | null): void;
  trashNote(id: string): void;
  restoreNote(id: string): void;
  destroyNote(id: string): void;
  emptyTrash(): void;
  togglePin(id: string): void;
  duplicateNote(id: string): string | null;

  addTodo(text: string, afterId?: string | null): string;
  updateTodo(id: string, patch: Partial<Todo>): void;
  toggleTodo(id: string): boolean;
  removeTodo(id: string): { todo: Todo; index: number } | null;
  restoreTodo(todo: Todo, index: number): void;
  reorderOpenTodos(ids: string[]): void;
  clearDoneTodos(): Todo[];
  importTodos(items: { text: string; done: boolean }[]): void;

  addCountdown(c: Pick<Countdown, "title" | "date" | "time" | "repeat">): string;
  updateCountdown(id: string, patch: Partial<Countdown>): void;
  removeCountdown(id: string): { item: Countdown; index: number } | null;
  restoreCountdown(item: Countdown, index: number): void;
  importCountdowns(items: Pick<Countdown, "title" | "date" | "time" | "repeat">[]): void;

  putShare(record: ShareRecord): void;
  patchShare(anchor: string, patch: Partial<ShareRecord>): void;
  dropShare(anchor: string): void;
  putShared(link: SharedLink): void;
  dropShared(id: string): void;
};

const now = () => Date.now();

/** Notes sorted the way the sidebar shows them: pinned first, then most recently edited. */
export function sortedNotes(notes: Record<string, Note>): Note[] {
  return Object.values(notes)
    .filter((n) => !n.deletedAt)
    .sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned) || b.updatedAt - a.updatedAt);
}

export const useApp = create<AppState>()(
  subscribeWithSelector((set, get) => ({
    ready: false,
    notes: {},
    todos: [],
    countdowns: [],
    shares: {},
    shared: {},
    settings: DEFAULT_SETTINGS,
    ui: {
      activeId: null,
      view: "notes",
      palette: false,
      settings: false,
      shortcuts: false,
      account: false,
      share: null,
      openShared: null,
      focus: false,
      mobile: "list",
      savedAt: 0,
    },

    hydrate(data) {
      const activeId = data.activeId && data.notes[data.activeId] && !data.notes[data.activeId].deletedAt ? data.activeId : (sortedNotes(data.notes)[0]?.id ?? null);
      set((s) => ({
        ready: true,
        notes: data.notes,
        todos: data.todos,
        countdowns: data.countdowns,
        shares: data.shares,
        shared: data.shared,
        settings: { ...DEFAULT_SETTINGS, ...data.settings },
        ui: { ...s.ui, activeId },
      }));
    },

    setUI(patch) {
      set((s) => ({ ui: { ...s.ui, ...patch } }));
    },

    setSettings(patch) {
      set((s) => ({ settings: { ...s.settings, ...patch } }));
    },

    // ── Notes ──────────────────────────────────────────────────────────────
    createNote(init = {}) {
      const id = uid();
      const t = now();
      const note: Note = {
        id,
        title: typeof init.title === "string" ? init.title : "",
        doc: init.doc && typeof init.doc === "object" ? (init.doc as JSONContent) : null,
        text: typeof init.text === "string" ? init.text : "",
        createdAt: t,
        updatedAt: t,
      };
      const prev = get().ui.activeId;
      set((s) => {
        const notes = { ...s.notes, [id]: note };
        // Quietly discard the note we're leaving if it was never written in.
        if (prev && prev !== id && notes[prev] && isBlank(notes[prev]) && !s.shares[prev]) delete notes[prev];
        return { notes, ui: { ...s.ui, activeId: id, openShared: null, view: "notes", mobile: "editor" } };
      });
      return id;
    },

    updateNote(id, patch, touch = true) {
      set((s) => {
        const cur = s.notes[id];
        if (!cur) return s;
        return { notes: { ...s.notes, [id]: { ...cur, ...patch, updatedAt: touch ? now() : cur.updatedAt } } };
      });
    },

    selectNote(id) {
      const prev = get().ui.activeId;
      set((s) => {
        let notes = s.notes;
        if (prev && prev !== id && notes[prev] && isBlank(notes[prev]) && !notes[prev].deletedAt && !s.shares[prev]) {
          notes = { ...notes };
          delete notes[prev];
        }
        return { notes, ui: { ...s.ui, activeId: id, openShared: null, mobile: id ? "editor" : s.ui.mobile } };
      });
    },

    trashNote(id) {
      const s = get();
      const note = s.notes[id];
      if (!note) return;
      const list = sortedNotes(s.notes);
      const idx = list.findIndex((n) => n.id === id);
      const next = list[idx + 1] ?? list[idx - 1] ?? null;
      set((st) => {
        const notes = { ...st.notes };
        if (isBlank(note)) delete notes[id];
        else notes[id] = { ...note, deletedAt: now() };
        return { notes, ui: { ...st.ui, activeId: st.ui.activeId === id ? (next?.id ?? null) : st.ui.activeId } };
      });
    },

    restoreNote(id) {
      set((s) => {
        const note = s.notes[id];
        if (!note) return s;
        return { notes: { ...s.notes, [id]: { ...note, deletedAt: null } }, ui: { ...s.ui, activeId: id, view: "notes" } };
      });
    },

    destroyNote(id) {
      set((s) => {
        const notes = { ...s.notes };
        delete notes[id];
        return { notes, ui: { ...s.ui, activeId: s.ui.activeId === id ? null : s.ui.activeId } };
      });
    },

    emptyTrash() {
      set((s) => {
        const notes: Record<string, Note> = {};
        for (const n of Object.values(s.notes)) if (!n.deletedAt) notes[n.id] = n;
        return { notes };
      });
    },

    togglePin(id) {
      set((s) => {
        const note = s.notes[id];
        if (!note) return s;
        return { notes: { ...s.notes, [id]: { ...note, pinned: !note.pinned } } };
      });
    },

    duplicateNote(id) {
      const src = get().notes[id];
      if (!src) return null;
      const copy = get().createNote({
        title: src.title ? `${src.title} (copy)` : "",
        doc: src.doc ? structuredClone(src.doc) : null,
        text: src.text,
      });
      return copy;
    },

    // ── To-dos ─────────────────────────────────────────────────────────────
    addTodo(text, afterId) {
      const id = uid();
      const t = now();
      const todo: Todo = { id, text, done: false, createdAt: t, updatedAt: t };
      set((s) => {
        const todos = [...s.todos];
        const at = afterId ? todos.findIndex((x) => x.id === afterId) : -1;
        if (at >= 0) todos.splice(at + 1, 0, todo);
        else {
          // New items go to the top of the open list.
          todos.unshift(todo);
        }
        return { todos };
      });
      return id;
    },

    updateTodo(id, patch) {
      set((s) => ({ todos: s.todos.map((t) => (t.id === id ? { ...t, ...patch, updatedAt: now() } : t)) }));
    },

    toggleTodo(id) {
      let done = false;
      set((s) => ({
        todos: s.todos.map((t) => {
          if (t.id !== id) return t;
          done = !t.done;
          return { ...t, done, doneAt: done ? now() : null, updatedAt: now() };
        }),
      }));
      return done;
    },

    removeTodo(id) {
      const index = get().todos.findIndex((t) => t.id === id);
      if (index < 0) return null;
      const todo = get().todos[index];
      set((s) => ({ todos: s.todos.filter((t) => t.id !== id) }));
      return { todo, index };
    },

    restoreTodo(todo, index) {
      set((s) => {
        const todos = s.todos.filter((t) => t.id !== todo.id);
        todos.splice(Math.min(index, todos.length), 0, todo);
        return { todos };
      });
    },

    reorderOpenTodos(ids) {
      set((s) => {
        const byId = new Map(s.todos.map((t) => [t.id, t]));
        const open = ids.map((id) => byId.get(id)).filter((t): t is Todo => !!t && !t.done);
        const rest = s.todos.filter((t) => t.done || !ids.includes(t.id));
        return { todos: [...open, ...rest] };
      });
    },

    clearDoneTodos() {
      const removed = get().todos.filter((t) => t.done);
      set((s) => ({ todos: s.todos.filter((t) => !t.done) }));
      return removed;
    },

    importTodos(items) {
      const t = now();
      // Skip anything already on the list (e.g. saving the same link twice).
      const existing = new Set(get().todos.map((x) => x.text.trim().toLowerCase()));
      const incoming = items.filter((i) => typeof i?.text === "string" && i.text.trim() && !existing.has(i.text.trim().toLowerCase()));
      const fresh: Todo[] = incoming.map((i, k) => ({
        id: uid(),
        text: i.text,
        done: i.done,
        createdAt: t + k,
        updatedAt: t + k,
        doneAt: i.done ? t : null,
      }));
      set((s) => ({ todos: [...fresh.filter((x) => !x.done), ...s.todos, ...fresh.filter((x) => x.done)] }));
    },

    // ── Countdowns ─────────────────────────────────────────────────────────
    addCountdown(c) {
      const id = uid();
      const t = now();
      set((s) => ({ countdowns: [...s.countdowns, { id, title: c.title, date: c.date, time: c.time ?? null, repeat: c.repeat ?? null, createdAt: t, updatedAt: t }] }));
      return id;
    },

    updateCountdown(id, patch) {
      set((s) => ({ countdowns: s.countdowns.map((c) => (c.id === id ? { ...c, ...patch, updatedAt: now() } : c)) }));
    },

    removeCountdown(id) {
      const index = get().countdowns.findIndex((c) => c.id === id);
      if (index < 0) return null;
      const item = get().countdowns[index];
      set((s) => ({ countdowns: s.countdowns.filter((c) => c.id !== id) }));
      return { item, index };
    },

    restoreCountdown(item, index) {
      set((s) => {
        const list = s.countdowns.filter((c) => c.id !== item.id);
        list.splice(Math.min(index, list.length), 0, item);
        return { countdowns: list };
      });
    },

    importCountdowns(items) {
      const t = now();
      const key = (c: Pick<Countdown, "title" | "date">) => `${c.title.trim().toLowerCase()}|${c.date}`;
      const existing = new Set(get().countdowns.map(key));
      const incoming = items.filter((c) => typeof c?.title === "string" && /^\d{4}-\d{2}-\d{2}$/.test(String(c.date)) && !existing.has(key(c)));
      set((s) => ({
        countdowns: [
          ...s.countdowns,
          ...incoming.map((c, k) => ({ id: uid(), title: c.title, date: c.date, time: c.time ?? null, repeat: c.repeat ?? null, createdAt: t + k, updatedAt: t + k })),
        ],
      }));
    },

    // ── Shares ─────────────────────────────────────────────────────────────
    putShare(record) {
      set((s) => ({ shares: { ...s.shares, [record.anchor]: record } }));
    },

    patchShare(anchor, patch) {
      set((s) => {
        const cur = s.shares[anchor];
        if (!cur) return s;
        return { shares: { ...s.shares, [anchor]: { ...cur, ...patch } } };
      });
    },

    dropShare(anchor) {
      set((s) => {
        const shares = { ...s.shares };
        delete shares[anchor];
        return { shares };
      });
    },

    // ── Links shared with you ──────────────────────────────────────────────
    putShared(link) {
      set((s) => ({ shared: { ...s.shared, [link.id]: link } }));
    },

    dropShared(id) {
      set((s) => {
        const shared = { ...s.shared };
        delete shared[id];
        return { shared, ui: s.ui.openShared === id ? { ...s.ui, openShared: null } : s.ui };
      });
    },
  })),
);

export const app = () => useApp.getState();
