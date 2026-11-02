import * as Y from "yjs";
import { Awareness, applyAwarenessUpdate, encodeAwarenessUpdate } from "y-protocols/awareness";
import { ApiError, fetchDoc, pushDoc, type DocCatchUp } from "../lib/api";
import { openBytes, sealBytes } from "../lib/crypto";

/**
 * One live, co-editable document: a Yjs doc kept in step with everyone else editing it.
 *
 * Local changes are batched into small updates, sealed with the link's key and appended
 * to the shared log on the server; everyone else's updates are pulled from it and merged.
 * Yjs does the merging (a CRDT), so two people can type in the same sentence at once.
 *
 * There are no websockets on Netlify, so "live" is fast polling — but only while it
 * matters: quick when someone else is here, slow when you're alone, nothing at all when
 * the tab is hidden, and a crawl when nobody has touched anything for a couple of minutes.
 */

/** Origin tag for changes that came from someone else. */
export const REMOTE = "umbra-remote";

export type CollabUser = { name: string; color: string };
export type Collaborator = CollabUser & { clientId: number; self: boolean };
/** gone: the link was turned off · missing: there's no live doc for it (yet) */
export type SessionStatus = "connecting" | "live" | "offline" | "gone" | "missing";

// ── Wire format of one log entry, inside the encryption ─────────────────────
// [version = 1][u32 doc length][doc update][u32 awareness length][awareness update]

export function encodeFrame(doc?: Uint8Array | null, aw?: Uint8Array | null): Uint8Array {
  const d = doc ?? new Uint8Array(0);
  const a = aw ?? new Uint8Array(0);
  const out = new Uint8Array(9 + d.length + a.length);
  const view = new DataView(out.buffer);
  out[0] = 1;
  view.setUint32(1, d.length);
  out.set(d, 5);
  view.setUint32(5 + d.length, a.length);
  out.set(a, 9 + d.length);
  return out;
}

export function decodeFrame(bytes: Uint8Array): { doc: Uint8Array | null; aw: Uint8Array | null } {
  if (bytes.length < 9 || bytes[0] !== 1) throw new Error("bad_frame");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const dl = view.getUint32(1);
  if (9 + dl > bytes.length) throw new Error("bad_frame");
  const al = view.getUint32(5 + dl);
  if (9 + dl + al > bytes.length) throw new Error("bad_frame");
  return { doc: dl ? bytes.subarray(5, 5 + dl) : null, aw: al ? bytes.subarray(9 + dl, 9 + dl + al) : null };
}

// When did the person at this keyboard last do anything? (Shared by every session.)
let lastInput = Date.now();
/** Sessions to nudge when someone comes back after a quiet spell. */
const wakers = new Set<() => void>();
if (typeof window !== "undefined") {
  for (const type of ["keydown", "pointerdown", "pointermove", "wheel"] as const) {
    addEventListener(
      type,
      () => {
        const now = Date.now();
        const gap = now - lastInput;
        lastInput = now;
        if (gap > 120_000) wakers.forEach((wake) => wake());
      },
      { passive: true, capture: true },
    );
  }
}

type Options = {
  shareId: string;
  key: string;
  /** The owner's private token, or the write token derived from the link. */
  token: string;
  owner: boolean;
  user: CollabUser;
  /** Resume from a saved state (the owner keeps one per shared note). */
  doc?: Y.Doc;
  seq?: number;
  pending?: Uint8Array | null;
  onSave?: (s: { state: Uint8Array; seq: number; pending: Uint8Array | null }) => void;
  /** The document changed — locally or from someone else. */
  onChange?: (remote: boolean) => void;
};

const IDLE_AFTER = 120_000;
/** Nobody has touched anything for this long: barely check, and stop saying "I'm here". */
const ASLEEP_AFTER = 600_000;

export class CollabSession {
  readonly doc: Y.Doc;
  readonly awareness: Awareness;
  readonly shareId: string;
  readonly owner: boolean;
  status: SessionStatus = "connecting";
  /** Whether the owner lets friends edit. */
  editable = true;
  /** Highest log entry applied (contiguous). */
  seq: number;
  /** Bumped on every change worth re-rendering for. */
  version = 0;
  /** True once the first catch-up has landed. */
  synced = false;

  private key: string;
  private token: string;
  private opts: Options;
  private upto = 0;
  private outbox: Uint8Array[] = [];
  private inflight: Uint8Array | null = null;
  private awDirty = false;
  private flushing = false;
  private again = false;
  private flushTimer = 0;
  private pollTimer = 0;
  private saveTimer = 0;
  private polling = false;
  private stopped = false;
  private bound = 0;
  private lastLocal = 0;
  private lastRemote = 0;
  private failures = 0;
  private compacting = false;
  private pollStarted = 0;
  private emitQueued = false;
  private subs = new Set<() => void>();

