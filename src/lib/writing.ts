import { create } from "zustand";
import type { Node as PMNode } from "@tiptap/pm/model";
import type { Transaction } from "@tiptap/pm/state";
import { uid } from "./id";
import { wordCount } from "./text";

/**
 * Writing stats: the words you write each day, the streak of days in a row you've written, and a
 * daily goal to fill a ring towards.
 *
 * Words are counted as you write in a note, at each pause in your typing (so a word typed and
 * then fixed counts once): what you add, less what you take away — each note's own sum for the
 * day never going below nothing, so tidying an old note never costs you today's words. Never
 * counted: what you paste or drop in, an undo or redo, or a friend's edits arriving in a live
 * note. Opening, importing or syncing a note doesn't count either: only your typing does.
 *
 * Each device keeps its own tally, so two never overwrite each other's; signed in, they meet in
 * your account (one record each — see account/sync.ts), and a day's words are all of them
 * added up.
 */

const KEY = "umbra:writing";
const DEVICE_KEY = "umbra:device";
/** How many days back are kept (enough for any streak worth having). */
const KEEP_DAYS = 400;

/** Local date, YYYY-MM-DD: a day as you live it, wherever you are. */
export function dayKey(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export type WritingState = {
  /** This device, as your account knows it. */
  device: string;
  /** Words written each day on this device (date → words). */
  days: Record<string, number>;
  /** Today's words, note by note (each note's own sum; days[today] adds up the ones above zero). */
  today: { date: string; notes: Record<string, number> };
  /** The account signed in here now (if any)… */
  account: string | null;
  /** …and your other devices' days in each account this device has known (account → device → date → words). */
  accounts: Record<string, Record<string, Record<string, number>>>;
};

/** Your other devices' days, in the account signed in now. */
export const othersOf = (s: WritingState): Record<string, Record<string, number>> => (s.account ? (s.accounts[s.account] ?? {}) : {});

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const DEVICE_RE = /^[A-Za-z0-9_-]{6,40}$/;

/** A day-by-day tally as it should be: real dates, whole words, nothing negative or absurd. */
export function cleanDays(v: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (!v || typeof v !== "object") return out;
  for (const [k, n] of Object.entries(v as Record<string, unknown>)) {
    if (DAY_RE.test(k) && typeof n === "number" && Number.isFinite(n) && n > 0) out[k] = Math.min(10_000_000, Math.round(n));
  }
  return out;
}

export const isDeviceId = (v: unknown): v is string => typeof v === "string" && DEVICE_RE.test(v);

function deviceId(): string {
  try {
    const known = localStorage.getItem(DEVICE_KEY);
    if (isDeviceId(known)) return known;
    const fresh = uid(16);
    localStorage.setItem(DEVICE_KEY, fresh);
    return fresh;
  } catch {
    return uid(16);
  }
}

function normalize(raw: unknown, device: string): WritingState {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const t = (r.today && typeof r.today === "object" ? r.today : {}) as Record<string, unknown>;
  const notes: Record<string, number> = {};
  if (t.notes && typeof t.notes === "object") {
    for (const [id, n] of Object.entries(t.notes as Record<string, unknown>)) if (typeof n === "number" && Number.isFinite(n)) notes[id] = Math.round(n);
  }
  const accounts: WritingState["accounts"] = {};
  if (r.accounts && typeof r.accounts === "object") {
    for (const [uid, devices] of Object.entries(r.accounts as Record<string, unknown>)) {
      if (!devices || typeof devices !== "object") continue;
      const known: Record<string, Record<string, number>> = {};
      for (const [id, days] of Object.entries(devices as Record<string, unknown>)) if (isDeviceId(id) && id !== device) known[id] = cleanDays(days);
      accounts[uid] = known;
    }
  }
  return {
    device,
    days: cleanDays(r.days),
    today: { date: typeof t.date === "string" && DAY_RE.test(t.date) ? t.date : dayKey(), notes },
    account: typeof r.account === "string" && r.account ? r.account : null,
    accounts,
  };
}

function load(): WritingState {
  const device = deviceId();
  try {
    return normalize(JSON.parse(localStorage.getItem(KEY) ?? "null"), device);
  } catch {
    return normalize(null, device);
  }
}

export const useWriting = create<WritingState>(() => load());

/** Changes the tally, starting from the freshest copy (another tab may have written since). */
function update(fn: (s: WritingState) => WritingState) {
  const next = fn(load());
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* full or blocked: it still counts for now */
  }
  useWriting.setState(next, true);
}

// (another tab wrote: catch up)
if (typeof window !== "undefined") {
  window.addEventListener("storage", (e) => {
    if (e.key === KEY) useWriting.setState(load(), true);
  });
}

function prune(days: Record<string, number>): Record<string, number> {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - KEEP_DAYS);
  const oldest = dayKey(cutoff);
  const out: Record<string, number> = {};
  for (const [k, n] of Object.entries(days)) if (k >= oldest) out[k] = n;
  return out;
}

