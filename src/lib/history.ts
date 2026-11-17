import { createStore, delMany, get as idbGet, getMany, keys as idbKeys, set as idbSet, setMany } from "idb-keyval";
import type { JSONContent } from "@tiptap/core";
import { prosemirrorJSONToYXmlFragment } from "@tiptap/y-tiptap";
import { useApp } from "../store/app";
import { isApplyingRemote } from "../store/persist";
import { getCollabSession } from "../collab/manager";
import { BODY, TITLE } from "../collab/fields";
import { editorSchema, safeDoc } from "../components/editor/safeDoc";
import { uid } from "./id";
import { docToText, wordCount } from "./text";
import { dayKey } from "./writing";
import type { Note } from "./types";

/**
 * Version history: earlier versions of every note, kept on this device.
 *
 * A version is kept:
 *  - when you pause (45 seconds after your last change — but no more than one every couple of
 *    minutes), and every 10 minutes while you keep writing;
 *  - when you leave the note (open another one, close the tab, put the phone down);
 *  - right before anything big: deleting a good part of the note at once, restoring a version,
 *    or a change arriving from another device — so whatever was there is always one step back;
 *  - when you ask ("Save this version"), with a name if you like.
 * The note as it was before a run of changes starts is always kept too, so the first change to
 * a note you haven't touched since this arrived can still be undone.
 *
 * Old versions thin out: everything from the last day, then one an hour for a week, one a day
 * for a month, one a week for a year (keeping a fuller one too, where the last one in its hour
 * or day lost a lot). Named versions are kept for good. A note's history goes when the note does
 * (emptied from the trash).
 *
 * It's all in this browser's own storage (IndexedDB): no requests, nothing on the server.
 * Changes your other devices make arrive here through sync, and are kept as versions too.
 */

const db = createStore("umbra-history", "versions");
/** The notes themselves (to check one is really gone before forgetting its history). */
const notesDb = createStore("umbra", "kv");

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** A pause this long (after your last change) keeps a version… */
const IDLE = 45 * SECOND;
/** …but routine versions are no closer together than this… */
const MIN_GAP = 2 * MINUTE;
/** …and one is kept at least this often while you keep writing. */
const MAX_RUN = 10 * MINUTE;
/** A change that takes away this many words at once (and a good part of the note) keeps the note as it was, first. */
const BIG_DELETE = 25;
const MAX_VERSIONS = 400;
const MAX_BYTES = 8 * 1024 * 1024;

/** Where a version came from. */
export type VersionSource =
  /** your writing (or yours and a friend's, in a live note) */
  | "edit"
  /** arrived from another device */
  | "sync"
  /** a version you restored */
  | "restore"
  /** the note as it was right before something big */
  | "before"
  /** you saved it yourself */
  | "saved";

export type VersionMeta = {
  id: string;
  /** When it was kept (ms). */
  at: number;
  title: string;
  words: number;
  /** A fingerprint of its words and formatting (to tell versions apart). */
  hash: string;
  source: VersionSource;
  /** For a "before" version: what came next. */
  why?: "deletion" | "restore" | "sync";
  /** For a "restore": when the version it brought back was from. */
  from?: number;
  /** A name you gave it: it's kept for good. */
  name?: string;
  /** About how much room it takes (bytes). */
  size: number;
};

export type VersionContent = { title: string; doc: JSONContent | null; text: string };

type Index = { v: 1; versions: VersionMeta[] }; // oldest first
type Packed = { z: Uint8Array } | { j: string };

const ik = (noteId: string) => `i:${noteId}`;
const ck = (noteId: string, id: string) => `c:${noteId}:${id}`;

// ── storage ───────────────────────────────────────────────────────────────

/** Squeezes a version for storage (gzip, where the browser can; most notes shrink 5–10×). */
async function pack(value: VersionContent): Promise<Packed> {
  const json = JSON.stringify(value);
  if (json.length > 1500 && typeof CompressionStream === "function") {
    try {
      const stream = new Blob([json]).stream().pipeThrough(new CompressionStream("gzip"));
      return { z: new Uint8Array(await new Response(stream).arrayBuffer()) };
    } catch {
      /* fall through: kept as it is */
    }
  }
  return { j: json };
}

async function unpack(p: Packed | undefined): Promise<VersionContent | null> {
  if (!p) return null;
  try {
    let json: string;
    if ("z" in p) {
      const stream = new Blob([p.z as Uint8Array<ArrayBuffer>]).stream().pipeThrough(new DecompressionStream("gzip"));
      json = await new Response(stream).text();
    } else json = p.j;
    const v = JSON.parse(json) as Partial<VersionContent>;
    return { title: typeof v.title === "string" ? v.title : "", doc: v.doc && typeof v.doc === "object" ? v.doc : null, text: typeof v.text === "string" ? v.text : "" };
  } catch {
    return null;
  }
}