  constructor(opts: Options) {
    this.opts = opts;
    this.shareId = opts.shareId;
    this.owner = opts.owner;
    this.key = opts.key;
    this.token = opts.token;
    this.doc = opts.doc ?? new Y.Doc();
    this.seq = opts.seq ?? -1;
    if (opts.pending?.length) this.outbox.push(opts.pending);
    this.awareness = new Awareness(this.doc);
    this.awareness.setLocalState({ user: opts.user, here: false });
    this.doc.on("update", this.onDocUpdate);
    this.awareness.on("update", this.onAwareness);
    document.addEventListener("visibilitychange", this.onVisibility);
    addEventListener("pagehide", this.onPageHide);
    addEventListener("online", this.onOnline);
    wakers.add(this.wake);
    if (import.meta.env.DEV) ((window as unknown as { __collab?: CollabSession[] }).__collab ??= []).push(this);
  }

  /** Back at the keyboard: say hello again and check for news right away. */
  private wake = () => {
    if (this.stopped) return;
    this.awDirty = true;
    this.scheduleFlush(60);
    this.schedulePoll(0);
  };

  // ── lifecycle ──────────────────────────────────────────────────────────────

  start() {
    void this.poll();
    if (this.outbox.length) this.scheduleFlush(200);
  }

  /** An editor is showing this doc (owner: the note is open; friend: the page is open). */
  bind() {
    this.bound++;
    this.setHere(!document.hidden);
    this.schedulePoll(60);
  }

  unbind() {
    this.bound = Math.max(0, this.bound - 1);
    if (!this.bound) this.setHere(false);
    this.schedulePoll();
  }

  stop() {
    if (this.stopped) return;
    this.setHere(false);
    void this.flush({ keepalive: true, final: true });
    this.stopped = true;
    wakers.delete(this.wake);
    window.clearTimeout(this.flushTimer);
    window.clearTimeout(this.pollTimer);
    this.saveNow();
    document.removeEventListener("visibilitychange", this.onVisibility);
    removeEventListener("pagehide", this.onPageHide);
    removeEventListener("online", this.onOnline);
    this.doc.off("update", this.onDocUpdate);
    this.awareness.off("update", this.onAwareness);
    this.awareness.destroy();
  }

  setUser(user: CollabUser) {
    const cur = this.awareness.getLocalState();
    if (cur) this.awareness.setLocalState({ ...cur, user });
  }

  get canWrite() {
    return this.status !== "gone" && this.status !== "missing" && (this.owner || this.editable);
  }

  /** Everyone with this doc open right now (you included). */
  collaborators(): Collaborator[] {
    const out: Collaborator[] = [];
    this.awareness.getStates().forEach((state, clientId) => {
      const user = state?.user as CollabUser | undefined;
      if (!user || !state.here) return;
      out.push({ clientId, name: String(user.name ?? "Someone").slice(0, 40), color: String(user.color ?? "#9aa"), self: clientId === this.doc.clientID });
    });
    return out.sort((a, b) => Number(b.self) - Number(a.self) || a.clientId - b.clientId);
  }

  subscribe = (fn: () => void) => {
    this.subs.add(fn);
    return () => {
      this.subs.delete(fn);
    };
  };

  private emit() {
    this.version++;
    // Notify after the current task: awareness can change while an editor is mid-render.
    if (this.emitQueued) return;
    this.emitQueued = true;
    queueMicrotask(() => {
      this.emitQueued = false;
      this.subs.forEach((fn) => fn());
    });
  }

  private setStatus(status: SessionStatus) {
    if (this.status === status) return;
    this.status = status;
    this.emit();
  }

  private setHere(here: boolean) {
    const cur = this.awareness.getLocalState();
    if (cur && cur.here !== here) this.awareness.setLocalState({ ...cur, here });
  }

  // ── local changes → server ─────────────────────────────────────────────────

  private onDocUpdate = (update: Uint8Array, origin: unknown) => {
    if (origin === REMOTE) {
      this.opts.onChange?.(true);
      return;
    }
    this.outbox.push(update);
    this.lastLocal = Date.now();
    this.opts.onChange?.(false);
    this.scheduleSave();
    this.scheduleFlush(30);
  };

