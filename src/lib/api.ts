import type { Envelope } from "./crypto";

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
  ) {
    super(code);
  }
}

/** The signed-in account's session, sent with every request so links know who you are. */
let sessionToken: string | null = null;
export function setSessionToken(token: string | null) {
  sessionToken = token;
}

async function request<T>(path: string, init: RequestInit = {}): Promise<{ status: number; body: T | null; etag: string | null }> {
  let res: Response;
  try {
    const headers = new Headers(init.headers);
    if (sessionToken && !headers.has("x-umbra-session")) headers.set("x-umbra-session", sessionToken);
    res = await fetch(path, { cache: "no-store", ...init, headers });
  } catch {
    throw new ApiError(0, "offline");
  }
  const etag = res.headers.get("etag");
  if (res.status === 204 || res.status === 304) return { status: res.status, body: null, etag };
  const type = res.headers.get("content-type") ?? "";
  if (!type.includes("application/json")) {
    // e.g. the SPA's index.html served because functions aren't deployed
    throw new ApiError(res.status === 200 ? 503 : res.status, "no_backend");
  }
  const body = (await res.json()) as T & { error?: string };
  if (!res.ok) throw new ApiError(res.status, body?.error ?? "error");
  return { status: res.status, body, etag };
}

export type CreatedShare = { id: string; token: string; rev: number; updatedAt: number };
export type RemoteShare = Envelope & { rev: number; updatedAt: number; createdAt: number };

export async function createShare(envelope: Envelope): Promise<CreatedShare> {
  const { body } = await request<CreatedShare>("/api/shares", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(envelope),
  });
  return body!;
}

export async function updateShare(id: string, token: string, envelope: Envelope): Promise<{ rev: number; updatedAt: number }> {
  const { body } = await request<{ rev: number; updatedAt: number }>(`/api/shares/${encodeURIComponent(id)}`, {
    method: "PUT",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify(envelope),
  });
  return body!;
}

export async function deleteShare(id: string, token: string): Promise<void> {
  await request(`/api/shares/${encodeURIComponent(id)}`, {
    method: "DELETE",
    headers: { authorization: `Bearer ${token}` },
  });
}

/** Returns null when unchanged (304). The owner passes their token so private links still open for them. */
export async function fetchShare(id: string, etag?: string | null, ownerToken?: string): Promise<{ share: RemoteShare; etag: string | null } | null> {
  const headers: Record<string, string> = {};
  if (etag) headers["if-none-match"] = etag;
  if (ownerToken) headers.authorization = `Bearer ${ownerToken}`;
  const { status, body, etag: nextTag } = await request<RemoteShare>(`/api/shares/${encodeURIComponent(id)}`, { headers });
  if (status === 304) return null;
  return { share: body!, etag: nextTag };
}

// ── Live co-editing (see netlify/functions/collab.mts) ─────────────────────

export type Sealed = { iv: string; data: string };
/** `at`: when the server took it in (its clock — compare with `now` in the same response). */
export type DocEntry = Sealed & { n: number; c: number; at?: number };
/** Someone with the note open: their sealed card (colour, picture), what they may do, and — if they're signed in — their username, as the server knows it. */
export type HerePerson = Sealed & { c: number; k: number; r: "owner" | "edit" | "view"; u?: string };
export type DocCatchUp = {
  seq: number;
  upto: number;
  /** The link's own setting ("friends can edit"). */
  editable: boolean;
  /** What you may do: owner, edit or view. */
  role?: "owner" | "edit" | "view";
  snap: (Sealed & { upto: number }) | null;
  entries: DocEntry[];
  more: boolean;
  assigned?: number | null;
  /** Who's here: the list's version; whether you're on it; and the list itself, if it's changed since the version you sent. */
  here?: { v: string; you: boolean; people?: HerePerson[] };
  /** (the owner of a private link) people waiting to be let in */
  pending?: number;
  /** The server's clock. */
  now?: number;
};
/** Being on the "who's here" list (c: your client, k: your card's version, card: sent when asked for) and/or seeing it (hv: the version you have). */
export type HereParams = { c?: number; k?: number; hv: string; card?: Sealed | null };

const docPath = (id: string) => `/api/shares/${encodeURIComponent(id)}/doc`;

/** `token` (owner or link write token) lets the owner in even when the link is private. */
export async function fetchDoc(id: string, since: number, token?: string, here?: HereParams): Promise<DocCatchUp> {
  const q = new URLSearchParams({ since: String(since) });
  if (here) {
    q.set("hv", here.hv);
    if (here.c != null) {
      q.set("c", String(here.c));
      q.set("k", String(here.k ?? 0));
      if (here.card) q.set("card", `${here.card.iv}.${here.card.data}`);
    }
  }
  const { body } = await request<DocCatchUp>(`${docPath(id)}?${q}`, token ? { headers: { authorization: `Bearer ${token}` } } : {});
  return body!;
}

