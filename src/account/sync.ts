import { useApp, type AppState } from "../store/app";
import { ApiError, syncPull, syncPush, type SyncItem } from "../lib/api";
import { open, seal } from "../lib/crypto";
import {
  normalizeCountdown,
  normalizeGroup,
  normalizeList,
  normalizeNote,
  normalizeSharedLink,
  normalizeShareRecord,
  normalizeTodo,
  normalizeTodoLabels,
  normalizeVault,
} from "../lib/sanitize";
import type { Countdown, Note, NoteGroup, Settings, Todo } from "../lib/types";
import { dataKey, onAccountChange, sessionExpired, useAccount, type AccountUser } from "./account";

/**
 * Keeps this device and your account in step.
 *
 * Every record (each note, the to-do list, the countdowns, your links, a few settings) is
 * sealed with your data key and stored on the server under a revision number. Local
 * changes are pushed a moment after you make them; other devices' changes are pulled
 * when you come back to the tab and every minute or so. If two devices changed the same
 * record, the newer edit wins.
 *
 * Only one tab per browser does the syncing (the others get the results through the
 * normal cross-tab updates).
 */

const SYNCED_SETTINGS = [
  "accent",
  "font",
  "titleFont",
  "size",
  "todos",
  "countdowns",
  "sounds",
  "fadeWhileTyping",
  "scene",
  "lightning",
  "cityLights",
  "rainAmount",
  "solarClouds",
  "solarSize",
  "solarLook",
  "solarTint",
  "showVersion",
  "cityBlur",
  "cursorLight",
  "clockMs",
  "clockMsDigits",
  "todoGroups",
  "todoLabels",
] as const;
type SyncedSettings = Pick<Settings, (typeof SYNCED_SETTINGS)[number]>;

type Meta = { v: 1; seq: number; revs: Record<string, number>; dirty: Record<string, number>; merged: boolean };
const metaKey = (uid: string) => `umbra:sync:${uid}`;

let user: AccountUser | null = null;
let meta: Meta | null = null;
let leader = false;
let applying = false;
let pushTimer = 0;
let pullTimer = 0;
let saveTimer = 0;
let pushing = false;
let pulling: Promise<void> | null = null;
let again = false;
let failures = 0;
let unsubscribeStore: (() => void) | null = null;

const setSync = (sync: ReturnType<typeof useAccount.getState>["sync"]) => useAccount.setState({ sync, ...(sync === "synced" ? { lastSync: Date.now() } : {}) });

function loadMeta(uid: string): Meta {
  try {
    const raw = JSON.parse(localStorage.getItem(metaKey(uid)) ?? "null");
    if (raw?.v === 1) return { v: 1, seq: raw.seq | 0, revs: raw.revs ?? {}, dirty: raw.dirty ?? {}, merged: raw.merged === true };
  } catch {
    /* start fresh */
  }
  return { v: 1, seq: 0, revs: {}, dirty: {}, merged: false };
}

function saveMeta() {
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => {
    if (!user || !meta) return;
    try {
      localStorage.setItem(metaKey(user.uid), JSON.stringify(meta));
    } catch {
      /* quota: we'll just re-sync more next time */
    }
  }, 250);
}

// ── reading and writing records ───────────────────────────────────────────

function pickSettings(s: Settings): SyncedSettings {
  const out = {} as Record<string, unknown>;
  for (const k of SYNCED_SETTINGS) out[k] = s[k];
  return out as SyncedSettings;
}

function readLocal(key: string, s: AppState = useApp.getState()): unknown {
  if (key.startsWith("note:")) return s.notes[key.slice(5)];
  if (key.startsWith("share:")) return s.shares[key.slice(6)];
  if (key.startsWith("shared:")) return s.shared[key.slice(7)];
  if (key === "todos") return s.todos;
  if (key === "countdowns") return s.countdowns;
  if (key === "groups") return s.groups;
  if (key === "vault") return s.vault ?? undefined;
  if (key === "settings") return pickSettings(s.settings);
  return undefined;
}

/** When a record was last changed, as far as "newest wins" is concerned. */
function stampOf(key: string, value: unknown): number {
  if (key.startsWith("note:") && value) return (value as Note).updatedAt || 0;
  return meta?.dirty[key] ?? 0;
}

function localKeys(s: AppState = useApp.getState()): string[] {
  return [
    ...Object.keys(s.notes).map((id) => `note:${id}`),
    ...Object.keys(s.shares).map((a) => `share:${a}`),
    ...Object.keys(s.shared).map((id) => `shared:${id}`),
    "todos",
    "countdowns",
    "groups",
    ...(s.vault ? ["vault"] : []),
    "settings",
  ];
}