  private onAwareness = ({ added, updated, removed }: { added: number[]; updated: number[]; removed: number[] }, origin: unknown) => {
    const mine = origin !== REMOTE && [...added, ...updated, ...removed].includes(this.doc.clientID);
    // Long idle: let the periodic "still here" renewals lapse, so the others' polling relaxes.
    if (mine && !this.asleep()) {
      this.awDirty = true;
      this.scheduleFlush(this.outbox.length ? 30 : 120);
    }
    this.emit();
  };

  private scheduleFlush(delay: number) {
    if (this.stopped || this.flushTimer) return;
    this.flushTimer = window.setTimeout(() => {
      this.flushTimer = 0;
      void this.flush();
    }, delay);
  }

  private backoff() {
    // A blip gets a quick retry; a real outage backs off to every 30 s.
    return Math.min(30_000, 400 * 2 ** Math.min(Math.max(this.failures - 1, 0), 7));
  }

  private async flush({ keepalive = false, final = false } = {}) {
    if (this.stopped && !final) return;
    if (this.flushing) {
      this.again = true;
      return;
    }
    if (!this.canWrite || this.seq < 0) {
      // Not caught up yet (or not allowed): nothing to send until the first catch-up.
      if (!this.canWrite) this.awDirty = false;
      return;
    }
    const updates = this.outbox.splice(0);
    const doc = updates.length ? (updates.length === 1 ? updates[0] : Y.mergeUpdates(updates)) : null;
    const aw = this.awDirty ? encodeAwarenessUpdate(this.awareness, [this.doc.clientID]) : null;
    this.awDirty = false;
    if (!doc && !aw) return;
    this.flushing = true;
    this.inflight = doc;
    try {
      const entry = await sealBytes(this.key, encodeFrame(doc, aw));
      const res = await pushDoc(this.shareId, this.token, { client: this.doc.clientID, since: this.seq, entry }, { keepalive });
      this.inflight = null;
      this.failures = 0;
      if (res.assigned == null) {
        // We were too far behind to append; catch up (below) and send again.
        if (doc) this.outbox.unshift(doc);
        if (aw) this.awDirty = true;
        this.again = true;
      }
      if (!this.stopped) {
        await this.apply(res);
        this.setStatus("live");
        this.scheduleSave();
        void this.maybeCompact();
      }
    } catch (err) {
      this.inflight = null;
      if (doc) this.outbox.unshift(doc);
      if (aw) this.awDirty = true;
      this.fail(err);
    } finally {
      this.flushing = false;
      if (!this.stopped) {
        if (this.failures) {
          if (this.outbox.length || this.awDirty) this.scheduleFlush(this.backoff());
        } else if (this.again || this.outbox.length || this.awDirty) {
          this.scheduleFlush(30);
        }
        this.again = false;
      }
    }
  }

  // ── server → local ─────────────────────────────────────────────────────────

  private schedulePoll(delay?: number) {
    if (this.stopped) return;
    window.clearTimeout(this.pollTimer);
    this.pollTimer = 0;
    if (document.hidden || this.status === "gone" || this.status === "missing") return;
    // Cadence is measured from when the last poll started, so slow round trips don't add up.
    const wait = delay ?? Math.max(0, this.interval() - (Date.now() - this.pollStarted));
    this.pollTimer = window.setTimeout(() => void this.poll(), wait);
  }

  private quietFor() {
    return Date.now() - Math.max(lastInput, this.lastLocal, this.lastRemote);
  }

  private asleep() {
    return this.quietFor() > ASLEEP_AFTER;
  }

  /** How long to wait before asking again — fast only while it matters. */
  private interval() {
    if (this.failures) return this.backoff();
    const quiet = this.quietFor();
    // Not open anywhere on screen: just keep the note itself roughly current.
    if (!this.bound) return quiet > ASLEEP_AFTER ? 300_000 : 60_000;
    if (quiet > ASLEEP_AFTER) return 15_000;
    if (this.othersHere() > 0) {
      if (quiet > IDLE_AFTER) return 4_000;
      return Date.now() - this.lastRemote < 8_000 ? 250 : 450;
    }
    return quiet > IDLE_AFTER ? 10_000 : 2_500;
  }

  private othersHere() {
    let n = 0;
    this.awareness.getStates().forEach((state, clientId) => {
      if (clientId !== this.doc.clientID && state?.here) n++;
    });
    return n;
  }