const sizeOf = (p: Packed) => ("z" in p ? p.z.byteLength : p.j.length * 2);

/** A quick fingerprint of a version's words and formatting (two 32-bit hashes). */
function fingerprint(s: string): string {
  let a = 0x811c9dc5;
  let b = 0x9747b28c ^ s.length;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    a = Math.imul(a ^ c, 0x01000193);
    b = Math.imul(b ^ c, 0x5bd1e995);
    b ^= b >>> 15;
  }
  return (a >>> 0).toString(36) + "-" + (b >>> 0).toString(36);
}

/**
 * A version's words and formatting, written out the same way however its fields happen to be
 * ordered (and leaving out empty ones) — so the same note, saved by a different editor or device,
 * is recognised as the same.
 */
function canonical(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v) ?? "null";
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  const o = v as Record<string, unknown>;
  const parts: string[] = [];
  for (const k of Object.keys(o).sort()) {
    const x = o[k];
    if (x === null || x === undefined) continue;
    const c = canonical(x);
    if (c === "{}" || c === "[]") continue;
    parts.push(`${JSON.stringify(k)}:${c}`);
  }
  return `{${parts.join(",")}}`;
}

/** A note without the empty paragraphs at its end (the editor keeps one there to type into). */
function trimmed(doc: JSONContent): JSONContent {
  const content = Array.isArray(doc.content) ? doc.content : [];
  let end = content.length;
  while (end > 0 && content[end - 1]?.type === "paragraph" && !content[end - 1]?.content?.length) end--;
  return end === content.length ? doc : { ...doc, content: content.slice(0, end) };
}

const hashOf = (c: VersionContent) => fingerprint(canonical([c.title, c.doc ? trimmed(c.doc) : c.text]));
const wordsOf = (c: { title: string; text: string }) => wordCount(`${c.title} ${c.text}`);
const contentOf = (n: Note): VersionContent => ({ title: n.title, doc: n.doc, text: n.text });
const blank = (c: { title: string; text: string }) => !c.title.trim() && !c.text.trim();

/** One write at a time (and across tabs, where the browser can), so versions never trip over each other. */
let chain: Promise<unknown> = Promise.resolve();
function serial<T>(fn: () => Promise<T>): Promise<T> {
  const locks = (navigator as Navigator & { locks?: { request: <R>(name: string, cb: () => Promise<R>) => Promise<R> } }).locks;
  const run = (): Promise<T> => (locks?.request ? locks.request<T>("umbra-history", fn) : fn());
  const next: Promise<T> = chain.then(run, run);
  chain = next.catch(() => {});
  return next;
}

async function readIndex(noteId: string): Promise<Index> {
  const raw = await idbGet<Index>(ik(noteId), db).catch(() => undefined);
  return raw && raw.v === 1 && Array.isArray(raw.versions) ? raw : { v: 1, versions: [] };
}

// ── who's listening (the history view) ────────────────────────────────────

const listeners = new Map<string, Set<() => void>>();
const emit = (noteId: string) => listeners.get(noteId)?.forEach((fn) => fn());

/** Hears whenever a note's history changes. */
export function onHistory(noteId: string, fn: () => void): () => void {
  let set = listeners.get(noteId);
  if (!set) listeners.set(noteId, (set = new Set()));
  set.add(fn);
  return () => {
    set.delete(fn);
    if (!set.size) listeners.delete(noteId);
  };
}

// ── thinning ──────────────────────────────────────────────────────────────

/** The Monday of a date's week (local), as a key. */
function weekKey(d: Date): string {
  const m = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 12);
  m.setDate(m.getDate() - ((m.getDay() + 6) % 7));
  return dayKey(m);
}

/**
 * What to keep: named versions and the newest always; everything from the last day; then one an
 * hour for a week, one a day for a month, one a week for a year — the last in each, plus a fuller
 * one where the last lost a lot (so what a big deletion took away is still there to bring back).
 */
