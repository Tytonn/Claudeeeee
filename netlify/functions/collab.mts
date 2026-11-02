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
 *
 *   GET   /api/shares/:id/doc?since=n   → what's new after entry n (or a snapshot to catch up)
 *   POST  /api/shares/:id/doc           append an update and/or a compacted snapshot (writers)
 *   PUT   /api/shares/:id/doc           start the log for a share (owner only)
 *   PATCH /api/shares/:id/doc           let friends edit, or not (owner only)
 */
import { getStore } from "@netlify/blobs";
import type { Config, Context } from "@netlify/functions";

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

/** Who's asking: the owner, an editor holding the full link, or (when editing is off) nobody. */
async function role(req: Request, head: Head): Promise<"owner" | "editor"> {
  const hash = await sha256(bearer(req));
  if (safeEqual(hash, head.ownerHash)) return "owner";
  if (safeEqual(hash, head.writeHash)) {
    if (!head.editable) throw new HttpError(403, "read_only");
    return "editor";
  }
  throw new HttpError(403, "forbidden");
}

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

const wire = (e: Found) => ({ n: e.n, iv: e.iv, data: e.data, c: e.c });

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

export default async (req: Request, context: Context): Promise<Response> => {
  const store = getStore({ name: STORE_NAME, consistency: "strong" });
  const id = context.params?.id ?? "";
  if (!ID_RE.test(id)) return json({ error: "not_found" }, 404);
  const k = K(id);

  try {
    switch (req.method) {
      // ── Catch up ────────────────────────────────────────────────────────────
      case "GET": {
        const raw = Number(new URL(req.url).searchParams.get("since") ?? "-1");
        const since = Number.isSafeInteger(raw) && raw >= -1 ? raw : -1;
        const [head, first] = await Promise.all([
          store.get(k.head, { type: "json" }) as Promise<Head | null>,
          probe(store, id, Math.max(since, 0), FIRST_WINDOW),
        ]);
        if (!head) return json({ error: "no_doc" }, 404);
        return json(await catchUp(store, id, head, since, first));
      }

      // ── Append an update (and/or a compacted snapshot) ─────────────────────
      case "POST": {
        const body = await readJson(req, MAX_SNAP + MAX_ENTRY + 4_000);
        const known = typeof body.since === "number" && Number.isSafeInteger(body.since) && body.since >= -1 ? body.since : -1;
        const [head, first] = await Promise.all([
          store.get(k.head, { type: "json" }) as Promise<Head | null>,
          probe(store, id, Math.max(known, 0), FIRST_WINDOW),
        ]);
        if (!head) return json({ error: "no_doc" }, 404);
        await role(req, head);
        const c = clientId(body.client);
        // What this writer hasn't seen yet — it goes back in the response either way.
        const caught = await catchUp(store, id, head, known, first);
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

        return json({ ...caught, assigned }, assigned ? 201 : 200);
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
        if (!first.modified) return json({ error: "exists" }, 409);
        return json({ seq: 1, upto: 0, editable: head.editable }, 201);
      }

      // ── Editing on/off (owner) ──────────────────────────────────────────────
      case "PATCH": {
        const body = await readJson(req, 2_000);
        const head = (await store.get(k.head, { type: "json" })) as Head | null;
        if (!head) return json({ error: "no_doc" }, 404);
        if ((await role(req, head)) !== "owner") throw new HttpError(403, "forbidden");
        const editable = body.editable !== false;
        const next = await updateHead(store, id, (h) => (h.editable === editable ? null : { ...h, editable, updatedAt: Date.now() }));
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