  private async poll() {
    this.pollTimer = 0;
    if (this.stopped || this.polling) return;
    this.polling = true;
    this.pollStarted = Date.now();
    try {
      let res: DocCatchUp;
      do {
        res = await fetchDoc(this.shareId, this.seq);
        if (this.stopped) return;
        await this.apply(res);
      } while (res.more);
      this.failures = 0;
      this.setStatus("live");
      if (this.outbox.length || this.awDirty) this.scheduleFlush(30);
      void this.maybeCompact();
    } catch (err) {
      this.fail(err);
    } finally {
      this.polling = false;
      this.schedulePoll();
    }
  }

  private async apply(res: DocCatchUp) {
    const sealed = [...(res.snap ? [{ ...res.snap, c: -1 }] : []), ...res.entries];
    const opened = await Promise.all(
      sealed.map(async (e) => {
        try {
          return { c: e.c, ...decodeFrame(await openBytes(this.key, e)) };
        } catch (err) {
          console.warn("Skipped an unreadable change", err);
          return null;
        }
      }),
    );
    const docs: Uint8Array[] = [];
    let fromOthers = false;
    for (const part of opened) {
      if (!part) continue;
      if (part.doc && part.c !== this.doc.clientID) {
        docs.push(part.doc);
        if (part.c !== -1) fromOthers = true;
      }
      if (part.aw && part.c !== this.doc.clientID) {
        try {
          applyAwarenessUpdate(this.awareness, part.aw, REMOTE);
        } catch {
          /* ignore a malformed presence update */
        }
      }
    }
    if (docs.length) {
      try {
        Y.applyUpdate(this.doc, docs.length === 1 ? docs[0] : Y.mergeUpdates(docs), REMOTE);
      } catch (err) {
        console.warn("Couldn't apply a change", err);
      }
    }
    if (fromOthers) this.lastRemote = Date.now();
    const editableChanged = this.editable !== res.editable;
    this.editable = res.editable;
    this.upto = res.upto;
    this.seq = Math.max(this.seq, res.seq);
    if (!this.synced) {
      this.synced = true;
      this.awDirty = true; // say hello
      this.emit();
    } else if (editableChanged || docs.length) this.emit();
  }

  private fail(err: unknown) {
    if (err instanceof ApiError) {
      if (err.code === "read_only") {
        this.editable = false;
        this.emit();
        return;
      }
      if (err.code === "no_doc") {
        // Having been live, a vanished doc means the link was turned off.
        this.setStatus(this.synced ? "gone" : "missing");
        return;
      }
      if (err.code === "not_found" || err.code === "forbidden") {
        this.setStatus("gone");
        return;
      }
    }
    this.failures++;
    if (this.failures >= 2) this.setStatus("offline");
  }

  /** Every so often, fold the log into one snapshot so catching up stays quick. */
  private async maybeCompact() {
    if (this.compacting || !this.canWrite || this.seq - this.upto < (this.owner ? 120 : 240)) return;
    this.compacting = true;
    try {
      const upto = this.seq;
      const snap = await sealBytes(this.key, encodeFrame(Y.encodeStateAsUpdate(this.doc), null));
      if (snap.data.length > 3_400_000) return;
      const res = await pushDoc(this.shareId, this.token, { client: this.doc.clientID, since: this.seq, snap: { ...snap, upto } });
      await this.apply(res);
    } catch {
      /* someone else will, or we'll try again later */
    } finally {
      this.compacting = false;
    }
  }

  // ── saving the owner's copy locally ────────────────────────────────────────

  private scheduleSave() {
    if (!this.opts.onSave || this.saveTimer) return;
    this.saveTimer = window.setTimeout(() => this.saveNow(), 500);
  }

  private saveNow() {
    window.clearTimeout(this.saveTimer);
    this.saveTimer = 0;
    if (!this.opts.onSave) return;
    const unsent = [...(this.inflight ? [this.inflight] : []), ...this.outbox];
    this.opts.onSave({
      state: Y.encodeStateAsUpdate(this.doc),
      seq: this.seq,
      pending: unsent.length ? (unsent.length === 1 ? unsent[0] : Y.mergeUpdates(unsent)) : null,
    });
  }

  // ── page events ────────────────────────────────────────────────────────────

  private onVisibility = () => {
    if (this.stopped) return;
    if (document.hidden) {
      this.setHere(false);
      void this.flush();
      window.clearTimeout(this.pollTimer);
      this.pollTimer = 0;
    } else {
      if (this.bound) this.setHere(true);
      this.schedulePoll(0);
    }
  };

  private onPageHide = () => {
    this.setHere(false);
    this.saveNow();
    void this.flush({ keepalive: true });
  };

  private onOnline = () => {
    this.failures = 0;
    this.schedulePoll(0);
    if (this.outbox.length) this.scheduleFlush(50);
  };
}
