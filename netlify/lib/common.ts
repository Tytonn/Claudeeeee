/**
 * Shared pieces for the umbra functions: responses, hashing, accounts' sessions, and who
 * may open or edit a shared link (its access list).
 */
import { getStore } from "@netlify/blobs";

export type Store = ReturnType<typeof getStore>;

export const sharesStore = () => getStore({ name: "umbra-shares", consistency: "strong" });
export const accountsStore = () => getStore({ name: "umbra-accounts", consistency: "strong" });

export class HttpError extends Error {
  constructor(
    public status: number,
    public code: string,
  ) {
    super(code);
  }
}

export const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers },
  });

export function fail(error: unknown, where: string) {
  if (error instanceof HttpError) return json({ error: error.code }, error.status);
  console.error(`${where} error`, error);
  return json({ error: "server_error" }, 500);
}

export const B64URL_RE = /^[A-Za-z0-9_-]+$/;
export const HASH_RE = /^[A-Za-z0-9_-]{43}$/;
export const SHARE_ID_RE = /^[A-Za-z0-9]{8,32}$/;

export function toB64Url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function sha256(input: string): Promise<string> {
  return toB64Url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input))));
}

export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export const randomToken = (bytes = 32) => toB64Url(crypto.getRandomValues(new Uint8Array(bytes)));

const ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
export function randomId(length = 16): string {
  let out = "";
  while (out.length < length) {
    for (const b of crypto.getRandomValues(new Uint8Array(length * 2))) if (b < 248 && out.length < length) out += ALPHABET[b % 62];
  }
  return out;
}

/** The `Authorization: Bearer …` token (a link's owner/write token), if any. */
export function bearer(req: Request): string | null {
  const m = /^Bearer\s+([A-Za-z0-9_-]{20,128})$/.exec((req.headers.get("authorization") ?? "").trim());
  return m ? m[1] : null;
}

export async function readJson(req: Request, limit: number): Promise<Record<string, unknown>> {
  const text = await req.text();
  if (text.length > limit) throw new HttpError(413, "too_large");
  try {
    const body = JSON.parse(text || "{}");
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error();
    return body as Record<string, unknown>;
  } catch {
    throw new HttpError(400, "bad_json");
  }
}

export function sealed(raw: unknown, max: number): { iv: string; data: string } {
  const { iv, data } = (raw ?? {}) as Record<string, unknown>;
  if (typeof iv !== "string" || iv.length < 12 || iv.length > 32 || !B64URL_RE.test(iv)) throw new HttpError(400, "bad_iv");
  if (typeof data !== "string" || data.length < 16 || data.length > max || !B64URL_RE.test(data)) throw new HttpError(400, "bad_data");
  return { iv, data };
}

// ── Accounts' sessions ─────────────────────────────────────────────────────

export type Session = { uid: string; username: string; createdAt: number; expiresAt: number };
const SESSION_HEADER = "x-umbra-session";
const sessionCache = new Map<string, { s: Session | null; until: number }>();

export const sessionKey = async (token: string) => `sess/${await sha256(token)}`;

/** The signed-in person making this request (from the X-Umbra-Session header), if any. */
export async function sessionFor(req: Request): Promise<Session | null> {
  const token = (req.headers.get(SESSION_HEADER) ?? "").trim();
  if (!/^[A-Za-z0-9_-]{30,128}$/.test(token)) return null;
  const now = Date.now();
  const hit = sessionCache.get(token);
  if (hit && hit.until > now) return hit.s;
  const s = (await accountsStore().get(await sessionKey(token), { type: "json" })) as Session | null;
  const valid = s && s.expiresAt > now ? s : null;
  sessionCache.set(token, { s: valid, until: now + 30_000 });
  if (sessionCache.size > 500) sessionCache.delete(sessionCache.keys().next().value!);
  return valid;
}

export async function requireSession(req: Request): Promise<Session> {
  const s = await sessionFor(req);
  if (!s) throw new HttpError(401, "signed_out");
  return s;
}

export function forgetSession(token: string) {
  sessionCache.delete(token);
}

// ── Who may open / edit a shared link ──────────────────────────────────────

export type Role = "edit" | "view";
export type MemberRole = Role | "pending" | "blocked";
export type Member = { username: string; name: string; role: MemberRole; at: number; seen: number };
export type Acl = {
  v: 1;
  /** link: anyone holding the link · restricted: only people the owner has let in */
  mode: "link" | "restricted";
  /** What someone gets through the link (or on approval, in restricted mode). */
  linkRole: Role;
  ownerHash: string;
  /** sha256 of the token derived from the link's key — proof someone really has the link. */
  linkHash: string;
  members: Record<string, Member>;
  updatedAt: number;
};

export const aclKey = (id: string) => `doc/${id}/acl`;

export async function readAcl(store: Store, id: string) {
  return (await store.get(aclKey(id), { type: "json" })) as Acl | null;
}

/** Read-modify-write on an access list with optimistic concurrency. */
export async function updateAcl(store: Store, id: string, fn: (a: Acl) => Acl | null): Promise<Acl> {
  for (let attempt = 0; attempt < 8; attempt++) {
    const cur = await store.getWithMetadata(aclKey(id), { type: "json" });
    if (!cur) throw new HttpError(404, "no_acl");
    const next = fn(cur.data as Acl);
    if (!next) return cur.data as Acl;
    const res = cur.etag ? await store.setJSON(aclKey(id), next, { onlyIfMatch: cur.etag }) : await store.setJSON(aclKey(id), next);
    if (res.modified) return next;
  }
  throw new HttpError(409, "busy");
}

export type Access = { role: "owner" | Role | null; reason?: "restricted" | "pending" | "removed"; session: Session | null };

/**
 * Works out what this request may do with share `id`:
 *  - the owner's private token → owner
 *  - a signed-in person on the list → their role (removed people get nothing)
 *  - anyone else → the link's role when the link is open, nothing when it's restricted.
 * `fallbackRole` covers links from before access lists existed.
 */
export async function resolveAccess(req: Request, acl: Acl | null, ownerHash: string | null, fallbackRole: Role): Promise<Access> {
  const token = bearer(req);
  const [hash, session] = await Promise.all([token ? sha256(token) : Promise.resolve(null), sessionFor(req)]);
  if (hash && ownerHash && safeEqual(hash, ownerHash)) return { role: "owner", session };
  const mode = acl?.mode ?? "link";
  const linkRole = acl?.linkRole ?? fallbackRole;
  const member = session && acl ? acl.members[session.uid] : undefined;
  if (member?.role === "blocked") return { role: null, reason: "removed", session };
  if (member?.role === "edit" || member?.role === "view") return { role: member.role, session };
  if (mode === "link") return { role: linkRole, session };
  return { role: null, reason: member?.role === "pending" ? "pending" : "restricted", session };
}

export function denied(access: Access): never {
  throw new HttpError(403, access.reason ?? "forbidden");
}
