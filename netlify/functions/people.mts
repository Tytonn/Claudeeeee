/**
 * Who can open a shared link — like a doc's "Share" dialog.
 *
 * The owner chooses whether anyone holding the link can get in, or only people they let
 * in, and what they can do (edit or view). People who open the link while signed in show
 * up on the owner's list, where the owner can change what they can do, or remove them
 * at any moment. Removed people are refused by the server from their very next request.
 *
 *   PUT   /api/shares/:id/people   start the list (owner)       { linkHash, mode?, linkRole? }
 *   GET   /api/shares/:id/people   the list (owner)
 *   PATCH /api/shares/:id/people   change it (owner)            { mode?, linkRole?, uid?, role? }
 *   POST  /api/shares/:id/join     "I'm here" (signed in)       { proof, name } → { role, mode }
 */
import type { Config, Context } from "@netlify/functions";
import {
  HASH_RE,
  HttpError,
  SHARE_ID_RE,
  type Acl,
  type MemberRole,
  type Role,
  aclKey,
  bearer,
  fail,
  json,
  readAcl,
  readJson,
  requireSession,
  safeEqual,
  sha256,
  sharesStore,
  updateAcl,
} from "../lib/common";

type Head = { writeHash?: string; editable?: boolean; ownerHash?: string };

const role = (raw: unknown): Role | null => (raw === "edit" || raw === "view" ? raw : null);
const clean = (raw: unknown, max: number) => (typeof raw === "string" ? raw.trim().slice(0, max) : "");

/** The list as the owner sees it. */
const view = (acl: Acl) => ({
  mode: acl.mode,
  linkRole: acl.linkRole,
  members: Object.entries(acl.members)
    .map(([uid, m]) => ({ uid, username: m.username, name: m.name, role: m.role, at: m.at, seen: m.seen }))
    .sort((a, b) => a.at - b.at),
});

export default async (req: Request, context: Context): Promise<Response> => {
  const store = sharesStore();
  const id = context.params?.id ?? "";
  const action = new URL(req.url).pathname.endsWith("/join") ? "join" : "people";
  if (!SHARE_ID_RE.test(id)) return json({ error: "not_found" }, 404);

  try {
    // Owner: proven by the link's private owner token (matched against the share record).
    const ownerCheck = async () => {
      const token = bearer(req);
      const record = (await store.get(id, { type: "json" })) as { tokenHash?: string } | null;
      if (!record?.tokenHash) throw new HttpError(404, "not_found");
      if (!token || !safeEqual(await sha256(token), record.tokenHash)) throw new HttpError(403, "forbidden");
      return record.tokenHash;
    };

    if (action === "people") {
      if (req.method === "PUT") {
        const ownerHash = await ownerCheck();
        const body = await readJson(req, 2_000);
        if (typeof body.linkHash !== "string" || !HASH_RE.test(body.linkHash)) throw new HttpError(400, "bad_link_hash");
        const head = (await store.get(`doc/${id}/head`, { type: "json" })) as Head | null;
        const acl: Acl = {
          v: 1,
          mode: body.mode === "restricted" ? "restricted" : "link",
          linkRole: role(body.linkRole) ?? (head?.editable === false ? "view" : "edit"),
          ownerHash,
          linkHash: body.linkHash,
          members: {},
          updatedAt: Date.now(),
        };
        const res = await store.setJSON(aclKey(id), acl, { onlyIfNew: true });
        const current = res.modified ? acl : await readAcl(store, id);
        return json(view(current ?? acl), res.modified ? 201 : 200);
      }

      if (req.method === "GET") {
        await ownerCheck();
        const acl = await readAcl(store, id);
        if (!acl) return json({ error: "no_acl" }, 404);
        return json(view(acl));
      }

      if (req.method === "PATCH") {
        await ownerCheck();
        const body = await readJson(req, 2_000);
        const mode = body.mode === "restricted" || body.mode === "link" ? body.mode : null;
        const linkRole = role(body.linkRole);
        const uid = typeof body.uid === "string" && /^[A-Za-z0-9]{8,32}$/.test(body.uid) ? body.uid : null;
        const next = body.role === "remove" ? "remove" : body.role === "blocked" || body.role === "edit" || body.role === "view" ? (body.role as MemberRole) : null;
        const acl = await updateAcl(store, id, (a) => {
          const out: Acl = { ...a, members: { ...a.members }, updatedAt: Date.now() };
          if (mode) out.mode = mode;
          if (linkRole) out.linkRole = linkRole;
          if (uid && next && out.members[uid]) {
            if (next === "remove") delete out.members[uid];
            else out.members[uid] = { ...out.members[uid], role: next };
          }
          return out;
        });
        // Keep the live doc's own "friends can edit" flag in step (older readers use it).
        if (linkRole) {
          const headKey = `doc/${id}/head`;
          const cur = await store.getWithMetadata(headKey, { type: "json" });
          if (cur) await store.setJSON(headKey, { ...(cur.data as object), editable: linkRole === "edit" }, cur.etag ? { onlyIfMatch: cur.etag } : {}).catch(() => {});
        }
        return json(view(acl));
      }
    }

    if (action === "join" && req.method === "POST") {
      const session = await requireSession(req);
      const body = await readJson(req, 2_000);
      const proof = clean(body.proof, 128);
      const acl = await readAcl(store, id);
      if (!acl) {
        // A link from before access lists: open to anyone holding it.
        const head = (await store.get(`doc/${id}/head`, { type: "json" })) as Head | null;
        return json({ role: head?.editable === false ? "view" : "edit", mode: "link", listed: false });
      }
      if (!proof || !safeEqual(await sha256(proof), acl.linkHash)) throw new HttpError(403, "forbidden");
      const name = clean(body.name, 40) || session.username;
      const now = Date.now();
      const updated = await updateAcl(store, id, (a) => {
        const m = a.members[session.uid];
        if (m?.role === "blocked") return null;
        // Only touch the list for newcomers, a changed name, or a stale "last seen".
        if (m && m.name === name && now - m.seen < 3_600_000) return null;
        return {
          ...a,
          members: {
            ...a.members,
            [session.uid]: m
              ? { ...m, name, username: session.username, seen: now }
              : { username: session.username, name, role: a.mode === "link" ? a.linkRole : "pending", at: now, seen: now },
          },
          updatedAt: now,
        };
      });
      const me = updated.members[session.uid];
      if (!me || me.role === "blocked") throw new HttpError(403, "removed");
      return json({ role: me.role === "pending" ? (updated.mode === "link" ? updated.linkRole : "pending") : me.role, mode: updated.mode, listed: true });
    }

    return json({ error: "not_found" }, 404);
  } catch (error) {
    return fail(error, "people");
  }
};

export const config: Config = {
  path: ["/api/shares/:id/people", "/api/shares/:id/join"],
  method: ["GET", "POST", "PUT", "PATCH"],
};
