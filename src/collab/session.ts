import * as Y from "yjs";
import { Awareness, applyAwarenessUpdate, encodeAwarenessUpdate, removeAwarenessStates } from "y-protocols/awareness";
import { ApiError, fetchDoc, leaveDoc, pushDoc, type DocCatchUp, type HereParams, type HerePerson, type Sealed } from "../lib/api";
import { openBytes, sealBytes } from "../lib/crypto";
import { ASLEEP_AFTER, AWAY_AFTER, IDLE_AFTER, lastInputAt, onWake } from "../lib/activity";

/**
 * One live, co-editable document: a Yjs doc kept in step with everyone else editing it.
 *
 * Local changes are batched into small updates, sealed with the link's key and appended
 * to the shared log on the server; everyone else's updates are pulled from it and merged.
 * Yjs does the merging (a CRDT), so two people can type in the same sentence at once.
 *
 * There are no websockets on Netlify, so "live" is polling — and every request costs a little,
 * so it only goes fast while someone else is actually here:
 *  - someone else here: a few times a second while either of you is typing, about once a second
 *    otherwise (your cursor goes along too);
 *  - nobody else here, the note open on your screen: one check every 30 seconds — enough to see
 *    someone arrive — and what you type goes up a few seconds' worth at a time;
 *  - the note not open, the tab hidden, or nobody at the keyboard for half an hour: nothing.
 *
 * Who's here comes from the server's list (see collab.mts), which those same checks keep
 * current: each person brings a little card (their colour and picture), sealed with the link's
 * key; the name is the server's word for it (a signed-in username — or a guest).
 */

/** Origin tag for changes that came from someone else. */
export const REMOTE = "umbra-remote";

/** A profile picture: an image (see lib/images.ts), stored encrypted with a key of its own. */
export type AvatarRef = { id: string; key: string; type: string };
export type CollabUser = { name: string; color: string; guest?: boolean; avatar?: AvatarRef | null };
export type Collaborator = {
  clientId: number;
  name: string;
  color: string;
  self: boolean;
  /** What they may do, as the server sees it (null: someone on an older version of the app). */
  role: "owner" | "edit" | "view" | null;
  /** Not signed in. */
  guest: boolean;
  avatar: AvatarRef | null;
};
/** gone: the link was turned off · missing: no live doc for it (yet) · denied: the owner removed you, or it's private */
export type SessionStatus = "connecting" | "live" | "offline" | "gone" | "missing" | "denied";

/** Guests get a colour of their own (from a few that read well by day and by night), so two can be told apart. */
export const GUEST_COLORS = ["#6f9df7", "#ef7d6f", "#4fbf8a", "#e8a33d", "#a77df0", "#3fb8c4", "#e676b0", "#93a84f"];
export const guestColor = (n: number) => GUEST_COLORS[Math.abs(n) % GUEST_COLORS.length];

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

// ── A person's card on the "who's here" list ────────────────────────────────

type Card = { v: 1; color: string; avatar: AvatarRef | null };
type Heard = { c: number; k: number; r: HerePerson["r"]; u: string | null; card: Card | null };

const AVATAR_ID = /^[A-Za-z0-9_-]{22}$/;
function readCard(raw: unknown): Card | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.color !== "string" || !/^#[0-9a-f]{6}$/i.test(r.color)) return null;
  const a = r.avatar as Record<string, unknown> | null | undefined;
  const avatar =
    a && typeof a.id === "string" && AVATAR_ID.test(a.id) && typeof a.key === "string" && a.key.length >= 40 && a.key.length <= 64 && typeof a.type === "string" && /^image\/(webp|jpeg|png)$/.test(a.type)
      ? { id: a.id, key: a.key, type: a.type }
      : null;
  return { v: 1, color: r.color, avatar };
}

/** Sending what you type when nobody else is here: once you pause this long… */
const ALONE_FLUSH = 1_500;
/** …or this long after the first unsent change, whichever comes first. */
const ALONE_MAX = 5_000;
/** An "I'm here" older than this, met while catching up, is history — not someone here now. */
const STALE_AWARENESS = 45_000;

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

