import type { Envelope } from "./crypto";

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
  ) {
    super(code);
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<{ status: number; body: T | null; etag: string | null }> {
  let res: Response;
  try {
    res = await fetch(path, { cache: "no-store", ...init });
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

/** Returns null when unchanged (304). */
export async function fetchShare(id: string, etag?: string | null): Promise<{ share: RemoteShare; etag: string | null } | null> {
  const { status, body, etag: nextTag } = await request<RemoteShare>(`/api/shares/${encodeURIComponent(id)}`, {
    headers: etag ? { "if-none-match": etag } : {},
  });
  if (status === 304) return null;
  return { share: body!, etag: nextTag };
}

// ── Live co-editing (see netlify/functions/collab.mts) ─────────────────────

export type Sealed = { iv: string; data: string };
export type DocEntry = Sealed & { n: number; c: number };
export type DocCatchUp = {
  seq: number;
  upto: number;
  editable: boolean;
  snap: (Sealed & { upto: number }) | null;
  entries: DocEntry[];
  more: boolean;
  assigned?: number | null;
};

const docPath = (id: string) => `/api/shares/${encodeURIComponent(id)}/doc`;

export async function fetchDoc(id: string, since: number): Promise<DocCatchUp> {
  const { body } = await request<DocCatchUp>(`${docPath(id)}?since=${since}`);
  return body!;
}

export async function pushDoc(
  id: string,
  token: string,
  body: { client: number; since: number; entry?: Sealed; snap?: Sealed & { upto: number } },
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
