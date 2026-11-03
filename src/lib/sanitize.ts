import type { JSONContent } from "@tiptap/core";
import type { Countdown, Note, NoteGroup, SharePayload, ShareRecord, SharedLink, TitleStyle, Todo, TodoColor, Vault } from "./types";

/**
 * Everything that comes from outside this tab's own code — a shared link's decrypted
 * payload, a backup file, even IndexedDB — is coerced into the exact shapes the app
 * relies on, so malformed data can never wedge the UI.
 */

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const HH_MM = /^([01]\d|2[0-3]):[0-5]\d$/;
const ID = /^[A-Za-z0-9]{6,40}$/;

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const str = (v: unknown, max = 200_000) => (typeof v === "string" ? v.slice(0, max) : "");
const num = (v: unknown, fallback = Date.now()) => (typeof v === "number" && Number.isFinite(v) ? v : fallback);
const isDoc = (v: unknown): v is JSONContent => isObj(v) && v.type === "doc";
const validDate = (v: unknown): v is string => typeof v === "string" && ISO_DATE.test(v) && !Number.isNaN(Date.parse(v));

const TITLE_FONT_IDS = ["display", "italic", "serif", "sans", "mono"];
const TITLE_SIZE_IDS = ["s", "m", "l", "xl"];
const TITLE_ALIGN_IDS = ["left", "center"];

/** A title's own look, cleaned up (null when there's nothing of its own left). */
export function normalizeTitleStyle(raw: unknown): TitleStyle | null {
  if (!isObj(raw)) return null;
  const out: TitleStyle = {};
  if (typeof raw.font === "string" && TITLE_FONT_IDS.includes(raw.font)) out.font = raw.font as TitleStyle["font"];
  if (typeof raw.size === "string" && TITLE_SIZE_IDS.includes(raw.size)) out.size = raw.size as TitleStyle["size"];
  if (typeof raw.align === "string" && TITLE_ALIGN_IDS.includes(raw.align)) out.align = raw.align as TitleStyle["align"];
  return Object.keys(out).length ? out : null;
}

export function normalizeNote(raw: unknown): Note | null {
  if (!isObj(raw) || typeof raw.id !== "string" || !ID.test(raw.id)) return null;
  return {
    id: raw.id,
    title: str(raw.title, 1000),
    doc: isDoc(raw.doc) ? raw.doc : null,
    text: str(raw.text),
    createdAt: num(raw.createdAt),
    updatedAt: num(raw.updatedAt),
    pinned: raw.pinned === true,
    deletedAt: typeof raw.deletedAt === "number" ? raw.deletedAt : null,
    groupId: typeof raw.groupId === "string" && ID.test(raw.groupId) ? raw.groupId : null,
    hidden: raw.hidden === true,
    ...withTitleStyle(raw.titleStyle),
  };
}

/** `{ titleStyle }` when there is one (so a note without stays without the key). */
function withTitleStyle(raw: unknown): { titleStyle?: TitleStyle } {
  const ts = normalizeTitleStyle(raw);
  return ts ? { titleStyle: ts } : {};
}

export const TODO_COLORS: TodoColor[] = ["red", "orange", "yellow", "green", "blue", "purple"];
const isTodoColor = (v: unknown): v is TodoColor => typeof v === "string" && (TODO_COLORS as string[]).includes(v);

export function normalizeGroup(raw: unknown): NoteGroup | null {
  if (!isObj(raw) || typeof raw.id !== "string" || !ID.test(raw.id)) return null;
  return {
    id: raw.id,
    name: str(raw.name, 60).trim() || "Untitled group",
    collapsed: raw.collapsed === true,
    createdAt: num(raw.createdAt),
    updatedAt: num(raw.updatedAt),
  };
}

export function normalizeVault(raw: unknown): Vault | null {
  if (!isObj(raw) || raw.v !== 1) return null;
  const b64 = /^[A-Za-z0-9_-]{16,128}$/;
  if (typeof raw.salt !== "string" || !b64.test(raw.salt) || typeof raw.hash !== "string" || !b64.test(raw.hash)) return null;
  const iter = typeof raw.iter === "number" && Number.isInteger(raw.iter) && raw.iter >= 10_000 && raw.iter <= 5_000_000 ? raw.iter : null;
  if (!iter) return null;
  return { v: 1, salt: raw.salt, hash: raw.hash, iter, updatedAt: num(raw.updatedAt) };
}