export class CollabSession {
  readonly doc: Y.Doc;
  readonly awareness: Awareness;
  readonly shareId: string;
  readonly owner: boolean;
  status: SessionStatus = "connecting";
  /** Whether the owner lets friends (via the link) edit. */
  editable = true;
  /** What *you* may do here, as the server sees it. */
  role: "owner" | "edit" | "view" | null = null;
  /** Why you were turned away (removed / restricted / pending). */
  denied: string | null = null;
  /** Highest log entry applied (contiguous). */
  seq: number;
  /** Bumped on every change worth re-rendering for. */
  version = 0;
  /** True once the first catch-up has landed. */
  synced = false;
  /** (owner, private link) how many people are waiting to be let in — as of the last check. */
  pending = 0;

  private key: string;
  private token: string;
  private user: CollabUser;

  /** What uploading a picture into this note needs (signed in, or this link's token). */
  get uploadAuth(): { share: string; token: string } {
    return { share: this.shareId, token: this.token };
  }
  /** You, as the editor's carets show you (a guest in a colour of their own; `cid` lets a click on your picture find your caret). */
  get localUser(): { name: string; color: string; cid: number } {
    return { name: this.user.name, color: this.user.color, cid: this.doc.clientID };
  }
  private opts: Options;
  private upto = 0;
  private outbox: Uint8Array[] = [];
  private inflight: Uint8Array | null = null;
  private awDirty = false;
  private flushing = false;
  private again = false;
  private flushTimer = 0;
  private flushDue = 0;
  /** When the oldest change still waiting to go up was made (0: none waiting). */
  private firstUnsent = 0;
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
  private unwake: () => void;
  // who's here
  private card: Sealed | null = null;
  private cardK = 0;
  private sealing: Promise<void> | null = null;
  /** The server has your current card. */
  private cardSent = false;
  /** Version of the list we have ("" = none yet). */
  private hv = "";
  private heard = new Map<number, Heard>();
  /** The server's clock as of the list we have (an answer that set off earlier but landed later is older news). */
  private heardAt = 0;
  private hereChain: Promise<void> = Promise.resolve();
  /** We put ourselves on the list (so we owe a goodbye). */
  private listed = false;
  /** Someone's likely to arrive (a link just made or copied): look a little more often till then. */
  private expectUntil = 0;
  /** When anyone else was last seen here. */
  private othersSeen = 0;
  private alone = true;

  constructor(opts: Options) {
    this.opts = opts;
    this.shareId = opts.shareId;
    this.owner = opts.owner;
    this.key = opts.key;
    this.token = opts.token;
    this.doc = opts.doc ?? new Y.Doc();
    this.seq = opts.seq ?? -1;
    if (opts.pending?.length) {
      this.outbox.push(opts.pending);
      this.firstUnsent = Date.now();
    }
    this.user = this.decorate(opts.user);
    this.awareness = new Awareness(this.doc);
    this.awareness.setLocalState({ user: this.localUser, here: false });
    this.doc.on("update", this.onDocUpdate);
    this.awareness.on("update", this.onAwareness);
    document.addEventListener("visibilitychange", this.onVisibility);
    addEventListener("pagehide", this.onPageHide);
    addEventListener("online", this.onOnline);
    this.unwake = onWake(this.wake);
    void this.sealCard();
    if (import.meta.env.DEV) ((window as unknown as { __collab?: CollabSession[] }).__collab ??= []).push(this);
  }

  /** Back at the keyboard: say hello again and check for news right away. */
  private wake = () => {
    if (this.stopped) return;
    if (this.othersHere() > 0 && this.canWrite) {
      this.awDirty = true;
      this.scheduleFlush(60);
    }
    if (this.bound || Date.now() - this.othersSeen < 120_000) this.schedulePoll(0);
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
    if (!this.bound) {
      this.setHere(false);
      this.leave();
      // what you just typed doesn't wait for the next batch
      if (this.outbox.length) this.scheduleFlush(30);
    }
    this.schedulePoll();
  }

