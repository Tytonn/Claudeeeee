import { create } from "zustand";
import { subscribeWithSelector } from "zustand/middleware";
import type { JSONContent } from "@tiptap/core";
import type { Countdown, Note, NoteGroup, Settings, SharedLink, ShareRecord, TitleStyle, Todo, Vault } from "../lib/types";
import { uid } from "../lib/id";
import { isBlank } from "../lib/text";

export const DEFAULT_SETTINGS: Settings = {
  accent: "iris",
  font: "sans",
  titleFont: "display",
  titleSize: "m",
  titleAlign: "left",
  size: "m",
  todos: true,
  countdowns: true,
  sounds: true,
  fadeWhileTyping: true,
  effects: "cosmic",
  backdrop: "clear",
  scene: "eclipse",
  lightning: true,
  cityLights: true,
  rainAmount: "rain",
  cityBlur: 1,
  galaxyEclipse: false,
  galaxyEclipseSpot: "beside",
  solarClouds: true,
  solarSize: 0.5,
  solarLook: "corona",
  solarTint: "pearl",
  showVersion: false,
  cursorLight: true,
  inkLetters: false,
  inkColours: "sumi",
  inkDetail: "high",
  skyColours: "azure",
  skyClouds: 0.55,
  skyWind: 0.5,
  clockMs: false,
  clockMsDigits: 3,
  todoGroups: false,
  todoLabels: {},
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
  /** Hidden notes are showing (this session only — every reload starts locked). */
  unlocked: boolean;
  /** The PIN pad, when it's up: to unlock, to choose a PIN, to change it — and what to do after. */
  vault: VaultPrompt | null;
  /** A group whose name is being edited in the sidebar. */
  renaming: string | null;
};

export type VaultPrompt = { mode: "unlock" | "setup" | "change"; then?: { hide: string } | { open: true } };

type Hydration = {
  notes: Record<string, Note>;
  groups: NoteGroup[];
  vault: Vault | null;
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
  groups: NoteGroup[];
  vault: Vault | null;
  todos: Todo[];
  countdowns: Countdown[];
  shares: Record<string, ShareRecord>;
  shared: Record<string, SharedLink>;
  settings: Settings;
  ui: UIState;

  hydrate(data: Hydration): void;
  setUI(patch: Partial<UIState>): void;
  setSettings(patch: Partial<Settings>): void;

  createNote(init?: Partial<Pick<Note, "title" | "doc" | "text" | "groupId" | "hidden" | "titleStyle">>): string;
  updateNote(id: string, patch: Partial<Note>, touch?: boolean): void;
  /** Changes a note's own title look (null: back to how every title looks). */
  setTitleStyle(id: string, patch: TitleStyle | null): void;
  /** Every note back to the usual title look; gives back what they had (to undo). */
  clearTitleStyles(): Record<string, TitleStyle>;
  selectNote(id: string | null): void;
  trashNote(id: string): void;
  restoreNote(id: string): void;
  destroyNote(id: string): void;
  emptyTrash(): void;
  togglePin(id: string): void;
  duplicateNote(id: string): string | null;

  createGroup(name: string): string;
  renameGroup(id: string, name: string): void;
  setGroupCollapsed(id: string, collapsed: boolean): void;
  deleteGroup(id: string): { group: NoteGroup; index: number; noteIds: string[] } | null;
  restoreGroup(saved: { group: NoteGroup; index: number; noteIds: string[] }): void;
  moveToGroup(noteId: string, groupId: string | null): void;

  setHidden(id: string, hidden: boolean): void;
  setVault(vault: Vault | null): void;
  setUnlocked(unlocked: boolean): void;

  addTodo(text: string, afterId?: string | null, color?: Todo["color"]): string;
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

/**
 * Notes sorted the way the sidebar shows them: pinned first, then most recently edited.
 * Hidden notes stay out unless asked for (i.e. while they're unlocked).
 */
export function sortedNotes(notes: Record<string, Note>, withHidden = false): Note[] {
  return Object.values(notes)
    .filter((n) => !n.deletedAt && (withHidden || !n.hidden))
    .sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned) || b.updatedAt - a.updatedAt);
}

/** Whether a note can be seen right now (not trashed, and not hidden away while locked). */
export const isVisible = (n: Note | undefined, unlocked: boolean): n is Note => !!n && !n.deletedAt && (unlocked || !n.hidden);

