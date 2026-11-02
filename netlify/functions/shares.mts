/**
 * Share links API — runs on Netlify Functions, stores data in Netlify Blobs.
 *
 * Everything that reaches this function is already encrypted in the browser
 * (AES-GCM, key kept in the URL #fragment which browsers never send to servers),
 * so the server only ever sees ciphertext.
 *
 *   POST   /api/shares        create   → { id, token, rev }
 *   GET    /api/shares/:id    read     → { v, iv, data, rev, updatedAt }   (ETag / 304 aware)
 *   PUT    /api/shares/:id    update   (Authorization: Bearer <token>)
 *   DELETE /api/shares/:id    revoke   (Authorization: Bearer <token>) — also deletes its live doc
 *
 * The live, co-editable document for a shared note lives next to it: see collab.mts.
 */
import { getStore } from "@netlify/blobs";
import type { Config, Context } from "@netlify/functions";
import { readAcl, resolveAccess } from "../lib/common";

const STORE_NAME = "umbra-shares";
const MAX_DATA_CHARS = 4_000_000; // base64url characters (~3 MB of ciphertext)
const ID_RE = /^[A-Za-z0-9]{8,32}$/;
const B64URL_RE = /^[A-Za-z0-9_-]+$/;
const ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

type ShareRecord = {
  v: 1;
  iv: string;
  data: string;
  tokenHash: string;
  createdAt: number;
  updatedAt: number;
  rev: number;
};

class HttpError extends Error {
  constructor(
    public status: number,
    public code: string,
  ) {
    super(code);
  }
}

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...headers,
    },
  });

function randomId(length = 10): string {
  // Rejection sampling keeps the distribution uniform across the 62-char alphabet.
  let out = "";
  while (out.length < length) {
    const bytes = crypto.getRandomValues(new Uint8Array(length * 2));
    for (const b of bytes) {
      if (b < 248 && out.length < length) out += ALPHABET[b % 62];
    }
  }
  return out;
}

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
  const header = req.headers.get("authorization") ?? "";
  const match = /^Bearer\s+([A-Za-z0-9_-]{20,128})$/.exec(header.trim());
  if (!match) throw new HttpError(401, "unauthorized");
  return match[1];
}

async function readEnvelope(req: Request): Promise<{ iv: string; data: string }> {
  const text = await req.text();
  if (text.length > MAX_DATA_CHARS + 2_000) throw new HttpError(413, "too_large");
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    throw new HttpError(400, "bad_json");
  }
  const { v, iv, data } = (body ?? {}) as Record<string, unknown>;
  if (v !== 1) throw new HttpError(400, "bad_version");
  if (typeof iv !== "string" || iv.length < 12 || iv.length > 32 || !B64URL_RE.test(iv)) {
    throw new HttpError(400, "bad_iv");
  }
  if (typeof data !== "string" || data.length < 16 || data.length > MAX_DATA_CHARS || !B64URL_RE.test(data)) {
    throw new HttpError(400, "bad_data");
  }
  return { iv, data };
}

async function authorize(req: Request, record: ShareRecord): Promise<void> {
  const token = bearer(req);
  if (!safeEqual(await sha256(token), record.tokenHash)) throw new HttpError(403, "forbidden");
}

export default async (req: Request, context: Context): Promise<Response> => {
  const store = getStore({ name: STORE_NAME, consistency: "strong" });
  const id = context.params?.id;

  try {
    // ── Create ────────────────────────────────────────────────────────────
    if (!id) {
      if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405, { allow: "POST" });
      const envelope = await readEnvelope(req);
      const token = toB64Url(crypto.getRandomValues(new Uint8Array(32)));
      const tokenHash = await sha256(token);
      const now = Date.now();
      for (let attempt = 0; attempt < 5; attempt++) {
        const newId = randomId(10);
        const record: ShareRecord = { v: 1, ...envelope, tokenHash, createdAt: now, updatedAt: now, rev: 1 };
        const result = await store.setJSON(newId, record, { onlyIfNew: true });
        if (result.modified) return json({ id: newId, token, rev: 1, updatedAt: now }, 201);
      }
      return json({ error: "id_collision" }, 503);
    }

    if (!ID_RE.test(id)) return json({ error: "not_found" }, 404);

    switch (req.method) {
      // ── Read ──────────────────────────────────────────────────────────────
      case "GET": {
        const [record, acl] = await Promise.all([store.get(id, { type: "json" }) as Promise<ShareRecord | null>, readAcl(store, id)]);
        if (!record) return json({ error: "not_found" }, 404);
        if (acl) {
          // Private links, and anyone the owner removed, are turned away here.
          const access = await resolveAccess(req, acl, record.tokenHash, "view");
          if (!access.role) return json({ error: access.reason ?? "forbidden" }, 403);
        }
        const etag = `"r${record.rev}"`;
        // CDNs may hand the validator back weakened (W/"r5") once they've compressed the
        // response; treat that as the same version or every poll looks like a change.
        const ifNone = (req.headers.get("if-none-match") ?? "").split(",").map((t) => t.trim().replace(/^W\//, ""));
        if (ifNone.includes(etag)) {
          return new Response(null, { status: 304, headers: { etag, "cache-control": "no-store" } });
        }
        return json(
          { v: record.v, iv: record.iv, data: record.data, rev: record.rev, updatedAt: record.updatedAt, createdAt: record.createdAt },
          200,
          { etag },
        );
      }

      // ── Update (owner only) ───────────────────────────────────────────────
      case "PUT": {
        const envelope = await readEnvelope(req);
        for (let attempt = 0; attempt < 4; attempt++) {
          const entry = await store.getWithMetadata(id, { type: "json" });
          if (!entry) return json({ error: "not_found" }, 404);
          const record = entry.data as ShareRecord;
          await authorize(req, record);
          const next: ShareRecord = { ...record, ...envelope, updatedAt: Date.now(), rev: record.rev + 1 };
          const result = entry.etag
            ? await store.setJSON(id, next, { onlyIfMatch: entry.etag })
            : await store.setJSON(id, next);
          if (result.modified) return json({ rev: next.rev, updatedAt: next.updatedAt });
        }
        return json({ error: "conflict" }, 409);
      }

      // ── Revoke (owner only) ───────────────────────────────────────────────
      case "DELETE": {
        const record = (await store.get(id, { type: "json" })) as ShareRecord | null;
        if (!record) return new Response(null, { status: 204 });
        await authorize(req, record);
        await store.delete(id);
        // The live document (and its history) goes with it.
        const { blobs } = await store.list({ prefix: `doc/${id}/` });
        for (let i = 0; i < blobs.length; i += 32) await Promise.all(blobs.slice(i, i + 32).map((b) => store.delete(b.key)));
        return new Response(null, { status: 204 });
      }

      default:
        return json({ error: "method_not_allowed" }, 405, { allow: "GET, PUT, DELETE" });
    }
  } catch (error) {
    if (error instanceof HttpError) return json({ error: error.code }, error.status);
    console.error("shares function error", error);
    return json({ error: "server_error" }, 500);
  }
};

export const config: Config = {
  path: ["/api/shares", "/api/shares/:id"],
  method: ["GET", "POST", "PUT", "DELETE"],
};