/** Leaving a note: off its "who's here" list straight away. */
export async function leaveDoc(id: string, token: string, client: number, keepalive = false): Promise<void> {
  await request(docPath(id), {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify({ bye: client }),
    keepalive,
  });
}

export async function pushDoc(
  id: string,
  token: string,
  body: { client: number; since: number; entry?: Sealed; snap?: Sealed & { upto: number }; here?: HereParams },
  opts: { keepalive?: boolean } = {},
): Promise<DocCatchUp> {
  const json = JSON.stringify(body);
  const { body: res } = await request<DocCatchUp>(docPath(id), {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: json,
    // keepalive lets a last save finish while the page closes (browsers cap it at 64 KB)
    keepalive: Boolean(opts.keepalive) && json.length < 60_000,
  });
  return res!;
}

export async function initDoc(id: string, ownerToken: string, body: { writeHash: string; editable: boolean; entry: Sealed; client: number }) {
  const { body: res } = await request<{ seq: number; upto: number; editable: boolean }>(docPath(id), {
    method: "PUT",
    headers: { "content-type": "application/json", authorization: `Bearer ${ownerToken}` },
    body: JSON.stringify(body),
  });
  return res!;
}

export async function setDocEditable(id: string, ownerToken: string, editable: boolean) {
  const { body } = await request<{ editable: boolean }>(docPath(id), {
    method: "PATCH",
    headers: { "content-type": "application/json", authorization: `Bearer ${ownerToken}` },
    body: JSON.stringify({ editable }),
  });
  return body!;
}

// ── Accounts ──────────────────────────────────────────────────────────────

export type SessionInfo = { token: string; uid: string; username: string };

export async function apiSignup(body: { username: string; auth: string; wrapped: Sealed }) {
  const { body: res } = await request<SessionInfo>("/api/account/signup", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  return res!;
}

export async function apiLogin(body: { username: string; auth: string }) {
  const { body: res } = await request<SessionInfo & { wrapped: Sealed }>("/api/account/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  return res!;
}

export async function apiLogout() {
  await request("/api/account/logout", { method: "POST" });
}

/** Ends one particular session (not necessarily this device's own). */
export async function apiLogoutToken(token: string) {
  await request("/api/account/logout", { method: "POST", headers: { "x-umbra-session": token } });
}

// ── Sync ──────────────────────────────────────────────────────────────────

export type SyncItem = { key: string; rev: number; at: number; del?: boolean; missing?: boolean; iv?: string; data?: string };

export async function syncPull(since: number) {
  const { body } = await request<{ seq: number; items: SyncItem[]; more: boolean }>(`/api/sync?since=${since}`);
  return body!;
}

export async function syncPush(items: { key: string; base: number; at: number; del?: boolean; iv?: string; data?: string }[]) {
  const { body } = await request<{ seq: number; results: { key: string; rev: number }[]; conflicts: { key: string; rev: number }[] }>("/api/sync", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ items }),
  });
  return body!;
}

// ── People on a shared link ───────────────────────────────────────────────

export type Person = { uid: string; username: string; name: string; role: "edit" | "view" | "pending" | "blocked"; at: number; seen: number };
export type People = { mode: "link" | "restricted"; linkRole: "edit" | "view"; members: Person[] };
const peoplePath = (id: string) => `/api/shares/${encodeURIComponent(id)}/people`;
const ownerHeaders = (token: string) => ({ "content-type": "application/json", authorization: `Bearer ${token}` });

export async function initPeople(id: string, ownerToken: string, body: { linkHash: string; mode?: "link" | "restricted"; linkRole?: "edit" | "view" }) {
  const { body: res } = await request<People>(peoplePath(id), { method: "PUT", headers: ownerHeaders(ownerToken), body: JSON.stringify(body) });
  return res!;
}

export async function getPeople(id: string, ownerToken: string) {
  const { body } = await request<People>(peoplePath(id), { headers: { authorization: `Bearer ${ownerToken}` } });
  return body!;
}

export async function patchPeople(id: string, ownerToken: string, patch: { mode?: "link" | "restricted"; linkRole?: "edit" | "view"; uid?: string; role?: "edit" | "view" | "blocked" | "remove" }) {
  const { body } = await request<People>(peoplePath(id), { method: "PATCH", headers: ownerHeaders(ownerToken), body: JSON.stringify(patch) });
  return body!;
}

export async function joinShare(id: string, proof: string, name: string) {
  const { body } = await request<{ role: "edit" | "view" | "pending"; mode: "link" | "restricted"; listed: boolean }>(`/api/shares/${encodeURIComponent(id)}/join`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ proof, name }),
  });
  return body!;
}

export async function usernameAvailable(username: string) {
  const { body } = await request<{ available: boolean }>(`/api/account/available?username=${encodeURIComponent(username)}`);
  return body!.available;
}