export function thin(versions: VersionMeta[], now = Date.now()): { keep: VersionMeta[]; drop: VersionMeta[] } {
  const keep = new Set<string>();
  const newest = versions[versions.length - 1];
  if (newest) keep.add(newest.id);
  const buckets = new Map<string, VersionMeta[]>();
  for (const v of versions) {
    const age = now - v.at;
    if (v.name || age < DAY) {
      keep.add(v.id);
      continue;
    }
    if (age > 365 * DAY) continue;
    const key = age < 7 * DAY ? `h${Math.floor(v.at / HOUR)}` : age < 30 * DAY ? `d${dayKey(new Date(v.at))}` : `w${weekKey(new Date(v.at))}`;
    const group = buckets.get(key);
    if (group) group.push(v);
    else buckets.set(key, [v]);
  }
  for (const group of buckets.values()) {
    let last = group[0];
    let fullest = group[0];
    for (const v of group) {
      if (v.at > last.at) last = v;
      if (v.words > fullest.words) fullest = v;
    }
    keep.add(last.id);
    if (fullest !== last && fullest.words >= last.words * 1.2 + 10) keep.add(fullest.id);
  }
  let kept = versions.filter((v) => keep.has(v.id));
  // (and never more than so many, or so much room: the oldest unnamed go first)
  let bytes = kept.reduce((n, v) => n + (v.size || 0), 0);
  while (kept.length > MAX_VERSIONS || bytes > MAX_BYTES) {
    const i = kept.findIndex((v) => !v.name && v !== newest);
    if (i < 0) break;
    bytes -= kept[i].size || 0;
    kept = [...kept.slice(0, i), ...kept.slice(i + 1)];
  }
  const still = new Set(kept.map((v) => v.id));
  return { keep: kept, drop: versions.filter((v) => !still.has(v.id)) };
}

// ── keeping a version ─────────────────────────────────────────────────────

type KeepOpts = { source: VersionSource; why?: VersionMeta["why"]; from?: number; name?: string };

/**
 * Keeps a version of a note (unless it's just like the newest one already kept). Returns the
 * version that now matches it.
 */
async function keepVersion(noteId: string, content: VersionContent, opts: KeepOpts): Promise<VersionMeta | null> {
  return serial(async () => {
    const hash = hashOf(content);
    const index = await readIndex(noteId);
    const newest = index.versions[index.versions.length - 1];
    if (newest && newest.hash === hash) {
      // nothing new — though a name given now is kept with it, and so is a note of what came
      // next (so "before deleting…" is there to find)
      const named = Boolean(opts.name && newest.name !== opts.name);
      const noted = Boolean(opts.why && !newest.why);
      if (named) newest.name = opts.name;
      if (noted) newest.why = opts.why;
      if (named || noted) {
        await idbSet(ik(noteId), index, db).catch(() => {});
        emit(noteId);
      }
      return newest;
    }
    const packed = await pack(content);
    const meta: VersionMeta = {
      id: uid(10),
      at: Math.max(Date.now(), (newest?.at ?? 0) + 1),
      title: content.title,
      words: wordsOf(content),
      hash,
      source: opts.source,
      ...(opts.why ? { why: opts.why } : {}),
      ...(opts.from ? { from: opts.from } : {}),
      ...(opts.name ? { name: opts.name } : {}),
      size: sizeOf(packed),
    };
    const { keep, drop } = thin([...index.versions, meta]);
    try {
      await setMany(
        [
          [ck(noteId, meta.id), packed],
          [ik(noteId), { v: 1, versions: keep } satisfies Index],
        ],
        db,
      );
      if (drop.length) await delMany(drop.map((v) => ck(noteId, v.id)), db);
    } catch (err) {
      console.warn("Couldn't keep a version", err);
      return null;
    }
    emit(noteId);
    return meta;
  });
}

// ── watching the notes ────────────────────────────────────────────────────

/** What the change being made right now is (set around changes that aren't your writing). */
let source: VersionSource = "edit";

/** Makes a change to the notes as `src` (e.g. a sync from another device), for the history. */
export function asSource<T>(src: VersionSource, fn: () => T): T {
  const was = source;
  source = src;
  try {
    return fn();
  } finally {
    source = was;
  }
}

/** A run of changes to a note not yet kept as a version. */
type Run = { latest: VersionContent; since: number; last: number; timer: number };
const runs = new Map<string, Run>();
/** When a routine version of each note was last kept (this session). */
const lastKept = new Map<string, number>();

function schedule(noteId: string) {
  const run = runs.get(noteId);
  if (!run) return;
  window.clearTimeout(run.timer);
  const at = Math.max(Math.min(run.last + IDLE, run.since + MAX_RUN), (lastKept.get(noteId) ?? 0) + MIN_GAP);
  run.timer = window.setTimeout(() => void settle(noteId), Math.max(0, at - Date.now()));
}