  stop() {
    if (this.stopped) return;
    this.setHere(false);
    this.leave(true);
    void this.flush({ keepalive: true, final: true });
    this.stopped = true;
    this.unwake();
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
    const next = this.decorate(user);
    const prev = this.user;
    this.user = next;
    const cur = this.awareness.getLocalState();
    if (cur) this.awareness.setLocalState({ ...cur, user: this.localUser });
    if (prev.color !== next.color || (prev.avatar?.id ?? null) !== (next.avatar?.id ?? null)) void this.sealCard();
    else this.emit();
  }

  /** Someone's likely to open the link soon (you just made or copied it): look for them more often for a while. */
  expect(ms = 180_000) {
    this.expectUntil = Math.max(this.expectUntil, Date.now() + ms);
    this.schedulePoll();
  }

  /** Check who's here now (the Share panel just opened), unless we only just did. */
  peek() {
    if (!this.polling && Date.now() - this.pollStarted > 3_000) this.schedulePoll(0);
  }

  get canWrite() {
    if (this.status === "gone" || this.status === "missing" || this.status === "denied") return false;
    return this.owner || (this.role ? this.role === "edit" : this.editable);
  }

  /** Everyone with this doc open right now: you first, then the owner, people signed in, and guests. */
  collaborators(): Collaborator[] {
    const me = this.user;
    const out: Collaborator[] = [{ clientId: this.doc.clientID, name: me.name, color: me.color, self: true, role: this.role, guest: Boolean(me.guest), avatar: me.avatar ?? null }];
    for (const h of this.heard.values()) {
      if (this.isMe(h)) continue;
      out.push({
        clientId: h.c,
        name: h.u ?? (h.r === "owner" ? "Owner" : "Guest"),
        color: h.card?.color ?? guestColor(h.c),
        self: false,
        role: h.r,
        guest: !h.u && h.r !== "owner",
        avatar: h.u ? (h.card?.avatar ?? null) : null,
      });
    }
    // someone on an older version of the app (it doesn't use the list): their own "I'm here"
    this.awareness.getStates().forEach((state, clientId) => {
      if (clientId === this.doc.clientID || this.heard.has(clientId) || !state?.here) return;
      const user = state.user as CollabUser | undefined;
      if (!user) return;
      out.push({ clientId, name: String(user.name ?? "Someone").slice(0, 40), color: String(user.color ?? "#9aa"), self: false, role: null, guest: false, avatar: null });
    });
    const rank = (c: Collaborator) => (c.self ? 0 : c.role === "owner" ? 1 : c.guest ? 3 : 2);
    return out.sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name) || a.clientId - b.clientId);
  }

  /** You, on another device or tab (the same account — or, for the owner, the owner's link). */
  private isMe(h: Heard) {
    if (this.owner && h.r === "owner") return true;
    return Boolean(h.u && !this.user.guest && h.u === this.user.name);
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

  /** A guest's colour is their own (from the guest palette), and a guest has no picture. */
  private decorate(user: CollabUser): CollabUser {
    return user.guest ? { ...user, color: guestColor(this.doc.clientID), avatar: null } : user;
  }

  // ── who's here ─────────────────────────────────────────────────────────────

  private sealCard(): Promise<void> {
    const card: Card = { v: 1, color: this.user.color, avatar: this.user.avatar ?? null };
    const job = (async () => {
      try {
        const sealed = await sealBytes(this.key, new TextEncoder().encode(JSON.stringify(card)));
        this.card = sealed;
        this.cardK++;
        this.cardSent = false;
        // tell the others (sooner than the next check-in) if we're already on the list
        if (this.listed && this.present()) this.schedulePoll(80);
        this.emit();
      } catch {
        /* no card this time: the next check-in tries again */
      }
    })();
    this.sealing = job;
    return job;
  }

  /** On the list: the note is open on screen, and someone's at the keyboard. */
  private present() {
    return this.bound > 0 && !document.hidden && this.quietFor() < AWAY_AFTER && this.status !== "denied" && this.status !== "gone" && this.status !== "missing";
  }

  /** What a check-in says about you: here (with your card, if the server hasn't got it), or just asking who is. */
  private hereParams(): HereParams {
    if (!this.present() || !this.card) return { hv: this.hv };
    this.listed = true;
    return { hv: this.hv, c: this.doc.clientID, k: this.cardK, card: this.cardSent ? null : this.card };
  }

  /** Off the list at once (rather than a minute and a half later). */
  private leave(keepalive = false) {
    if (!this.listed) return;
    this.listed = false;
    this.cardSent = false;
    void leaveDoc(this.shareId, this.token, this.doc.clientID, keepalive).catch(() => {});
  }

  private async openCard(p: Sealed): Promise<Card | null> {
    try {
      return readCard(JSON.parse(new TextDecoder().decode(await openBytes(this.key, p))));
    } catch {
      return null;
    }
  }

  private applyHere(res: DocCatchUp, asked: HereParams | undefined) {
    const h = res.here;
    if (!h) return Promise.resolve();
    if (asked?.c != null) this.cardSent = h.you;
    if (!h.people) return Promise.resolve();
    const people = h.people;
    const at = res.now ?? Date.now();
    this.hereChain = this.hereChain.then(async () => {
      if (at < this.heardAt) return;
      const next = new Map<number, Heard>();
      for (const p of people) {
        if (p.c === this.doc.clientID) continue;
        const prev = this.heard.get(p.c);
        const card = prev && prev.k === p.k && prev.card ? prev.card : await this.openCard(p);
        next.set(p.c, { c: p.c, k: p.k, r: p.r, u: p.u ?? null, card });
      }
      if (at < this.heardAt) return;
      // whoever left takes their cursor with them
      const gone = [...this.heard.keys()].filter((c) => !next.has(c) && this.awareness.getStates().has(c));
      this.heard = next;
      this.heardAt = at;
      this.hv = h.v;
      if (gone.length) removeAwarenessStates(this.awareness, gone, REMOTE);
      this.emit();
    }).catch((err) => console.warn("Couldn't read who's here", err));
    return this.hereChain;
  }

  /** How many others have it open (anyone on another version of the app too). */
  private othersHere() {
    let n = this.heard.size;
    this.awareness.getStates().forEach((state, clientId) => {
      if (clientId !== this.doc.clientID && !this.heard.has(clientId) && state?.here) n++;
    });
    return n;
  }

  /** Company arrived (or left): when they arrive, say hello with your cursor, send what's waiting, and keep up. */
  private notice() {
    const others = this.othersHere();
    if (others > 0) this.othersSeen = Date.now();
    const alone = others === 0;
    if (this.alone && !alone && this.canWrite && this.seq >= 0) {
      this.awDirty = true;
      this.scheduleFlush(this.outbox.length ? 30 : 60);
    }
    if (this.alone !== alone) {
      // (they've just gone: people often come straight back — keep an eye out a little longer)
      if (alone) this.expect(300_000);
      this.alone = alone;
      this.schedulePoll();
    }
  }

  // ── local changes → server ─────────────────────────────────────────────────

  private onDocUpdate = (update: Uint8Array, origin: unknown) => {
    if (origin === REMOTE) {
      this.opts.onChange?.(true);
      return;
    }
    this.outbox.push(update);
    this.lastLocal = Date.now();
    if (!this.firstUnsent) this.firstUnsent = this.lastLocal;
    this.opts.onChange?.(false);
    this.scheduleSave();
    this.sendSoon();
  };

  /** Right away while someone else is here; on your own, a few seconds' typing at a time. */
  private sendSoon() {
    if (this.othersHere() > 0) {
      this.scheduleFlush(30);
      return;
    }
    if (this.stopped) return;
    const now = Date.now();
    const delay = Math.max(0, Math.min(ALONE_FLUSH, (this.firstUnsent || now) + ALONE_MAX - now));
    window.clearTimeout(this.flushTimer);
    this.flushDue = now + delay;
    this.flushTimer = window.setTimeout(this.flushFired, delay);
  }

  private onAwareness = ({ added, updated, removed }: { added: number[]; updated: number[]; removed: number[] }, origin: unknown) => {
    const mine = origin !== REMOTE && [...added, ...updated, ...removed].includes(this.doc.clientID);
    // Your cursor (and the periodic "still here" renewals) only go out while someone's here to see
    // them — and not after a long idle, so the others' polling relaxes.
    if (mine && !this.asleep() && this.othersHere() > 0) {
      this.awDirty = true;
      this.scheduleFlush(this.outbox.length ? 30 : 120);
    }
    this.emit();
  };

  private flushFired = () => {
    this.flushTimer = 0;
    void this.flush();
  };

  /** Sends within `delay` ms (sooner if it's already due sooner). */
  private scheduleFlush(delay: number) {
    if (this.stopped) return;
    const due = Date.now() + delay;
    if (this.flushTimer && this.flushDue <= due) return;
    window.clearTimeout(this.flushTimer);
    this.flushDue = due;
    this.flushTimer = window.setTimeout(this.flushFired, delay);
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
    this.firstUnsent = 0;
    this.flushing = true;
    this.inflight = doc;
    try {
      const entry = await sealBytes(this.key, encodeFrame(doc, aw));
      // (typing away on your own, each save also says who's arrived — but a last save as you
      // leave doesn't put you back on the list)
      const asked = final || keepalive ? undefined : this.hereParams();
      const res = await pushDoc(this.shareId, this.token, { client: this.doc.clientID, since: this.seq, entry, ...(asked ? { here: asked } : {}) }, { keepalive });
      this.inflight = null;
      this.failures = 0;
      if (res.assigned == null) {
        // We were too far behind to append; catch up (below) and send again.
        if (doc) this.unsend(doc);
        if (aw) this.awDirty = true;
        this.again = true;
      }
      if (!this.stopped) {
        await this.apply(res, asked);
        this.setStatus("live");
        this.scheduleSave();
        void this.maybeCompact();
      }
    } catch (err) {
      this.inflight = null;
      if (doc) this.unsend(doc);
      if (aw) this.awDirty = true;
      this.fail(err);
    } finally {
      this.flushing = false;
      if (!this.stopped) {
        if (this.failures) {
          if (this.outbox.length || this.awDirty) this.scheduleFlush(this.backoff());
        } else if (this.again || this.awDirty) {
          this.scheduleFlush(30);
        } else if (this.outbox.length) {
          this.sendSoon();
        }
        this.again = false;
      }
    }
  }

  /** A change that didn't make it goes back to the front of the queue. */
  private unsend(doc: Uint8Array) {
    this.outbox.unshift(doc);
    if (!this.firstUnsent) this.firstUnsent = Date.now();
  }

  // ── server → local ─────────────────────────────────────────────────────────

  private schedulePoll(delay?: number) {
    if (this.stopped) return;
    window.clearTimeout(this.pollTimer);
    this.pollTimer = 0;
    if (document.hidden || this.status === "gone" || this.status === "missing" || this.status === "denied") return;
    const every = this.interval();
    // (nothing to keep up with: no timer at all, until something changes that)
    if (delay == null && !Number.isFinite(every)) return;
    // Cadence is measured from when the last poll started, so slow round trips don't add up.
    const wait = delay ?? Math.max(0, every - (Date.now() - this.pollStarted));
    this.pollTimer = window.setTimeout(() => void this.poll(), wait);
  }

  private quietFor() {
    return Date.now() - Math.max(lastInputAt(), this.lastLocal, this.lastRemote);
  }

  private asleep() {
    return this.quietFor() > ASLEEP_AFTER;
  }

  /** How long to wait before asking again — fast only while someone else is here. */
  private interval() {
    if (this.failures) return this.backoff();
    const now = Date.now();
    const quiet = this.quietFor();
    const others = this.othersHere();
    if (!this.bound) {
      // Not open on screen (the owner's other shared notes): nothing to keep up with — unless
      // someone's in it, whose words should reach the note (for search and the sidebar).
      if (quiet > ASLEEP_AFTER) return Infinity;
      return others > 0 || now - this.othersSeen < 120_000 ? 60_000 : Infinity;
    }
    if (quiet > AWAY_AFTER) return Infinity;
    if (others > 0) {
      if (quiet > ASLEEP_AFTER) return 30_000;
      if (quiet > IDLE_AFTER) return 4_000;
      return now - Math.max(this.lastLocal, this.lastRemote) < 8_000 ? 300 : 1_000;
    }
    // Nobody else here: just enough to see someone arrive.
    if (now < this.expectUntil && quiet < IDLE_AFTER) return 5_000;
    return quiet > IDLE_AFTER ? 60_000 : 30_000;
  }

  private async poll() {
    this.pollTimer = 0;
    if (this.stopped || this.polling) return;
    this.polling = true;
    this.pollStarted = Date.now();
    let asked: HereParams | undefined;
    try {
      if (!this.card && this.sealing) await this.sealing;
      let res: DocCatchUp;
      let first = true;
      do {
        // (who's here: asked once per check-in, not on every page of a long catch-up)
        const here = first ? this.hereParams() : undefined;
        if (first) asked = here;
        res = await fetchDoc(this.shareId, this.seq, this.token, here);
        if (this.stopped) return;
        await this.apply(res, here);
        first = false;
      } while (res.more);
      this.failures = 0;
      this.setStatus("live");
      if (this.outbox.length || this.awDirty) this.scheduleFlush(30);
      void this.maybeCompact();
    } catch (err) {
      this.fail(err);
    } finally {
      this.polling = false;
      // The server wants our card (we're new, or we were away a while): send it straight away.
      if (!this.stopped && !this.failures && this.present() && !this.cardSent && this.card && !asked?.card) this.schedulePoll(80);
      else this.schedulePoll();
    }
  }

  private async apply(res: DocCatchUp, asked?: HereParams) {
    const sealed = [...(res.snap ? [{ ...res.snap, c: -1, at: undefined as number | undefined }] : []), ...res.entries];
    const now = res.now;
    const opened = await Promise.all(
      sealed.map(async (e) => {
        try {
          return { c: e.c, at: e.at, ...decodeFrame(await openBytes(this.key, e)) };
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
      // (an old "I'm here" from someone long gone, met while catching up, isn't news)
      const fresh = part.at == null || now == null || now - part.at < STALE_AWARENESS;
      if (part.aw && part.c !== this.doc.clientID && fresh) {
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
    const role = this.owner ? "owner" : res.role === "edit" || res.role === "view" ? res.role : res.editable ? "edit" : "view";
    const editableChanged = this.editable !== res.editable || this.role !== role;
    this.editable = res.editable;
    this.role = role;
    this.upto = res.upto;
    this.seq = Math.max(this.seq, res.seq);
    if (typeof res.pending === "number" && res.pending !== this.pending) {
      this.pending = res.pending;
      this.emit();
    }
    await this.applyHere(res, asked);
    if (!this.synced) {
      this.synced = true;
      this.emit();
    } else if (editableChanged || docs.length) this.emit();
    this.notice();
  }

  private fail(err: unknown) {
    if (err instanceof ApiError) {
      if (err.code === "read_only") {
        this.role = "view";
        this.emit();
        return;
      }
      if (err.code === "removed" || err.code === "restricted" || err.code === "pending") {
        this.denied = err.code;
        this.setStatus("denied");
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
      // (still on the list for a minute and a half — a quick look at another tab isn't leaving)
      this.setHere(false);
      void this.flush();
      window.clearTimeout(this.pollTimer);
      this.pollTimer = 0;
    } else {
      if (this.bound) this.setHere(true);
      this.schedulePoll(this.bound ? 0 : undefined);
    }
  };

  private onPageHide = () => {
    this.setHere(false);
    this.leave(true);
    this.saveNow();
    void this.flush({ keepalive: true });
  };

  private onOnline = () => {
    this.failures = 0;
    this.schedulePoll(this.bound ? 0 : undefined);
    if (this.outbox.length) this.scheduleFlush(50);
  };
}
