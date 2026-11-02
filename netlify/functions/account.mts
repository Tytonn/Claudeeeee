/**
 * Accounts — so your notes follow you to every device. Runs on Netlify Functions + Blobs.
 *
 * Your password never leaves your browser. It's stretched there (PBKDF2) into two keys:
 * one to prove it's you (sent here, stored only as a hash) and one that unlocks your data
 * key (never sent). Everything synced is encrypted with that data key, so this server can
 * neither read your notes nor reset your password.
 *
 *   POST /api/account/signup   { username, auth, wrapped }  → { token, uid, username }
 *   POST /api/account/login    { username, auth }           → { token, uid, username, wrapped }
 *   POST /api/account/logout   (X-Umbra-Session)
 *   GET  /api/account/me       (X-Umbra-Session)            → { uid, username }
 *   GET  /api/account/available?username=…                 → { available }
 */
import type { Config, Context } from "@netlify/functions";
import {
  HttpError,
  accountsStore,
  fail,
  forgetSession,
  json,
  randomId,
  randomToken,
  readJson,
  requireSession,
  safeEqual,
  sealed,
  sessionKey,
  sha256,
} from "../lib/common";

type User = {
  v: 1;
  uid: string;
  username: string;
  authHash: string;
  /** The data key, encrypted with a key only the password can make. */
  wrapped: { iv: string; data: string };
  createdAt: number;
  fails?: number;
  lockedUntil?: number;
};

const USERNAME_RE = /^[a-z0-9][a-z0-9_.-]{2,23}$/;
const AUTH_RE = /^[A-Za-z0-9_-]{43}$/;
const SESSION_TTL = 180 * 86_400_000;

const username = (raw: unknown) => {
  const u = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  if (!USERNAME_RE.test(u)) throw new HttpError(400, "bad_username");
  return u;
};
const authKey = (raw: unknown) => {
  if (typeof raw !== "string" || !AUTH_RE.test(raw)) throw new HttpError(400, "bad_auth");
  return raw;
};
const authHash = (auth: string) => sha256(`umbra:auth:v1:${auth}`);

async function newSession(uid: string, name: string) {
  const token = randomToken(32);
  const now = Date.now();
  await accountsStore().setJSON(await sessionKey(token), { uid, username: name, createdAt: now, expiresAt: now + SESSION_TTL });
  return token;
}

export default async (req: Request, context: Context): Promise<Response> => {
  const store = accountsStore();
  try {
    switch (context.params?.action) {
      case "signup": {
        if (req.method !== "POST") break;
        const body = await readJson(req, 4_000);
        const name = username(body.username);
        const auth = authKey(body.auth);
        const user: User = {
          v: 1,
          uid: randomId(16),
          username: name,
          authHash: await authHash(auth),
          wrapped: sealed(body.wrapped, 400),
          createdAt: Date.now(),
        };
        const res = await store.setJSON(`user/${name}`, user, { onlyIfNew: true });
        if (!res.modified) throw new HttpError(409, "taken");
        return json({ token: await newSession(user.uid, name), uid: user.uid, username: name }, 201);
      }

      case "login": {
        if (req.method !== "POST") break;
        const body = await readJson(req, 4_000);
        const name = username(body.username);
        const auth = authKey(body.auth);
        const entry = await store.getWithMetadata(`user/${name}`, { type: "json" });
        // Same answer for "no such user" and "wrong password".
        if (!entry) throw new HttpError(401, "bad_login");
        const user = entry.data as User;
        const now = Date.now();
        if ((user.lockedUntil ?? 0) > now) throw new HttpError(429, "locked");
        const ok = safeEqual(await authHash(auth), user.authHash);
        if (!ok || user.fails) {
          // Count misses; a run of them locks the account for a few minutes.
          const fails = ok ? 0 : (user.fails ?? 0) + 1;
          const next: User = { ...user, fails: fails >= 8 ? 0 : fails, lockedUntil: fails >= 8 ? now + 5 * 60_000 : user.lockedUntil };
          await store.setJSON(`user/${name}`, next, entry.etag ? { onlyIfMatch: entry.etag } : {}).catch(() => {});
        }
        if (!ok) throw new HttpError(401, "bad_login");
        return json({ token: await newSession(user.uid, name), uid: user.uid, username: name, wrapped: user.wrapped });
      }

      case "logout": {
        if (req.method !== "POST") break;
        const token = (req.headers.get("x-umbra-session") ?? "").trim();
        if (token) {
          await store.delete(await sessionKey(token)).catch(() => {});
          forgetSession(token);
        }
        return new Response(null, { status: 204 });
      }

      case "available": {
        if (req.method !== "GET") break;
        const raw = new URL(req.url).searchParams.get("username") ?? "";
        const u = raw.trim().toLowerCase();
        if (!USERNAME_RE.test(u)) return json({ available: false, reason: "format" });
        const taken = await store.getMetadata(`user/${u}`);
        return json({ available: !taken });
      }

      case "me": {
        if (req.method !== "GET") break;
        const s = await requireSession(req);
        return json({ uid: s.uid, username: s.username });
      }
    }
    return json({ error: "not_found" }, 404);
  } catch (error) {
    return fail(error, "account");
  }
};

export const config: Config = {
  path: "/api/account/:action",
  method: ["GET", "POST"],
};