/** Keeps the note's unkept changes as a version now (you've paused, left it, or something's coming). */
function settle(noteId: string): Promise<VersionMeta | null> {
  const run = runs.get(noteId);
  if (!run) return Promise.resolve(null);
  window.clearTimeout(run.timer);
  runs.delete(noteId);
  lastKept.set(noteId, Date.now());
  return keepVersion(noteId, run.latest, { source: "edit" });
}

/** Keeps every note's unkept changes now (the page is going away). */
export function settleAll() {
  for (const id of [...runs.keys()]) void settle(id);
}

function changed(noteId: string, prev: Note, next: Note, src: VersionSource) {
  const before = contentOf(prev);
  const after = contentOf(next);
  const removed = wordsOf(before) - wordsOf(after);
  const big = removed >= BIG_DELETE && removed >= wordsOf(before) * 0.2;
  const run = runs.get(noteId);

  // A version being brought back keeps its own versions (see restoreVersion).
  if (src === "restore") {
    if (run) {
      window.clearTimeout(run.timer);
      runs.delete(noteId);
    }
    return;
  }

  // Something's arrived from another device: keep what was here (if it isn't already), then what came.
  if (src === "sync") {
    if (run) {
      window.clearTimeout(run.timer);
      runs.delete(noteId);
    }
    if (!blank(before)) void keepVersion(noteId, before, { source: "edit" });
    void keepVersion(noteId, after, { source: "sync" });
    lastKept.set(noteId, Date.now());
    return;
  }

  // A run of changes is starting (the note as it was is kept, if it isn't already) — or something
  // big is happening to it (the note as it was, kept as the step back).
  if (!run || big) {
    if (!blank(before)) void keepVersion(noteId, before, big ? { source: "before", why: "deletion" } : { source: "edit" });
  }
  const now = Date.now();
  if (run) {
    run.latest = after;
    run.last = now;
  } else runs.set(noteId, { latest: after, since: now, last: now, timer: 0 });
  schedule(noteId);
}

/** Notes gone from the store: their history goes too (once they're really gone, a moment later). */
function forgetSoon(noteId: string) {
  const run = runs.get(noteId);
  if (run) {
    window.clearTimeout(run.timer);
    runs.delete(noteId);
  }
  window.setTimeout(() => {
    if (useApp.getState().notes[noteId]) return;
    void forgetIfGone([noteId]);
  }, 10_000);
}

async function forgetIfGone(noteIds: string[]) {
  if (!noteIds.length) return;
  // (only once the note is gone from storage too — another tab may still have it)
  const saved = await getMany(noteIds.map((id) => `note:${id}`), notesDb).catch(() => null);
  if (!saved) return;
  const gone = noteIds.filter((id, i) => !saved[i] && !useApp.getState().notes[id]);
  if (!gone.length) return;
  await serial(async () => {
    const all = await idbKeys(db).catch(() => [] as IDBValidKey[]);
    const doomed = all.map(String).filter((k) => gone.some((id) => k === ik(id) || k.startsWith(`c:${id}:`)));
    if (doomed.length) await delMany(doomed, db).catch(() => {});
  });
  for (const id of gone) emit(id);
}

/** Starts keeping versions as you write (call once, after the notes have loaded). */
export function startHistory() {
  useApp.subscribe((s, prev) => {
    if (!s.ready || !prev.ready) return;
    if (s.notes !== prev.notes && !isApplyingRemote()) {
      // (a change another tab made: that tab keeps its history)
      for (const id in s.notes) {
        const n = s.notes[id];
        const p = prev.notes[id];
        if (!p || n === p) continue;
        if (n.title === p.title && n.doc === p.doc && n.text === p.text) continue; // pinned, moved, trashed…
        changed(id, p, n, source);
      }
      for (const id in prev.notes) if (!s.notes[id]) forgetSoon(id);
    }
    // leaving a note: what you'd written in it is kept now — a moment later, once the editor
    // that's closing has handed over its last few words
    if (s.ui.activeId !== prev.ui.activeId && prev.ui.activeId) {
      const left = prev.ui.activeId;
      window.setTimeout(() => void settle(left), 80);
    }
  });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") settleAll();
  });
  window.addEventListener("pagehide", settleAll);
  // Now and then: forget the history of notes that are gone for good (emptied from the trash,
  // deleted on another device).
  window.setTimeout(() => void sweep(), 90_000);
}