/** Your names for the to-do colors, cleaned up. */
export function normalizeTodoLabels(raw: unknown): Partial<Record<TodoColor, string>> {
  const out: Partial<Record<TodoColor, string>> = {};
  if (!isObj(raw)) return out;
  for (const c of TODO_COLORS) if (typeof raw[c] === "string" && (raw[c] as string).trim()) out[c] = (raw[c] as string).trim().slice(0, 32);
  return out;
}

export function normalizeTodo(raw: unknown): Todo | null {
  if (!isObj(raw) || typeof raw.id !== "string" || !ID.test(raw.id)) return null;
  return {
    id: raw.id,
    text: str(raw.text, 2000),
    done: raw.done === true,
    createdAt: num(raw.createdAt),
    updatedAt: num(raw.updatedAt),
    doneAt: typeof raw.doneAt === "number" ? raw.doneAt : null,
    color: isTodoColor(raw.color) ? raw.color : null,
  };
}

export function normalizeCountdown(raw: unknown): Countdown | null {
  if (!isObj(raw) || typeof raw.id !== "string" || !ID.test(raw.id) || !validDate(raw.date)) return null;
  return {
    id: raw.id,
    title: str(raw.title, 200) || "Untitled",
    date: raw.date,
    time: typeof raw.time === "string" && HH_MM.test(raw.time) ? raw.time : null,
    repeat: raw.repeat === "yearly" ? "yearly" : null,
    createdAt: num(raw.createdAt),
    updatedAt: num(raw.updatedAt),
  };
}

export function normalizeShareRecord(raw: unknown): ShareRecord | null {
  if (!isObj(raw)) return null;
  const { anchor, id, token, key } = raw;
  if (typeof anchor !== "string" || typeof id !== "string" || typeof token !== "string" || typeof key !== "string") return null;
  return {
    anchor,
    id,
    token,
    key,
    includeTodos: raw.includeTodos === true,
    includeCountdowns: raw.includeCountdowns === true,
    createdAt: num(raw.createdAt),
    pushedAt: num(raw.pushedAt),
    hash: typeof raw.hash === "string" ? raw.hash : undefined,
    rev: typeof raw.rev === "number" ? raw.rev : undefined,
    collab: raw.collab === true ? true : undefined,
    editable: raw.editable === false ? false : undefined,
    restricted: raw.restricted === true ? true : undefined,
  };
}

export function normalizeSharedLink(raw: unknown): SharedLink | null {
  if (!isObj(raw) || typeof raw.id !== "string" || !/^[A-Za-z0-9]{8,32}$/.test(raw.id) || typeof raw.key !== "string" || !/^[A-Za-z0-9_-]{16,64}$/.test(raw.key)) return null;
  return {
    id: raw.id,
    key: raw.key,
    title: str(raw.title, 300),
    from: str(raw.from, 60),
    role: raw.role === "edit" || raw.role === "view" ? raw.role : null,
    addedAt: num(raw.addedAt),
    openedAt: num(raw.openedAt),
  };
}

export const normalizeList = <T>(raw: unknown, fn: (v: unknown) => T | null): T[] =>
  Array.isArray(raw) ? raw.map(fn).filter((v): v is T => v !== null) : [];

/** Shape-checks a decrypted share. Returns null if there's nothing usable in it. */
export function sanitizePayload(raw: unknown): SharePayload | null {
  if (!isObj(raw)) return null;
  const out: SharePayload = { v: 1, sharedAt: num(raw.sharedAt) };
  if (typeof raw.from === "string" && raw.from.trim()) out.from = raw.from.trim().slice(0, 60);

  if (isObj(raw.note)) {
    const n = raw.note;
    out.note = { title: str(n.title, 1000), doc: isDoc(n.doc) ? n.doc : null, text: str(n.text), updatedAt: num(n.updatedAt), ...withTitleStyle(n.titleStyle) };
    if (n.collab === true) out.note.collab = true;
  }
  if (Array.isArray(raw.todos)) {
    out.todos = raw.todos
      .filter(isObj)
      .map((t) => ({ text: str(t.text, 2000), done: t.done === true }))
      .filter((t) => t.text.trim())
      .slice(0, 2000);
  }
  if (Array.isArray(raw.countdowns)) {
    out.countdowns = raw.countdowns
      .filter(isObj)
      .filter((c) => validDate(c.date))
      .map((c) => ({
        title: str(c.title, 200) || "Untitled",
        date: c.date as string,
        time: typeof c.time === "string" && HH_MM.test(c.time) ? c.time : null,
        repeat: c.repeat === "yearly" ? ("yearly" as const) : null,
        createdAt: num(c.createdAt),
      }))
      .slice(0, 500);
  }
  return out.note || out.todos?.length || out.countdowns?.length ? out : null;
}
