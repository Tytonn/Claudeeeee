import type { JSONContent } from "@tiptap/core";

export type Note = {
  id: string;
  title: string;
  doc: JSONContent | null;
  /** Plain-text projection of `doc`, used for previews + search. */
  text: string;
  createdAt: number;
  updatedAt: number;
  pinned?: boolean;
  deletedAt?: number | null;
};

export type Todo = {
  id: string;
  text: string;
  done: boolean;
  createdAt: number;
  updatedAt: number;
  doneAt?: number | null;
};

export type Countdown = {
  id: string;
  title: string;
  /** Local calendar date, YYYY-MM-DD. For yearly events the year is the original one. */
  date: string;
  /** Optional local time, HH:MM (24h). */
  time?: string | null;
  repeat?: "yearly" | null;
  createdAt: number;
  updatedAt: number;
};

export type AccentId = "iris" | "moon" | "sky" | "mint" | "corona" | "ember" | "rose";
export type FontId = "sans" | "serif" | "mono";
export type SizeId = "s" | "m" | "l";
export type EffectsId = "cosmic" | "subtle" | "off";
/** How much of the sky shows through the panels. */
export type BackdropId = "dark" | "glass" | "clear";

export type Settings = {
  accent: AccentId;
  font: FontId;
  size: SizeId;
  todos: boolean;
  countdowns: boolean;
  sounds: boolean;
  fadeWhileTyping: boolean;
  effects: EffectsId;
  backdrop: BackdropId;
  name: string;
  sidebar: boolean;
  rail: boolean;
};

/** A live link the owner can keep updating or revoke. Keyed by anchor (note id or "board"). */
export type ShareRecord = {
  anchor: string;
  id: string;
  token: string;
  key: string;
  includeTodos: boolean;
  includeCountdowns: boolean;
  createdAt: number;
  pushedAt: number;
  hash?: string;
  rev?: number;
  /** The note lives in a co-editable doc on the server (see collab.mts). */
  collab?: boolean;
  /** Friends holding the link may edit (notes only; default true). */
  editable?: boolean;
};

/** What the friend receives (inside the encrypted envelope). */
export type SharePayload = {
  v: 1;
  from?: string;
  sharedAt: number;
  /** With `collab`, the note itself is in the live doc rather than in here. */
  note?: { title: string; doc: JSONContent | null; text: string; updatedAt: number; collab?: boolean };
  todos?: { text: string; done: boolean }[];
  countdowns?: { title: string; date: string; time?: string | null; repeat?: "yearly" | null; createdAt: number }[];
};
