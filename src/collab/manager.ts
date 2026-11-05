import * as Y from "yjs";
import { createStore, del as idbDel, get as idbGet, set as idbSet } from "idb-keyval";
import { useSyncExternalStore } from "react";
import { useApp } from "../store/app";
import { onAccountChange, useAccount } from "../account/account";
import { BOARD, verifyShare } from "../store/shareSync";
import { toast } from "../store/toasts";
import { ApiError, initDoc, setDocEditable } from "../lib/api";
import { sealBytes, sha256B64, writeTokenFor } from "../lib/crypto";
import { ACCENTS } from "../lib/theme";
import { oklchToRgb, to255 } from "../fx/color";
import type { Settings, ShareRecord } from "../lib/types";
import { CollabSession, encodeFrame, type CollabUser } from "./session";
import { fillDoc, readDoc } from "./convert";

/**
 * The owner's side of live co-editing: one session per shared note, running in the
 * background while the app is open, with a local copy of each live doc so edits
 * survive reloads and offline spells. Anything your friend writes lands in the note
 * itself (title, body, search, exports) a moment later.
 */

const ydb = createStore("umbra-collab", "docs");
type Saved = { v: 1; shareId: string; state: Uint8Array; seq: number; pending: Uint8Array | null };

const sessions = new Map<string, CollabSession>();
const starting = new Set<string>();
const prepared = new Map<string, { shareId: string; doc: Y.Doc; seq: number }>();
const retryAt = new Map<string, number>();
const syncTimers = new Map<string, number>();
/** Notes whose link was just made or copied: until when to look out for visitors. */
const expecting = new Map<string, number>();
/** Waiting-to-be-let-in counts, as each note's session last heard them (see watch()). */
const pendingSeen = new Map<string, number>();
const subs = new Set<() => void>();
let started = false;

const emit = () => subs.forEach((fn) => fn());
/** Fired (with the note's id) when a live note hears of someone new waiting to be let in. */
export const PENDING_EVENT = "umbra:pending";
const savedKey = (anchor: string) => `ydoc:${anchor}`;

/**
 * You, as others see you: your username and your accent colour (as hex, which the caret plugin
 * needs), and your profile picture if you've set one. Not signed in: the owner is "Owner"; anyone
 * else is a guest, in a colour of their own (see session.ts).
 */
export function userFor(settings: Pick<Settings, "accent" | "avatar">, as: "owner" | "guest" = "owner"): CollabUser {
  const rgb = to255(oklchToRgb((ACCENTS[settings.accent] ?? ACCENTS.iris).color));
  const hex = `#${rgb.map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, "0")).join("")}`;
  const user = useAccount.getState().user;
  if (!user) return as === "guest" ? { name: "Guest", color: hex, guest: true } : { name: "Owner", color: hex };
  const pic = settings.avatar?.uid === user.uid ? settings.avatar : null;
  return { name: user.username.slice(0, 40), color: hex, avatar: pic ? { id: pic.id, key: pic.key, type: pic.type } : null };
}

/** Someone's likely to open this note's link soon (you just made or copied it): look out for them a little more often. */
export function expectVisitors(anchor: string) {
  expecting.set(anchor, Date.now() + 180_000);
  sessions.get(anchor)?.expect();
}

/** The live session for a note, if it's shared for co-editing. */
export function useCollabSession(noteId: string | null): CollabSession | null {
  return useSyncExternalStore(
    (fn) => {
      subs.add(fn);
      return () => subs.delete(fn);
    },
    () => (noteId ? (sessions.get(noteId) ?? null) : null),
  );
}

export function getCollabSession(noteId: string) {
  return sessions.get(noteId) ?? null;
}

/** Let friends edit — or make the link view-only again. */
export async function setEditable(anchor: string, editable: boolean) {
  const record = useApp.getState().shares[anchor];
  if (!record) return;
  const before = record.editable !== false;
  useApp.getState().patchShare(anchor, { editable });
  if (!record.collab) return; // applied when the live doc is created
  try {
    await setDocEditable(record.id, record.token, editable);
  } catch {
    if (useApp.getState().shares[anchor]?.id === record.id) useApp.getState().patchShare(anchor, { editable: before });
    toast("Couldn't reach the server — try again", { tone: "error" });
  }
}

export function startCollab() {
  if (started) return;
  started = true;
  sync();
  useApp.subscribe((s, prev) => {
    if (s.shares !== prev.shares || s.ready !== prev.ready) sync();
    if (s.settings.accent !== prev.settings.accent || s.settings.avatar !== prev.settings.avatar) {
      for (const session of sessions.values()) session.setUser(userFor(s.settings));
    }
  });
  onAccountChange(() => {
    for (const session of sessions.values()) session.setUser(userFor(useApp.getState().settings));
  });
}

function sync() {
  const s = useApp.getState();
  if (!s.ready) return;
  const wanted = new Map<string, ShareRecord>();
  for (const [anchor, record] of Object.entries(s.shares)) {
    if (anchor === BOARD || !s.notes[anchor]) continue;
    wanted.set(anchor, record);
  }
  for (const [anchor, session] of sessions) {
    const record = wanted.get(anchor);
    if (!record || record.id !== session.shareId) retire(anchor, true);
  }
  for (const [anchor, record] of wanted) void ensure(anchor, record);
}

