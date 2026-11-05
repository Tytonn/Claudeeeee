/**
 * Live co-editing for shared notes — runs on Netlify Functions, stores data in Netlify Blobs.
 *
 * Every change anyone makes to a shared note is a small Yjs update, encrypted in the
 * browser with the link's key (which never reaches this server). This function only
 * keeps an ordered log of those sealed updates, so everyone can catch up on what they
 * haven't seen yet. Browsers merge the updates themselves (CRDT), which is what lets
 * two people type in the same sentence at once without clobbering each other.
 *
 * Blobs layout (store "umbra-shares", next to the share records):
 *   doc/<id>/head     { seq hint, upto, who may write }      — tiny, read on every request
 *   doc/<id>/u/<n>    one sealed update (n = 1, 2, 3 … no gaps), claimed with onlyIfNew
 *   doc/<id>/snap     a sealed snapshot of the whole document covering entries ≤ upto
 *   doc/<id>/here     who has the note open right now (see "Who's here" below)
 *
 *   GET   /api/shares/:id/doc?since=n   → what's new after entry n (or a snapshot to catch up)
 *           …&hv=v          and who's here, if that's changed since version v
 *           …&c=n&k=k       and you're here too (client n, card version k)
 *           …&card=iv.data  (your card, when the server asks for it: "you" came back false)
 *   POST  /api/shares/:id/doc           append an update and/or a compacted snapshot (writers);
 *                                       { here: { c, k, hv, card? } } as above · { bye: c } you've gone
 *   PUT   /api/shares/:id/doc           start the log for a share (owner only)
 *   PATCH /api/shares/:id/doc           let friends edit, or not (owner only)
 */
import { getStore } from "@netlify/blobs";
import type { Config, Context } from "@netlify/functions";
import { type Acl, aclKey, bearer as optionalBearer, readAcl, resolveAccess } from "../lib/common";

type Store = ReturnType<typeof getStore>;

const STORE_NAME = "umbra-shares";
const ID_RE = /^[A-Za-z0-9]{8,32}$/;
const B64URL_RE = /^[A-Za-z0-9_-]+$/;
const HASH_RE = /^[A-Za-z0-9_-]{43}$/;
const MAX_ENTRY = 1_000_000; // base64url chars (~750 KB of ciphertext)
const MAX_SNAP = 3_500_000; // ~2.6 MB — request bodies on Netlify Functions top out at 6 MB
const MAX_BATCH = 96; // entries returned per response; the client asks again for more
const MAX_RESPONSE = 2_500_000; // keep responses well under the 6 MB function limit
const FIRST_WINDOW = 3;
const NEXT_WINDOW = 16;

type Head = {
  v: 1;
  /** A lower bound on the newest entry (entries are found by probing past it). */
  seq: number;
  /** The snapshot covers every entry ≤ upto (0 = no snapshot yet). */
  upto: number;
  /** sha256 of the token derived from the link's key: anyone holding the full link can edit. */
  writeHash: string;
  /** sha256 of the owner's private token. */
  ownerHash: string;
  editable: boolean;
  /** Entries ≤ swept have been deleted (they're inside an older snapshot). */
  swept?: number;
  createdAt: number;
  updatedAt: number;
};
type Entry = { iv: string; data: string; c: number; at: number };
type Snap = { upto: number; iv: string; data: string; at: number };
type Sealed = { iv: string; data: string };

// ── Who's here ───────────────────────────────────────────────────────────────
// Everyone with the note open says so as they catch up — no extra requests — and stays on the
// list for a minute and a half after they last did. Each brings a little card: their colour and
// picture, sealed with the link's key like everything else (this server can't read it). The
// name beside it is the server's own word, so nobody can pass as somebody else: a signed-in
// person's username, or none at all (a guest — or the owner, who's marked as such).
type Here = { c: number; at: number; k: number; iv: string; data: string; r: "owner" | "edit" | "view"; u?: string };
type HereSet = { v: 1; people: Record<string, Here> };
/** What someone asks of the list: to be on it (c, k, maybe their card), and/or to see it (hv). */
type HereAsk = { c: number | null; k: number; hv: string | null; card: Sealed | null };
const HERE_TTL = 90_000;
/** Checking in more often than this doesn't rewrite the list (the clock only needs to be roughly right). */
const HERE_REFRESH = 20_000;
const HERE_MAX = 40;
const MAX_CARD = 2_000;