export const useApp = create<AppState>()(
  subscribeWithSelector((set, get) => ({
    ready: false,
    notes: {},
    groups: [],
    vault: null,
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
      unlocked: false,
      vault: null,
      renaming: null,
    },

    hydrate(data) {
      // Every visit starts with hidden notes locked away, so never reopen one.
      const activeId = isVisible(data.activeId ? data.notes[data.activeId] : undefined, false) ? data.activeId : (sortedNotes(data.notes)[0]?.id ?? null);
      set((s) => ({
        ready: true,
        notes: data.notes,
        groups: data.groups,
        vault: data.vault,
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
        groupId: init.groupId && get().groups.some((g) => g.id === init.groupId) ? init.groupId : null,
        hidden: init.hidden === true,
        ...(init.titleStyle && Object.keys(init.titleStyle).length ? { titleStyle: { ...init.titleStyle } } : {}),
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

    setTitleStyle(id, patch) {
      set((s) => {
        const cur = s.notes[id];
        if (!cur) return s;
        // A choice that matches every other title isn't this note's own.
        const usual: TitleStyle = { font: s.settings.titleFont, size: s.settings.titleSize, align: s.settings.titleAlign };
        const next: TitleStyle = patch ? { ...cur.titleStyle, ...patch } : {};
        for (const k of Object.keys(next) as (keyof TitleStyle)[]) if (next[k] === undefined || next[k] === usual[k]) delete next[k];
        const { titleStyle: _drop, ...rest } = cur;
        const note: Note = Object.keys(next).length ? { ...rest, titleStyle: next } : rest;
        return { notes: { ...s.notes, [id]: { ...note, updatedAt: now() } } };
      });
    },

    clearTitleStyles() {
      const had: Record<string, TitleStyle> = {};
      set((s) => {
        let notes = s.notes;
        for (const [id, n] of Object.entries(s.notes)) {
          if (!n.titleStyle) continue;
          had[id] = n.titleStyle;
          if (notes === s.notes) notes = { ...s.notes };
          const { titleStyle: _drop, ...rest } = n;
          notes[id] = { ...rest, updatedAt: now() };
        }
        return notes === s.notes ? s : { notes };
      });
      return had;
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
      const list = sortedNotes(s.notes, s.ui.unlocked);
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
        // Hidden notes in the trash are only emptied while you can see them.
        for (const n of Object.values(s.notes)) if (!n.deletedAt || (n.hidden && !s.ui.unlocked)) notes[n.id] = n;
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
        groupId: src.groupId ?? null,
        hidden: src.hidden === true,
        titleStyle: src.titleStyle ?? null,
      });
      return copy;
    },

    // ── Groups ─────────────────────────────────────────────────────────────
    createGroup(name) {
      const id = uid();
      const t = now();
      set((s) => ({ groups: [...s.groups, { id, name: name.trim().slice(0, 60) || "New group", collapsed: false, createdAt: t, updatedAt: t }] }));
      return id;
    },

    renameGroup(id, name) {
      const clean = name.trim().slice(0, 60);
      if (!clean) return;
      set((s) => ({ groups: s.groups.map((g) => (g.id === id ? { ...g, name: clean, updatedAt: now() } : g)) }));
    },

    setGroupCollapsed(id, collapsed) {
      set((s) => ({ groups: s.groups.map((g) => (g.id === id ? { ...g, collapsed, updatedAt: now() } : g)) }));
    },

    deleteGroup(id) {
      const s = get();
      const index = s.groups.findIndex((g) => g.id === id);
      if (index < 0) return null;
      const group = s.groups[index];
      const noteIds = Object.values(s.notes)
        .filter((n) => n.groupId === id)
        .map((n) => n.id);
      set((st) => {
        const notes = { ...st.notes };
        // The notes stay; they just aren't filed anywhere any more.
        for (const nid of noteIds) notes[nid] = { ...notes[nid], groupId: null };
        return { groups: st.groups.filter((g) => g.id !== id), notes };
      });
      return { group, index, noteIds };
    },

    restoreGroup(saved) {
      set((s) => {
        const groups = s.groups.filter((g) => g.id !== saved.group.id);
        groups.splice(Math.min(saved.index, groups.length), 0, saved.group);
        const notes = { ...s.notes };
        for (const nid of saved.noteIds) if (notes[nid]) notes[nid] = { ...notes[nid], groupId: saved.group.id };
        return { groups, notes };
      });
    },

    moveToGroup(noteId, groupId) {
      set((s) => {
        const note = s.notes[noteId];
        if (!note || (note.groupId ?? null) === groupId) return s;
        if (groupId && !s.groups.some((g) => g.id === groupId)) return s;
        // Filing a note away isn't an edit: it keeps its place in time.
        return { notes: { ...s.notes, [noteId]: { ...note, groupId } } };
      });
    },

    // ── Hidden notes ───────────────────────────────────────────────────────
    setHidden(id, hidden) {
      set((s) => {
        const note = s.notes[id];
        if (!note) return s;
        const notes = { ...s.notes, [id]: { ...note, hidden } };
        // Hidden while locked: it can't stay open in front of everyone.
        let ui = s.ui;
        if (hidden && !s.ui.unlocked && s.ui.activeId === id) {
          const next = sortedNotes(notes)[0]?.id ?? null;
          ui = { ...s.ui, activeId: next };
        }
        return { notes, ui };
      });
    },

    setVault(vault) {
      set({ vault });
    },

    setUnlocked(unlocked) {
      set((s) => {
        let activeId = s.ui.activeId;
        if (!unlocked && activeId && s.notes[activeId]?.hidden) activeId = sortedNotes(s.notes)[0]?.id ?? null;
        return { ui: { ...s.ui, unlocked, activeId } };
      });
    },

    // ── To-dos ─────────────────────────────────────────────────────────────
    addTodo(text, afterId, color) {
      const id = uid();
      const t = now();
      const todo: Todo = { id, text, done: false, createdAt: t, updatedAt: t, color: color ?? null };
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
