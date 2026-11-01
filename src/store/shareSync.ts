import { create } from "zustand";
import { useApp, type AppState } from "./app";
import { toast } from "./toasts";
import { isApplyingRemote, storageOk } from "./persist";
import { fingerprint, newShareKey, seal } from "../lib/crypto";
import { ApiError, createShare, deleteShare, updateShare } from "../lib/api";
import type { ShareRecord, SharePayload } from "../lib/types";

export const BOARD = "board";

export type ShareStatus = "idle" | "syncing" | "error";
export const useShareStatus = create<Record<string, ShareStatus>>(() => ({}));

export function shareUrl(r: Pick<ShareRecord, "id" | "key">): string {
  return `${location.origin}/s/${r.id}#${r.key}`;
}

/** Only the share function itself can say a link is gone — not an HTML 404 from the host. */
const isGone = (err: unknown) => err instanceof ApiError && (err.code === "not_found" || err.code === "forbidden");

export function buildPayload(
  anchor: string,
  includes: Pick<ShareRecord, "includeTodos" | "includeCountdowns">,
  s: AppState = useApp.getState(),
): SharePayload | null {
  const payload: SharePayload = { v: 1, sharedAt: Date.now() };
  const from = s.settings.name.trim();
  if (from) payload.from = from.slice(0, 60);
  if (anchor !== BOARD) {
    const note = s.notes[anchor];
    if (!note || note.deletedAt) return null;
    payload.note = { title: note.title, doc: note.doc, text: note.text, updatedAt: note.updatedAt };
  }
  if (includes.includeTodos) payload.todos = s.todos.map((t) => ({ text: t.text, done: t.done }));
  if (includes.includeCountdowns) {
    payload.countdowns = s.countdowns.map((c) => ({ title: c.title, date: c.date, time: c.time ?? null, repeat: c.repeat ?? null, createdAt: c.createdAt }));
  }
  if (!payload.note && !payload.todos && !payload.countdowns) return null;
  return payload;
}

const hashOf = (p: SharePayload) => fingerprint({ ...p, sharedAt: 0 });

export async function startShare(anchor: string, includes: Pick<ShareRecord, "includeTodos" | "includeCountdowns">): Promise<ShareRecord> {
  const payload = buildPayload(anchor, includes);
  if (!payload) throw new Error("Nothing to share yet.");
  const key = newShareKey();
  const envelope = await seal(key, payload);
  const created = await createShare(envelope);
  const record: ShareRecord = {
    anchor,
    id: created.id,
    token: created.token,
    key,
    includeTodos: includes.includeTodos,
    includeCountdowns: includes.includeCountdowns,
    createdAt: Date.now(),
    pushedAt: Date.now(),
    hash: hashOf(payload),
    rev: created.rev,
  };
  useApp.getState().putShare(record);
  return record;
}

/** Revokes a link on the server, then forgets it locally (only once the server agrees). */
export async function stopShare(anchor: string): Promise<void> {
  const record = useApp.getState().shares[anchor];
  if (!record) return;
  try {
    await deleteShare(record.id, record.token);
  } catch (err) {
    if (!isGone(err)) throw err; // offline / no backend: keep the record so we can retry
  }
  if (useApp.getState().shares[anchor]?.id === record.id) useApp.getState().dropShare(anchor);
  useShareStatus.setState({ [anchor]: "idle" });
}

/** Links whose note no longer exists at all (deleted forever, or expired from trash). */
function orphans(s: AppState = useApp.getState()): string[] {
  return Object.keys(s.shares).filter((anchor) => anchor !== BOARD && !s.notes[anchor]);
}

const revoking = new Set<string>();
function revokeOrphans() {
  if (!storageOk) return; // never act on a partial picture of your data
  for (const anchor of orphans()) {
    if (revoking.has(anchor)) continue;
    revoking.add(anchor);
    void stopShare(anchor)
      .catch(() => {
        /* retried on next start / reconnect */
      })
      .finally(() => revoking.delete(anchor));
  }
}

/** Keeps every live link up to date as you edit (debounced, encrypted, serialized per link). */
export function startShareSync() {
  const timers = new Map<string, number>();
  const running = new Set<string>();
  const again = new Set<string>();
  const backoff = new Map<string, number>();

  const push = async (anchor: string) => {
    if (running.has(anchor)) {
      again.add(anchor);
      return;
    }
    const state = useApp.getState();
    const record = state.shares[anchor];
    if (!record) return;
    const payload = buildPayload(anchor, record, state);
    if (!payload) return;
    const hash = hashOf(payload);
    if (hash === record.hash) return;

    running.add(anchor);
    useShareStatus.setState({ [anchor]: "syncing" });
    // Only touch the record we pushed — the link may have been stopped/recreated meanwhile.
    const stillCurrent = () => useApp.getState().shares[anchor]?.id === record.id;
    try {
      const envelope = await seal(record.key, payload);
      const res = await updateShare(record.id, record.token, envelope);
      if (stillCurrent()) useApp.getState().patchShare(anchor, { hash, pushedAt: Date.now(), rev: res.rev });
      backoff.delete(anchor);
      useShareStatus.setState({ [anchor]: "idle" });
    } catch (err) {
      if (isGone(err)) {
        if (stillCurrent()) {
          useApp.getState().dropShare(anchor);
          toast("A shared link no longer exists, so it was removed.", { tone: "error" });
        }
        useShareStatus.setState({ [anchor]: "idle" });
      } else {
        useShareStatus.setState({ [anchor]: "error" });
        const wait = Math.min(60_000, (backoff.get(anchor) ?? 2_000) * 2);
        backoff.set(anchor, wait);
        schedule(anchor, wait);
      }
    } finally {
      running.delete(anchor);
      if (again.delete(anchor)) schedule(anchor, 300);
    }
  };

  const schedule = (anchor: string, delay = 1100) => {
    window.clearTimeout(timers.get(anchor));
    timers.set(
      anchor,
      window.setTimeout(() => {
        timers.delete(anchor);
        void push(anchor);
      }, delay),
    );
  };

  useApp.subscribe((s, prev) => {
    // Changes that arrived from another tab are pushed by that tab, not this one.
    if (!s.ready || isApplyingRemote()) return;
    const anchors = Object.keys(s.shares);
    if (!anchors.length) return;
    const nameChanged = s.settings.name !== prev.settings.name;
    for (const anchor of anchors) {
      const r = s.shares[anchor];
      const before = prev.shares[anchor];
      const relevant =
        !before || // just created: catch edits made while the link was being made
        before.id !== r.id ||
        nameChanged ||
        (anchor !== BOARD && s.notes[anchor] !== prev.notes[anchor]) ||
        (r.includeTodos && s.todos !== prev.todos) ||
        (r.includeCountdowns && s.countdowns !== prev.countdowns) ||
        before.includeTodos !== r.includeTodos ||
        before.includeCountdowns !== r.includeCountdowns;
      if (relevant) schedule(anchor);
    }
    // A shared note was deleted for good → revoke its link.
    if (s.notes !== prev.notes && orphans(s).length) revokeOrphans();
  });

  // Catch up on anything edited (or deleted) while the app was closed.
  revokeOrphans();
  for (const anchor of Object.keys(useApp.getState().shares)) schedule(anchor, 2500);

  window.addEventListener("online", () => {
    revokeOrphans();
    for (const anchor of Object.keys(useApp.getState().shares)) schedule(anchor, 500);
  });
}