/** Words you've just written (or taken away) in a note, on this device. */
export function recordWords(noteId: string, delta: number) {
  if (!delta || !Number.isFinite(delta)) return;
  const date = dayKey();
  update((s) => {
    const notes = s.today.date === date ? { ...s.today.notes } : {};
    notes[noteId] = (notes[noteId] ?? 0) + Math.round(delta);
    let total = 0;
    for (const n of Object.values(notes)) total += Math.max(0, n);
    const days = { ...s.days };
    if (total > 0) days[date] = total;
    else delete days[date];
    return { ...s, today: { date, notes }, days: prune(days) };
  });
}

/** Who's signed in here now (null: nobody): their other devices' days are the ones that count. */
export function setWritingAccount(uid: string | null) {
  if (useWriting.getState().account === uid) return;
  update((s) => ({ ...s, account: uid }));
}

/** One of your other devices' days, as your account has them (null: that device's record is gone). */
export function absorbDevice(device: string, days: Record<string, number> | null) {
  const s0 = useWriting.getState();
  if (!s0.account || device === s0.device) return;
  update((s) => {
    if (!s.account || device === s.device) return s;
    const devices = { ...(s.accounts[s.account] ?? {}) };
    if (days && Object.keys(days).length) devices[device] = prune(days);
    else delete devices[device];
    return { ...s, accounts: { ...s.accounts, [s.account]: devices } };
  });
}

/** All the words written on a day, on every device. */
export function wordsOn(s: WritingState, date: string): number {
  let n = s.days[date] ?? 0;
  for (const d of Object.values(othersOf(s))) n += d[date] ?? 0;
  return n;
}

/** Whether two day-by-day tallies say the same. */
export function sameDays(a: Record<string, number>, b: Record<string, number>): boolean {
  if (a === b) return true;
  const ka = Object.keys(a);
  if (ka.length !== Object.keys(b).length) return false;
  for (const k of ka) if (a[k] !== b[k]) return false;
  return true;
}

/** A day at noon (so stepping back a day never trips over a clock change). */
const noon = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 12);

/**
 * Days in a row you've written, up to today. Today joins in once you've written something; until
 * then the run up to yesterday still stands (it's only broken once a whole day goes by).
 */
export function streakOf(s: WritingState, now = new Date()): number {
  const d = noon(now);
  if (wordsOn(s, dayKey(d)) <= 0) d.setDate(d.getDate() - 1);
  let n = 0;
  while (n < KEEP_DAYS && wordsOn(s, dayKey(d)) > 0) {
    n++;
    d.setDate(d.getDate() - 1);
  }
  return n;
}

/** The last `count` days, oldest first, with their words (for the week's little bars). */
export function lastDays(s: WritingState, count: number, now = new Date()): { date: Date; key: string; words: number }[] {
  const out: { date: Date; key: string; words: number }[] = [];
  const d = noon(now);
  d.setDate(d.getDate() - (count - 1));
  for (let i = 0; i < count; i++) {
    const key = dayKey(d);
    out.push({ date: new Date(d), key, words: wordsOn(s, key) });
    d.setDate(d.getDate() + 1);
  }
  return out;
}

// ── counting what you write in the editor ─────────────────────────────────

const docWords = (doc: PMNode) => wordCount(doc.textBetween(0, doc.content.size, "\n", " "));

/**
 * Whether a change in the editor is your own writing: not pasted or dropped in, not an undo or
 * redo, and not a friend's edit (or the first copy of the doc) arriving in a live note.
 */
export function writtenByYou(tr: Transaction): boolean {
  if (tr.getMeta("paste") || tr.getMeta("uiEvent") === "paste" || tr.getMeta("uiEvent") === "drop") return false;
  if (tr.getMeta("history$")) return false;
  const sync = tr.getMeta("y-sync$") as { isChangeOrigin?: boolean } | undefined;
  return !(sync && sync.isChangeOrigin);
}

/**
 * Counts the words you write in one note's editor: at each pause in your typing, what you've
 * added less what you've taken away goes to the day's tally. Anything else that changes the note
 * (a paste, an undo, a friend's edit) just moves the starting point, so it's never counted.
 */
export class WordTally {
  private base: number | null = null;
  private latest: PMNode | null = null;
  private timer = 0;

  constructor(private noteId: string) {}

  /** A change in the editor (`doc`: the document now, after anything plugins added). */
  change(tr: Transaction, doc: PMNode) {
    if (!tr.docChanged) return;
    if (!writtenByYou(tr)) {
      // what you'd written up to here counts; then carry on from whatever's there now
      if (this.latest) this.settle(tr.before);
      this.base = null;
      return;
    }
    if (this.base === null) this.base = docWords(tr.before);
    this.latest = doc;
    window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => this.flush(), 1500);
  }

  /** Counts what's waiting now (you've stopped, or the note is closing). */
  flush() {
    window.clearTimeout(this.timer);
    if (this.latest) this.settle(this.latest);
  }

  private settle(doc: PMNode) {
    this.latest = null;
    if (this.base === null) return;
    const words = docWords(doc);
    const delta = words - this.base;
    this.base = words;
    if (delta) recordWords(this.noteId, delta);
  }
}