type Change = { key: string; value: unknown };

/** Applies records from the server to this device (without echoing them back). */
function apply(changes: Change[]) {
  if (!changes.length) return;
  applying = true;
  try {
    useApp.setState((s) => {
      let notes = s.notes;
      let shares = s.shares;
      let shared = s.shared;
      const next: Partial<AppState> = {};
      for (const { key, value } of changes) {
        if (key.startsWith("note:")) {
          if (notes === s.notes) notes = { ...s.notes };
          const note = value ? normalizeNote(value) : null;
          if (note) notes[key.slice(5)] = note;
          else delete notes[key.slice(5)];
        } else if (key.startsWith("share:")) {
          if (shares === s.shares) shares = { ...s.shares };
          const r = value ? normalizeShareRecord(value) : null;
          if (r) shares[key.slice(6)] = r;
          else delete shares[key.slice(6)];
        } else if (key.startsWith("shared:")) {
          if (shared === s.shared) shared = { ...s.shared };
          const l = value ? normalizeSharedLink(value) : null;
          if (l) shared[key.slice(7)] = l;
          else delete shared[key.slice(7)];
        } else if (key === "todos" && value) next.todos = normalizeList(value, normalizeTodo);
        else if (key === "countdowns" && value) next.countdowns = normalizeList(value, normalizeCountdown);
        else if (key === "groups" && value) next.groups = normalizeList(value, normalizeGroup);
        else if (key === "vault") next.vault = value ? normalizeVault(value) : null;
        else if (key === "settings" && value && typeof value === "object") {
          const incoming = value as Record<string, unknown>;
          const merged = { ...(next.settings ?? s.settings) } as Record<string, unknown>;
          for (const k of SYNCED_SETTINGS) if (k in incoming && typeof incoming[k] === typeof merged[k]) merged[k] = incoming[k];
          merged.todoLabels = normalizeTodoLabels(merged.todoLabels);
          next.settings = merged as unknown as Settings;
        }
      }
      if (notes !== s.notes) next.notes = notes;
      if (shares !== s.shares) next.shares = shares;
      if (shared !== s.shared) next.shared = shared;
      // If the open note was deleted on another device, open the next one.
      if (next.notes && s.ui.activeId && !next.notes[s.ui.activeId]) {
        const fallback = Object.values(next.notes)
          .filter((n) => !n.deletedAt && (s.ui.unlocked || !n.hidden))
          .sort((a, b) => b.updatedAt - a.updatedAt)[0];
        next.ui = { ...s.ui, activeId: fallback?.id ?? null };
      }
      return next;
    });
  } finally {
    applying = false;
  }
}

// ── first sign-in on a device: merge instead of overwrite ─────────────────

const SEED_TITLE = "Welcome to umbra";
const untouchedSeed = (n: Note) => n.title === SEED_TITLE && Math.abs(n.updatedAt - n.createdAt) < 5_000;

function mergeTodos(local: Todo[], remote: Todo[]): Todo[] {
  const out = [...remote];
  const ids = new Map(remote.map((t, i) => [t.id, i]));
  const texts = new Set(remote.map((t) => t.text.trim().toLowerCase()));
  for (const t of local) {
    const i = ids.get(t.id);
    if (i !== undefined) {
      if (t.updatedAt > out[i].updatedAt) out[i] = t;
    } else if (!texts.has(t.text.trim().toLowerCase())) out.push(t);
  }
  return out;
}

function mergeCountdowns(local: Countdown[], remote: Countdown[]): Countdown[] {
  const out = [...remote];
  const ids = new Map(remote.map((c, i) => [c.id, i]));
  const same = new Set(remote.map((c) => `${c.title.trim().toLowerCase()}|${c.date}`));
  for (const c of local) {
    const i = ids.get(c.id);
    if (i !== undefined) {
      if (c.updatedAt > out[i].updatedAt) out[i] = c;
    } else if (!same.has(`${c.title.trim().toLowerCase()}|${c.date}`)) out.push(c);
  }
  return out;
}

// ── push / pull ───────────────────────────────────────────────────────────

function mark(key: string) {
  if (!meta) return;
  meta.dirty[key] = Date.now();
  saveMeta();
  schedulePush(1200);
}

function schedulePush(delay: number) {
  if (!leader || !user) return;
  window.clearTimeout(pushTimer);
  pushTimer = window.setTimeout(() => void push(), delay);
}

function schedulePull(delay = 60_000) {
  if (!leader || !user) return;
  window.clearTimeout(pullTimer);
  if (document.hidden) return;
  pullTimer = window.setTimeout(() => void pull(), delay);
}

