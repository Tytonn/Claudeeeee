/**
 * Pictures in notes — kept here only as ciphertext.
 *
 * Every image is encrypted in the browser with a key of its own. That key lives inside the
 * note, which is itself end-to-end encrypted, so whoever can read the note can see its
 * pictures and nobody else can — this server included. An image's id is random and its bytes
 * never change, so downloads are cached for good (each device fetches a picture once).
 *
 *   PUT /api/images/:id   upload, once — signed in (x-umbra-session), or with a shared note's
 *                         owner or editor token (Authorization: Bearer … + x-umbra-share: <id>)
 *   GET /api/images/:id   the encrypted bytes
 */
import { getStore } from "@netlify/blobs";
import type { Config } from "@netlify/functions";
import { B64URL_RE, HttpError, bearer, fail, json, readAcl, readJson, resolveAccess, safeEqual, sessionFor, sha256, sharesStore, SHARE_ID_RE } from "../lib/common";

function fromB64Url(input: string): Uint8Array {
  const b64 = input.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((input.length + 3) % 4);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

const ID_RE = /^[A-Za-z0-9_-]{22}$/;
/** Pictures are shrunk to well under this before they're sent (it's encrypted size). */
const MAX_BYTES = 3_000_000;

const imagesStore = () => getStore({ name: "umbra-images", consistency: "strong" });

/** Who's uploading: a signed-in person, or someone who may edit (or owns) a shared note. */
async function uploader(req: Request): Promise<string> {
  const session = await sessionFor(req);
  if (session) return `u:${session.uid}`;
  const shareId = (req.headers.get("x-umbra-share") ?? "").trim();
  const token = bearer(req);
  if (!token || !SHARE_ID_RE.test(shareId)) throw new HttpError(401, "signed_out");
  const shares = sharesStore();
  const hash = await sha256(token);
  const record = (await shares.get(shareId, { type: "json" })) as { tokenHash?: string } | null;
  if (record?.tokenHash && safeEqual(hash, record.tokenHash)) return `s:${shareId}`;
  // A friend writing in a co-edited note proves they hold the link (its write token) and may edit.
  const head = (await shares.get(`doc/${shareId}/head`, { type: "json" })) as { writeHash?: string; ownerHash?: string; editable?: boolean } | null;
  if (head?.writeHash && safeEqual(hash, head.writeHash)) {
    const access = await resolveAccess(req, await readAcl(shares, shareId), head.ownerHash ?? null, head.editable === false ? "view" : "edit");
    if (access.role === "edit" || access.role === "owner") return `s:${shareId}`;
  }
  throw new HttpError(403, "forbidden");
}

export default async (req: Request): Promise<Response> => {
  try {
    const id = new URL(req.url).pathname.split("/").pop() ?? "";
    if (!ID_RE.test(id)) return json({ error: "not_found" }, 404);
    const store = imagesStore();

    if (req.method === "GET") {
      const data = await store.get(`i/${id}`, { type: "arrayBuffer" });
      if (!data) return json({ error: "not_found" }, 404);
      return new Response(data, {
        headers: {
          "content-type": "application/octet-stream",
          "cache-control": "public, max-age=31536000, immutable",
          "content-length": String(data.byteLength),
        },
      });
    }

    if (req.method === "PUT") {
      const by = await uploader(req);
      // The bytes arrive as base64url text inside JSON (binary request bodies aren't carried
      // reliably everywhere functions run); they're stored as plain bytes.
      const { data } = await readJson(req, Math.ceil((MAX_BYTES * 4) / 3) + 64);
      if (typeof data !== "string" || !B64URL_RE.test(data)) throw new HttpError(400, "bad_data");
      const bytes = fromB64Url(data);
      if (bytes.byteLength > MAX_BYTES) throw new HttpError(413, "too_large");
      if (bytes.byteLength < 29) throw new HttpError(400, "bad_data");
      // Written once: an id never changes what it points to.
      const body = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
      const res = await store.set(`i/${id}`, body, { onlyIfNew: true, metadata: { by, at: Date.now(), size: bytes.byteLength } });
      return json({ ok: true, existed: !res.modified });
    }

    return json({ error: "method_not_allowed" }, 405);
  } catch (error) {
    return fail(error, "images");
  }
};

export const config: Config = {
  path: "/api/images/:id",
  method: ["GET", "PUT"],
};