async function sweep() {
  const all = await idbKeys(db).catch(() => [] as IDBValidKey[]);
  const ids = new Set<string>();
  for (const k of all.map(String)) if (k.startsWith("i:")) ids.add(k.slice(2));
  const notes = useApp.getState().notes;
  await forgetIfGone([...ids].filter((id) => !notes[id]));
}

// ── for the history view ──────────────────────────────────────────────────

/** A note's versions, newest first (once anything being kept has been). */
export async function listVersions(noteId: string): Promise<VersionMeta[]> {
  return serial(async () => [...(await readIndex(noteId)).versions].reverse());
}

/** A fingerprint of some words and formatting, to tell whether a version is the note as it is. */
export const versionHash = (c: VersionContent) => hashOf(c);

/** Keeps a note's latest changes as a version now (the history's being opened). */
export function settleNote(noteId: string): Promise<VersionMeta | null> {
  return settle(noteId);
}

const cache = new Map<string, VersionContent>();

/** One version's words and formatting. */
export async function loadVersion(noteId: string, versionId: string): Promise<VersionContent | null> {
  const key = ck(noteId, versionId);
  const hit = cache.get(key);
  if (hit) return hit;
  const content = await unpack(await idbGet<Packed>(key, db).catch(() => undefined));
  if (content) {
    cache.set(key, content);
    if (cache.size > 40) cache.delete(cache.keys().next().value as string);
  }
  return content;
}

/** The note as it is right now (anything still being typed included). */
function current(noteId: string): VersionContent | null {
  window.dispatchEvent(new Event("umbra:flush-editor"));
  const n = useApp.getState().notes[noteId];
  return n ? contentOf(n) : null;
}

/** Keeps the note as it is now, as a version (with a name, if given — then it's kept for good). */
export async function saveVersionNow(noteId: string, name?: string): Promise<VersionMeta | null> {
  const now = current(noteId);
  if (!now) return null;
  const run = runs.get(noteId);
  if (run) {
    window.clearTimeout(run.timer);
    runs.delete(noteId);
  }
  return keepVersion(noteId, now, { source: "saved", ...(name?.trim() ? { name: name.trim().slice(0, 60) } : {}) });
}

/** Names a version (kept for good) — or, with an empty name, lets it thin out like the rest. */
export async function nameVersion(noteId: string, versionId: string, name: string) {
  const clean = name.trim().slice(0, 60);
  await serial(async () => {
    const index = await readIndex(noteId);
    const v = index.versions.find((x) => x.id === versionId);
    if (!v) return;
    if (clean) v.name = clean;
    else delete v.name;
    await idbSet(ik(noteId), index, db).catch(() => {});
  });
  emit(noteId);
}

/** Restore events: the open editor shows the restored words (without counting them as written). */
export const NOTE_RELOAD_EVENT = "umbra:note-reload";

/** Puts a version's words into the note — everyone's copy of it, if it's shared live. */
function apply(noteId: string, content: VersionContent, from: number) {
  const session = getCollabSession(noteId);
  if (session) {
    // (a live note's words live in the shared doc: change them there, and everyone sees it)
    const json = safeDoc(content.doc, content.text) ?? { type: "doc", content: [{ type: "paragraph" }] };
    session.doc.transact(() => {
      prosemirrorJSONToYXmlFragment(editorSchema(), json, session.doc.getXmlFragment(BODY));
      const t = session.doc.getText(TITLE);
      if (t.toString() !== content.title) {
        t.delete(0, t.length);
        t.insert(0, content.title);
      }
    });
  }
  asSource("restore", () => useApp.getState().updateNote(noteId, { title: content.title, doc: content.doc, text: content.text || docToText(content.doc) }));
  lastKept.set(noteId, Date.now());
  window.dispatchEvent(new CustomEvent(NOTE_RELOAD_EVENT, { detail: noteId }));
  // (the restore's own version, with when it was from)
  void keepVersion(noteId, content, { source: "restore", from });
}

/**
 * Brings a version back. The note as it was is kept first (that's what Undo goes back to), and
 * it's returned.
 */
export async function restoreVersion(noteId: string, versionId: string): Promise<VersionMeta | null> {
  const [content, index] = await Promise.all([loadVersion(noteId, versionId), readIndex(noteId)]);
  const meta = index.versions.find((v) => v.id === versionId);
  const now = current(noteId);
  if (!content || !meta || !now) return null;
  const run = runs.get(noteId);
  if (run) {
    window.clearTimeout(run.timer);
    runs.delete(noteId);
  }
  const before = blank(now) ? null : await keepVersion(noteId, now, { source: "before", why: "restore" });
  apply(noteId, content, meta.at);
  return before;
}