function failed(err: unknown) {
  if (err instanceof ApiError && err.code === "signed_out") {
    sessionExpired();
    return;
  }
  failures++;
  setSync("offline");
}

async function push() {
  const dek = dataKey();
  if (!leader || !user || !meta || !dek) return;
  if (pushing) {
    again = true;
    return;
  }
  const keys = Object.keys(meta.dirty).slice(0, 80);
  if (!keys.length) return;
  pushing = true;
  setSync("syncing");
  try {
    const state = useApp.getState();
    const sent = new Map<string, number>();
    const items: Parameters<typeof syncPush>[0] = [];
    let size = 0;
    for (const key of keys) {
      const value = readLocal(key, state);
      const base = meta.revs[key] ?? 0;
      if (value === undefined) {
        if (!base) {
          delete meta.dirty[key]; // never reached the server: nothing to delete
          continue;
        }
        items.push({ key, base, at: meta.dirty[key], del: true });
      } else {
        const env = await seal(dek, value);
        size += env.data.length;
        items.push({ key, base, at: stampOf(key, value) || meta.dirty[key], iv: env.iv, data: env.data });
      }
      sent.set(key, meta.dirty[key]);
      if (size > 3_000_000) break;
    }
    if (items.length) {
      const res = await syncPush(items);
      // If nobody else wrote in between, we already know everything up to the new seq.
      if (res.seq === meta.seq + res.results.length) meta.seq = res.seq;
      for (const r of res.results) {
        meta.revs[r.key] = r.rev;
        if (meta.dirty[r.key] === sent.get(r.key)) delete meta.dirty[r.key];
      }
      // Someone else changed these first: fetch theirs, keep the newer, try again.
      if (res.conflicts.length) await pull();
    }
    saveMeta();
    failures = 0;
    setSync(Object.keys(meta.dirty).length ? "syncing" : "synced");
  } catch (err) {
    failed(err);
  } finally {
    pushing = false;
    if (meta && Object.keys(meta.dirty).length) schedulePush(again ? 300 : Math.min(60_000, 1500 * 2 ** failures));
    again = false;
  }
}

function pull(): Promise<void> {
  if (pulling) return pulling;
  pulling = (async () => {
    const dek = dataKey();
    if (!leader || !user || !meta || !dek) return;
    if (!meta.merged) setSync("syncing");
    try {
      const firstTime = !meta.merged;
      let remoteHadData = meta.seq > 0;
      let res: Awaited<ReturnType<typeof syncPull>>;
      do {
        res = await syncPull(meta.seq);
        if (res.items.length) remoteHadData = true;
        await absorb(res.items, dek, firstTime);
        meta.seq = res.seq;
      } while (res.more);
      if (firstTime) finishMerge(remoteHadData);
      saveMeta();
      failures = 0;
      setSync(Object.keys(meta.dirty).length ? "syncing" : "synced");
      if (Object.keys(meta.dirty).length) schedulePush(400);
    } catch (err) {
      failed(err);
    } finally {
      pulling = null;
      schedulePull(failures ? Math.min(120_000, 5000 * 2 ** failures) : 60_000);
    }
  })();
  return pulling;
}

/** Takes in what the server sent: newer wins where both sides changed something. */
async function absorb(items: SyncItem[], dek: string, firstTime: boolean) {
  if (!meta) return;
  const state = useApp.getState();
  const changes: Change[] = [];
  for (const item of items) {
    if (item.missing) continue;
    let value: unknown = undefined;
    if (!item.del) {
      try {
        value = await open(dek, { iv: item.iv!, data: item.data! });
      } catch {
        console.warn("Skipped a synced record that couldn't be decrypted", item.key);
        continue;
      }
    }
    meta.revs[item.key] = item.rev;
    const local = readLocal(item.key, state);

    if (firstTime && local !== undefined && value !== undefined) {
      // Both this device and the account have it: merge rather than overwrite.
      if (item.key === "todos") {
        const merged = mergeTodos(local as Todo[], normalizeList(value, normalizeTodo));
        changes.push({ key: "todos", value: merged });
        meta.dirty.todos = Date.now();
        continue;
      }
      if (item.key === "countdowns") {
        const merged = mergeCountdowns(local as Countdown[], normalizeList(value, normalizeCountdown));
        changes.push({ key: "countdowns", value: merged });
        meta.dirty.countdowns = Date.now();
        continue;
      }
      if (item.key === "groups") {
        const remote = normalizeList(value, normalizeGroup);
        const ids = new Set(remote.map((g) => g.id));
        const merged: NoteGroup[] = [...remote, ...(local as NoteGroup[]).filter((g) => !ids.has(g.id))];
        changes.push({ key: "groups", value: merged });
        meta.dirty.groups = Date.now();
        continue;
      }
      if (item.key === "vault") {
        // The account's PIN wins: it's the one your other devices already use.
        changes.push({ key: "vault", value });
        continue;
      }
      if (item.key.startsWith("note:") && (local as Note).updatedAt > ((value as Note).updatedAt ?? 0)) {
        meta.dirty[item.key] = Date.now(); // ours is newer: send it up
        continue;
      }
      changes.push({ key: item.key, value });
      continue;
    }

    if (meta.dirty[item.key] !== undefined) {
      // Changed here and there since we last synced: keep whichever is newer.
      const ours = stampOf(item.key, local);
      if (ours >= item.at) continue;
      delete meta.dirty[item.key];
    }
    changes.push({ key: item.key, value: item.del ? undefined : value });
  }
  apply(changes);
}