class HttpError extends Error {
  constructor(
    public status: number,
    public code: string,
  ) {
    super(code);
  }
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });

const K = (id: string) => ({
  head: `doc/${id}/head`,
  snap: `doc/${id}/snap`,
  here: `doc/${id}/here`,
  entry: (n: number) => `doc/${id}/u/${n}`,
  prefix: `doc/${id}/`,
});

function toB64Url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function sha256(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return toB64Url(new Uint8Array(digest));
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function bearer(req: Request): string {
  const match = /^Bearer\s+([A-Za-z0-9_-]{20,128})$/.exec((req.headers.get("authorization") ?? "").trim());
  if (!match) throw new HttpError(401, "unauthorized");
  return match[1];
}

async function readJson(req: Request, limit: number): Promise<Record<string, unknown>> {
  const text = await req.text();
  if (text.length > limit) throw new HttpError(413, "too_large");
  try {
    const body = JSON.parse(text);
    if (!body || typeof body !== "object") throw new Error();
    return body as Record<string, unknown>;
  } catch {
    throw new HttpError(400, "bad_json");
  }
}

function sealed(raw: unknown, max: number): Sealed {
  const { iv, data } = (raw ?? {}) as Record<string, unknown>;
  if (typeof iv !== "string" || iv.length < 12 || iv.length > 32 || !B64URL_RE.test(iv)) throw new HttpError(400, "bad_iv");
  if (typeof data !== "string" || data.length < 16 || data.length > max || !B64URL_RE.test(data)) throw new HttpError(400, "bad_data");
  return { iv, data };
}

const clientId = (raw: unknown) => (typeof raw === "number" && Number.isSafeInteger(raw) && raw >= 0 ? raw : 0);

/**
 * What this request may do: the owner; people on the access list (removed people get
 * nothing); everyone else per the link. Writing also needs proof of the link itself —
 * the token derived from its key — so knowing a share's id alone is never enough.
 */
async function access(req: Request, head: Head, acl: Acl | null, write: boolean) {
  const a = await resolveAccess(req, acl, head.ownerHash, head.editable === false ? "view" : "edit");
  if (!a.role) throw new HttpError(403, a.reason ?? "forbidden");
  if (!write || a.role === "owner") return a;
  const token = optionalBearer(req);
  if (!token || !safeEqual(await sha256(token), head.writeHash)) throw new HttpError(403, "forbidden");
  if (a.role !== "edit") throw new HttpError(403, "read_only");
  return a;
}

/** What goes back with every catch-up: the link's setting, and what *you* may do. */
const rights = (head: Head, acl: Acl | null, role: string) => ({
  editable: acl ? acl.linkRole === "edit" : head.editable,
  role,
});

/** Read-modify-write on the head with optimistic concurrency. `fn` returns null for "no change". */
async function updateHead(store: Store, id: string, fn: (h: Head) => Head | null): Promise<Head> {
  for (let attempt = 0; attempt < 8; attempt++) {
    const cur = await store.getWithMetadata(K(id).head, { type: "json" });
    if (!cur) throw new HttpError(404, "no_doc");
    const next = fn(cur.data as Head);
    if (!next) return cur.data as Head;
    const res = cur.etag ? await store.setJSON(K(id).head, next, { onlyIfMatch: cur.etag }) : await store.setJSON(K(id).head, next);
    if (res.modified) return next;
  }
  throw new HttpError(409, "busy");
}

type Found = Entry & { n: number };
type Probe = { from: number; ns: number[]; got: (Entry | null)[] };

/** Reads the next few entry slots after `from` in parallel (entries have no gaps). */
async function probe(store: Store, id: string, from: number, count: number): Promise<Probe> {
  const ns = Array.from({ length: count }, (_, i) => from + 1 + i);
  const got = await Promise.all(ns.map((n) => store.get(K(id).entry(n), { type: "json" }) as Promise<Entry | null>));
  return { from, ns, got };
}

/**
 * Entries after `from`, in order, up to the first missing slot (the end). `first` lets a
 * caller start the first probe in parallel with other reads, saving a round trip.
 */
async function readEntries(store: Store, id: string, from: number, budget: number, first?: Probe) {
  const out: Found[] = [];
  let size = 0;
  let window = first && first.from === from ? first : await probe(store, id, from, FIRST_WINDOW);
  for (;;) {
    for (let i = 0; i < window.got.length; i++) {
      const e = window.got[i];
      if (!e) return { entries: out, more: false };
      size += e.data.length;
      if (out.length >= MAX_BATCH || (out.length && size > budget)) return { entries: out, more: true };
      out.push({ ...e, n: window.ns[i] });
    }
    window = await probe(store, id, window.ns[window.ns.length - 1], NEXT_WINDOW);
  }
}

/** (`at`: when the server took it in — so a page catching up can tell an old "I'm here" from a fresh one) */
const wire = (e: Found) => ({ n: e.n, iv: e.iv, data: e.data, c: e.c, at: e.at });

/** Everything a client needs to catch up from entry `since` (-1 = from scratch). */
async function catchUp(store: Store, id: string, head: Head, since: number, first?: Probe) {
  let snap: Snap | null = null;
  let from = Math.max(since, 0);
  if (since < head.upto) {
    snap = (await store.get(K(id).snap, { type: "json" })) as Snap | null;
    if (!snap && head.upto > 0) throw new HttpError(503, "snapshot_missing");
    from = snap ? snap.upto : from;
  }
  const { entries, more } = await readEntries(store, id, from, MAX_RESPONSE - (snap?.data.length ?? 0), first);
  return {
    seq: entries.length ? entries[entries.length - 1].n : Math.max(from, since),
    upto: head.upto,
    editable: head.editable,
    snap: snap ? { upto: snap.upto, iv: snap.iv, data: snap.data } : null,
    entries: entries.map(wire),
    more,
  };
}

// ── Who's here (see the top) ────────────────────────────────────────────────

function parseCard(raw: string | null): Sealed | null {
  if (!raw) return null;
  const dot = raw.indexOf(".");
  if (dot < 0) throw new HttpError(400, "bad_card");
  return sealed({ iv: raw.slice(0, dot), data: raw.slice(dot + 1) }, MAX_CARD);
}

/** What a request asks of the list — from the query (GET) or a body's `here` (POST). Null: nothing. */
function hereAsk(raw: { c?: unknown; k?: unknown; hv?: unknown; card?: unknown }): HereAsk | null {
  const c = raw.c == null || raw.c === "" ? null : clientId(Number(raw.c));
  const hv = typeof raw.hv === "string" && raw.hv.length <= 32 ? raw.hv : null;
  if (c === null && hv === null) return null;
  const k = Number(raw.k);
  let card: Sealed | null = null;
  try {
    card = typeof raw.card === "string" ? parseCard(raw.card) : raw.card && typeof raw.card === "object" ? sealed(raw.card, MAX_CARD) : null;
  } catch {
    /* a card that isn't one: catch up all the same, just without it */
  }
  return { c, k: Number.isSafeInteger(k) && k >= 0 ? k : 0, hv, card };
}

/** A short fingerprint of who's on the list (not when they last checked in): it changes when someone comes or goes. */
function hereVersion(people: Record<string, Here>): string {
  let h = 0x811c9dc5;
  const line = Object.values(people)
    .map((p) => `${p.c}:${p.k}:${p.r}:${p.u ?? ""}`)
    .sort()
    .join("|");
  for (let i = 0; i < line.length; i++) {
    h ^= line.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `${Object.keys(people).length}.${h.toString(36)}`;
}

type HereRead = { data: unknown; etag?: string } | null;
const readHere = (store: Store, id: string) => store.getWithMetadata(K(id).here, { type: "json" }) as Promise<HereRead>;

/**
 * Puts the asker on the list (or keeps them there), and hands back who's here when that's
 * changed since the version they have. Best effort: a list that can't be written this moment
 * is simply written next time.
 */
async function presence(store: Store, id: string, ask: HereAsk | null, role: Here["r"], username: string | null, pre: HereRead) {
  if (!ask) return undefined;
  let cur = pre;
  for (let attempt = 0; attempt < 4; attempt++) {
    const now = Date.now();
    const was = (cur?.data as HereSet | null)?.people ?? {};
    const people: Record<string, Here> = {};
    let pruned = false;
    for (const [key, p] of Object.entries(was)) {
      if (p && typeof p === "object" && now - p.at < HERE_TTL) people[key] = p;
      else pruned = true;
    }
    let you = false;
    let changed = false;
    if (ask.c !== null) {
      const key = String(ask.c);
      const mine = people[key];
      const who = username ? { u: username } : {};
      if (ask.card) {
        people[key] = { c: ask.c, at: now, k: ask.k, iv: ask.card.iv, data: ask.card.data, r: role, ...who };
        you = changed = true;
      } else if (mine && mine.k === ask.k) {
        you = true;
        if (now - mine.at > HERE_REFRESH || mine.r !== role || (mine.u ?? null) !== username) {
          const { u: _u, ...rest } = mine;
          people[key] = { ...rest, at: now, r: role, ...who };
          changed = true;
        }
      }
      // (a list can't grow without end: the longest-quiet go first)
      const keys = Object.keys(people);
      if (keys.length > HERE_MAX) {
        for (const k of keys.sort((a, b) => people[a].at - people[b].at).slice(0, keys.length - HERE_MAX)) if (k !== key) delete people[k];
      }
    }
    if (changed || (pruned && ask.c !== null && you)) {
      const next: HereSet = { v: 1, people };
      // (a list nobody has written yet is claimed; one we read is replaced only if it's still the one we read)
      const res = !cur
        ? await store.setJSON(K(id).here, next, { onlyIfNew: true })
        : cur.etag
          ? await store.setJSON(K(id).here, next, { onlyIfMatch: cur.etag })
          : await store.setJSON(K(id).here, next);
      if (!res.modified) {
        // someone else checked in at the same moment: read theirs and try again
        cur = await readHere(store, id).catch(() => null);
        continue;
      }
    }
    const v = hereVersion(people);
    return {
      v,
      you,
      ...(ask.hv === v
        ? {}
        : {
            people: Object.values(people)
              .filter((p) => p.c !== ask.c)
              .map((p) => ({ c: p.c, k: p.k, iv: p.iv, data: p.data, r: p.r, ...(p.u ? { u: p.u } : {}) })),
          }),
    };
  }
  return undefined;
}

/** Leaving: off the list at once (rather than a minute and a half later). */
async function leave(store: Store, id: string, c: number) {
  let cur = await readHere(store, id).catch(() => null);
  for (let attempt = 0; attempt < 4 && cur; attempt++) {
    const people = { ...((cur.data as HereSet | null)?.people ?? {}) };
    if (!people[String(c)]) return;
    delete people[String(c)];
    const next: HereSet = { v: 1, people };
    const res = cur.etag ? await store.setJSON(K(id).here, next, { onlyIfMatch: cur.etag }) : await store.setJSON(K(id).here, next);
    if (res.modified) return;
    cur = await readHere(store, id).catch(() => null);
  }
}

/** For the owner of a private link: how many people are waiting to be let in (rides along with catching up). */
const pendingFor = (role: string, acl: Acl | null) =>
  role === "owner" && acl?.mode === "restricted" ? { pending: Object.values(acl.members ?? {}).filter((m) => m?.role === "pending").length } : {};

export default async (req: Request, context: Context): Promise<Response> => {
  const store = getStore({ name: STORE_NAME, consistency: "strong" });
  const id = context.params?.id ?? "";
  if (!ID_RE.test(id)) return json({ error: "not_found" }, 404);
  const k = K(id);

  try {
    switch (req.method) {
      // ── Catch up ────────────────────────────────────────────────────────────
      case "GET": {
        const q = new URL(req.url).searchParams;
        const raw = Number(q.get("since") ?? "-1");
        const since = Number.isSafeInteger(raw) && raw >= -1 ? raw : -1;
        const ask = hereAsk({ c: q.get("c"), k: q.get("k"), hv: q.get("hv"), card: q.get("card") });
        const [head, acl, first, here] = await Promise.all([
          store.get(k.head, { type: "json" }) as Promise<Head | null>,
          readAcl(store, id),
          probe(store, id, Math.max(since, 0), FIRST_WINDOW),
          ask ? readHere(store, id).catch(() => null) : Promise.resolve(null),
        ]);
        if (!head) return json({ error: "no_doc" }, 404);
        const a = await access(req, head, acl, false);
        const [caught, who] = await Promise.all([
          catchUp(store, id, head, since, first),
          presence(store, id, ask, a.role!, a.session?.username ?? null, here).catch(() => undefined),
        ]);
        return json({ ...caught, ...rights(head, acl, a.role!), ...pendingFor(a.role!, acl), ...(who ? { here: who } : {}), now: Date.now() });
      }

      // ── Append an update (and/or a compacted snapshot) ─────────────────────
      case "POST": {
        const body = await readJson(req, MAX_SNAP + MAX_ENTRY + 4_000);
        if (body.bye != null && !body.entry && !body.snap) {
          // Leaving (anyone who may open it — viewers too): off the list now.
          const [head, acl] = await Promise.all([store.get(k.head, { type: "json" }) as Promise<Head | null>, readAcl(store, id)]);
          if (!head) return json({ error: "no_doc" }, 404);
          await access(req, head, acl, false);
          await leave(store, id, clientId(Number(body.bye))).catch(() => {});
          return new Response(null, { status: 204, headers: { "cache-control": "no-store" } });
        }
        const known = typeof body.since === "number" && Number.isSafeInteger(body.since) && body.since >= -1 ? body.since : -1;
        const ask = body.here && typeof body.here === "object" ? hereAsk(body.here as Record<string, unknown>) : null;
        const [head, acl, first, here] = await Promise.all([
          store.get(k.head, { type: "json" }) as Promise<Head | null>,
          readAcl(store, id),
          probe(store, id, Math.max(known, 0), FIRST_WINDOW),
          ask ? readHere(store, id).catch(() => null) : Promise.resolve(null),
        ]);
        if (!head) return json({ error: "no_doc" }, 404);
        const a = await access(req, head, acl, true);
        const c = clientId(body.client);
        // What this writer hasn't seen yet — it goes back in the response either way (and,
        // for someone typing away on their own, who's arrived since).
        const [caught, who] = await Promise.all([
          catchUp(store, id, head, known, first),
          presence(store, id, ask, a.role!, a.session?.username ?? null, here).catch(() => undefined),
        ]);
        let assigned: number | null = null;

        if (body.entry && !caught.more) {
          const entry = sealed(body.entry, MAX_ENTRY);
          const record: Entry = { ...entry, c, at: Date.now() };
          // Append at the end. Slots are created atomically, so if someone else got there
          // first we hand their entry back too and take the next one.
          let n = Math.max(caught.seq, head.upto) + 1;
          for (let attempt = 0; attempt < 24 && assigned === null; attempt++, n++) {
            const res = await store.setJSON(k.entry(n), record, { onlyIfNew: true });
            if (res.modified) assigned = n;
            else {
              const theirs = (await store.get(k.entry(n), { type: "json" })) as Entry | null;
              if (theirs) caught.entries.push(wire({ ...theirs, n }));
            }
          }
          if (assigned === null) throw new HttpError(503, "busy");
          caught.seq = assigned;
          // Keep the head's hint roughly current so catching up from scratch stays short.
          if (assigned - head.seq >= 24) {
            const at = assigned;
            await updateHead(store, id, (h) => (h.seq >= at ? null : { ...h, seq: at, updatedAt: Date.now() })).catch(() => {});
          }
        } else if (body.entry) {
          sealed(body.entry, MAX_ENTRY); // validate; the writer resends once it has caught up
        }

        if (body.snap) {
          const s = body.snap as Record<string, unknown>;
          const upto = typeof s.upto === "number" && Number.isSafeInteger(s.upto) ? s.upto : -1;
          const snap = sealed(s, MAX_SNAP);
          if (upto > head.upto) {
            // The snapshot must only claim entries that really exist.
            const exists = await store.get(k.entry(upto), { type: "json" });
            if (exists) {
              await store.setJSON(k.snap, { upto, ...snap, at: Date.now() } satisfies Snap);
              const prevUpto = head.upto;
              const current = await updateHead(store, id, (h) => (h.upto >= upto ? null : { ...h, upto, seq: Math.max(h.seq, upto), updatedAt: Date.now() }));
              caught.upto = current.upto;
              // Entries the *previous* snapshot already covered are now safe to drop
              // (anyone mid-read of the old head still finds what they need).
              const swept = current.swept ?? 0;
              if (prevUpto > swept) {
                const doomed = Array.from({ length: prevUpto - swept }, (_, i) => k.entry(swept + i + 1));
                const sweep = (async () => {
                  for (let i = 0; i < doomed.length; i += 32) await Promise.all(doomed.slice(i, i + 32).map((key) => store.delete(key)));
                  await updateHead(store, id, (h) => ((h.swept ?? 0) >= prevUpto ? null : { ...h, swept: prevUpto }));
                })().catch(() => {});
                if (typeof context.waitUntil === "function") context.waitUntil(sweep);
                else await sweep;
              }
            }
          }
        }

        return json({ ...caught, ...rights(head, acl, a.role!), ...pendingFor(a.role!, acl), ...(who ? { here: who } : {}), now: Date.now(), assigned }, assigned ? 201 : 200);
      }

      // ── Start the log for a share (owner) ───────────────────────────────────
      case "PUT": {
        const body = await readJson(req, MAX_ENTRY + 4_000);
        const record = (await store.get(id, { type: "json" })) as { tokenHash?: string } | null;
        if (!record?.tokenHash) return json({ error: "not_found" }, 404);
        const ownerHash = await sha256(bearer(req));
        if (!safeEqual(ownerHash, record.tokenHash)) throw new HttpError(403, "forbidden");
        if (typeof body.writeHash !== "string" || !HASH_RE.test(body.writeHash)) throw new HttpError(400, "bad_write_hash");
        const entry = sealed(body.entry, MAX_ENTRY);
        const now = Date.now();

        const existing = (await store.get(k.head, { type: "json" })) as Head | null;
        if (existing) return json({ error: "exists" }, 409);
        // Entry 1 is the document as it was when sharing began. Whoever writes it first
        // defines the starting point; anyone else just catches up from it.
        const first = await store.setJSON(k.entry(1), { ...entry, c: clientId(body.client), at: now } satisfies Entry, { onlyIfNew: true });
        const head: Head = {
          v: 1,
          seq: 1,
          upto: 0,
          writeHash: body.writeHash,
          ownerHash,
          editable: body.editable !== false,
          createdAt: now,
          updatedAt: now,
        };
        await store.setJSON(k.head, head, { onlyIfNew: true });
        // Start the access list too (unless the owner's app already made one).
        const acl: Acl = { v: 1, mode: "link", linkRole: head.editable ? "edit" : "view", ownerHash, linkHash: body.writeHash, members: {}, updatedAt: now };
        await store.setJSON(aclKey(id), acl, { onlyIfNew: true });
        if (!first.modified) return json({ error: "exists" }, 409);
        return json({ seq: 1, upto: 0, editable: head.editable }, 201);
      }

      // ── Editing on/off (owner) ──────────────────────────────────────────────
      case "PATCH": {
        const body = await readJson(req, 2_000);
        const head = (await store.get(k.head, { type: "json" })) as Head | null;
        if (!head) return json({ error: "no_doc" }, 404);
        const acl = await readAcl(store, id);
        if ((await access(req, head, acl, false)).role !== "owner") throw new HttpError(403, "forbidden");
        const editable = body.editable !== false;
        const next = await updateHead(store, id, (h) => (h.editable === editable ? null : { ...h, editable, updatedAt: Date.now() }));
        if (acl && acl.linkRole !== (editable ? "edit" : "view")) {
          const cur = await store.getWithMetadata(aclKey(id), { type: "json" });
          if (cur) await store.setJSON(aclKey(id), { ...(cur.data as Acl), linkRole: editable ? "edit" : "view", updatedAt: Date.now() }, cur.etag ? { onlyIfMatch: cur.etag } : {}).catch(() => {});
        }
        return json({ editable: next.editable });
      }

      default:
        return json({ error: "method_not_allowed" }, 405);
    }
  } catch (error) {
    if (error instanceof HttpError) return json({ error: error.code }, error.status);
    console.error("collab function error", error);
    return json({ error: "server_error" }, 500);
  }
};

export const config: Config = {
  path: "/api/shares/:id/doc",
  method: ["GET", "POST", "PUT", "PATCH"],
};