function retire(anchor: string, forget: boolean) {
  const session = sessions.get(anchor);
  if (session) {
    // Make sure the note holds the latest words before the live doc goes away.
    writeToNote(anchor, session);
    session.stop();
    sessions.delete(anchor);
    emit();
  }
  if (forget) void idbDel(savedKey(anchor), ydb).catch(() => {});
}

async function ensure(anchor: string, record: ShareRecord) {
  if (starting.has(anchor) || sessions.get(anchor)?.shareId === record.id) return;
  if ((retryAt.get(anchor) ?? 0) > Date.now()) return;
  starting.add(anchor);
  try {
    if (!record.collab) {
      await initialize(anchor, record);
      return;
    }
    const fresh = prepared.get(anchor);
    prepared.delete(anchor);
    let doc: Y.Doc | undefined;
    let seq = -1;
    let pending: Uint8Array | null = null;
    if (fresh?.shareId === record.id) {
      doc = fresh.doc;
      seq = fresh.seq;
    } else {
      const saved = (await idbGet<Saved>(savedKey(anchor), ydb).catch(() => undefined)) ?? null;
      if (saved?.shareId === record.id) {
        doc = new Y.Doc();
        try {
          Y.applyUpdate(doc, saved.state);
          seq = saved.seq;
          pending = saved.pending;
        } catch {
          doc = undefined; // unreadable copy: just catch up from the server
        }
      }
    }
    // Things may have moved on while we were reading.
    const current = useApp.getState().shares[anchor];
    if (current?.id !== record.id || sessions.has(anchor)) return;

    const session = new CollabSession({
      shareId: record.id,
      key: record.key,
      token: record.token,
      owner: true,
      user: userFor(useApp.getState().settings),
      doc,
      seq,
      pending,
      onSave: (st) => void idbSet(savedKey(anchor), { v: 1, shareId: record.id, ...st } satisfies Saved, ydb).catch(() => {}),
      onChange: () => scheduleWrite(anchor),
    });
    session.subscribe(() => watch(anchor, session));
    sessions.set(anchor, session);
    const until = expecting.get(anchor) ?? 0;
    if (until > Date.now()) session.expect(until - Date.now());
    session.start();
    emit();
  } finally {
    starting.delete(anchor);
  }
}

/** Turns an ordinary shared note into a live, co-editable doc on the server. */
async function initialize(anchor: string, record: ShareRecord) {
  // Pull in anything still sitting in the editor's save debounce.
  window.dispatchEvent(new Event("umbra:flush-editor"));
  const note = useApp.getState().notes[anchor];
  if (!note) return;
  const doc = new Y.Doc();
  fillDoc(doc, note);
  const editable = record.editable !== false;
  try {
    const writeHash = await sha256B64(await writeTokenFor(record.key));
    const entry = await sealBytes(record.key, encodeFrame(Y.encodeStateAsUpdate(doc), null));
    await initDoc(record.id, record.token, { writeHash, editable, entry, client: doc.clientID });
    prepared.set(anchor, { shareId: record.id, doc, seq: 1 });
  } catch (err) {
    if (err instanceof ApiError && err.code === "exists") {
      // It's already live (another tab beat us to it): catch up from the server's copy.
      await idbDel(savedKey(anchor), ydb).catch(() => {});
    } else {
      if (err instanceof ApiError && (err.code === "not_found" || err.code === "forbidden")) {
        void verifyShare(anchor);
      }
      retryAt.set(anchor, Date.now() + 15_000);
      window.setTimeout(sync, 15_500);
      return;
    }
  }
  if (useApp.getState().shares[anchor]?.id === record.id) useApp.getState().patchShare(anchor, { collab: true, editable });
}

function watch(anchor: string, session: CollabSession) {
  if (session.status === "missing") {
    // The server has no live doc for this link (e.g. it never finished starting): start it.
    retire(anchor, true);
    if (useApp.getState().shares[anchor]?.id === session.shareId) useApp.getState().patchShare(anchor, { collab: false });
    return;
  }
  if (session.status === "gone") {
    retire(anchor, true);
    void verifyShare(anchor);
    return;
  }
  // someone's asked to be let into a private link: the people watch takes it from here
  if ((pendingSeen.get(anchor) ?? 0) !== session.pending) {
    const more = session.pending > (pendingSeen.get(anchor) ?? 0);
    pendingSeen.set(anchor, session.pending);
    if (more) window.dispatchEvent(new CustomEvent(PENDING_EVENT, { detail: anchor }));
  }
  const record = useApp.getState().shares[anchor];
  if (record && record.id === session.shareId && session.synced && (record.editable !== false) !== session.editable) {
    useApp.getState().patchShare(anchor, { editable: session.editable });
  }
}

function scheduleWrite(anchor: string) {
  if (syncTimers.has(anchor)) return;
  syncTimers.set(
    anchor,
    window.setTimeout(() => {
      syncTimers.delete(anchor);
      const session = sessions.get(anchor);
      if (session) writeToNote(anchor, session);
    }, 250),
  );
}

/** Mirrors the live doc into the note, so the sidebar, search and exports stay current. */
function writeToNote(anchor: string, session: CollabSession) {
  const note = useApp.getState().notes[anchor];
  if (!note) return;
  let next: ReturnType<typeof readDoc>;
  try {
    next = readDoc(session.doc);
  } catch (err) {
    console.warn("Couldn't read the live note", err);
    return;
  }
  if (note.title === next.title && note.text === next.text && JSON.stringify(note.doc) === JSON.stringify(next.doc)) return;
  useApp.getState().updateNote(anchor, next);
}