/** After the first pull on this device: send up anything the account doesn't have yet. */
function finishMerge(remoteHadData: boolean) {
  if (!meta) return;
  const s = useApp.getState();
  const drop: Change[] = [];
  for (const key of localKeys(s)) {
    if (meta.revs[key] !== undefined) continue;
    if (key.startsWith("note:") && remoteHadData && untouchedSeed(s.notes[key.slice(5)])) {
      // This device's untouched welcome note would just be a duplicate.
      drop.push({ key, value: undefined });
      continue;
    }
    if (key === "settings" && remoteHadData) continue;
    meta.dirty[key] = Date.now();
  }
  apply(drop);
  meta.merged = true;
}

// ── lifecycle ─────────────────────────────────────────────────────────────

function watchStore() {
  unsubscribeStore?.();
  unsubscribeStore = useApp.subscribe((s, prev) => {
    if (!user || !meta || applying || !s.ready) return;
    const diff = <T>(prefix: string, next: Record<string, T>, before: Record<string, T>) => {
      if (next === before) return;
      for (const id in next) if (next[id] !== before[id]) mark(prefix + id);
      for (const id in before) if (!(id in next)) mark(prefix + id);
    };
    diff("note:", s.notes, prev.notes);
    diff("share:", s.shares, prev.shares);
    diff("shared:", s.shared, prev.shared);
    if (s.todos !== prev.todos) mark("todos");
    if (s.countdowns !== prev.countdowns) mark("countdowns");
    if (s.groups !== prev.groups) mark("groups");
    if (s.vault !== prev.vault) mark("vault");
    if (s.settings !== prev.settings && SYNCED_SETTINGS.some((k) => s.settings[k] !== prev.settings[k])) mark("settings");
  });
}

function begin(next: AccountUser | null) {
  window.clearTimeout(pushTimer);
  window.clearTimeout(pullTimer);
  user = next;
  meta = next ? loadMeta(next.uid) : null;
  if (!next) {
    unsubscribeStore?.();
    unsubscribeStore = null;
    return;
  }
  watchStore();
  if (leader) void pull();
  else setSync("synced");
}

/** Starts syncing (in one tab per browser) whenever someone is signed in. */
export function startSync() {
  begin(useAccount.getState().user);
  onAccountChange((u) => begin(u));

  // Another tab signed in or out.
  addEventListener("storage", (e) => {
    if (e.key !== "umbra:account") return;
    const u = (() => {
      try {
        const raw = JSON.parse(e.newValue ?? "null");
        return raw?.uid ? { uid: raw.uid as string, username: raw.username as string } : null;
      } catch {
        return null;
      }
    })();
    if (u?.uid !== user?.uid) location.reload();
  });

  const lead = () => {
    leader = true;
    if (user) void pull();
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) void pull();
      else if (meta && Object.keys(meta.dirty).length) void push();
    });
    addEventListener("online", () => void pull());
    addEventListener("pagehide", () => {
      window.clearTimeout(saveTimer);
      if (user && meta) {
        try {
          localStorage.setItem(metaKey(user.uid), JSON.stringify(meta));
        } catch {
          /* ignore */
        }
      }
    });
  };
  const locks = (navigator as Navigator & { locks?: { request: (name: string, cb: () => Promise<void>) => Promise<void> } }).locks;
  if (locks?.request) void locks.request("umbra-sync", () => new Promise<void>(() => lead()));
  else lead();
}

/** Ask for a sync right now (e.g. after signing in or coming back online). */
export function syncNow() {
  void pull().then(() => push());
}
