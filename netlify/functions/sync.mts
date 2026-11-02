/**
 * Sync — keeps your notes, lists, links and settings the same on every device.
 *
 * Each record (a note, the to-do list, a link you shared…) is sealed in the browser with
 * your data key and stored here under a revision number. An index lists every record's
 * latest revision and the order things changed in, so a device can ask "what's new since
 * change #n?" and get just that. Writes say which revision they're replacing, so two
 * devices can't silently overwrite each other — the second one is told, merges, retries.
 *
 *   GET  /api/sync?since=n   → { seq, items: [{ key, rev, at, del?, iv?, data? }], more }
 *   POST /api/sync           { items: [{ key, base, at, del?, iv?, data? }] } → { seq, results, conflicts }
 */
import type { Config, Context } from "@netlify/functions";
import { HttpError, accountsStore, fail, json, readJson, requireSession, sealed, type Store } from "../lib/common";

type IndexEntry = { rev: number; seq: number; at: number; del?: true };
type Index = { v: 1; seq: number; items: Record<string, IndexEntry> };

const KEY_RE = /^[A-Za-z0-9:_-]{1,80}$/;
const MAX_ITEM = 3_000_000;
const MAX_BODY = 4_800_000;
const MAX_RESPONSE = 3_500_000;

const indexKey = (uid: string) => `data/${uid}/index`;
const itemKey = (uid: string, key: string, rev: number) => `data/${uid}/item/${encodeURIComponent(key)}/${rev}`;

async function readIndex(store: Store, uid: string) {
  const entry = await store.getWithMetadata(indexKey(uid), { type: "json" });
  return { index: (entry?.data as Index | undefined) ?? { v: 1, seq: 0, items: {} }, etag: entry?.etag ?? null, exists: Boolean(entry) };
}

export default async (req: Request, context: Context): Promise<Response> => {
  const store = accountsStore();
  try {
    const { uid } = await requireSession(req);

    if (req.method === "GET") {
      const raw = Number(new URL(req.url).searchParams.get("since") ?? "0");
      const since = Number.isSafeInteger(raw) && raw >= 0 ? raw : 0;
      const { index } = await readIndex(store, uid);
      if (since >= index.seq) return json({ seq: index.seq, items: [], more: false });
      const changed = Object.entries(index.items)
        .filter(([, e]) => e.seq > since)
        .sort((a, b) => a[1].seq - b[1].seq);
      const items: Record<string, unknown>[] = [];
      let size = 0;
      let seq = since;
      for (let i = 0; i < changed.length; i += 24) {
        const batch = changed.slice(i, i + 24);
        const bodies = await Promise.all(
          batch.map(([key, e]) => (e.del ? Promise.resolve(null) : (store.get(itemKey(uid, key, e.rev), { type: "json" }) as Promise<{ iv: string; data: string } | null>))),
        );
        for (let j = 0; j < batch.length; j++) {
          const [key, e] = batch[j];
          const body = bodies[j];
          size += body?.data.length ?? 0;
          if (items.length && size > MAX_RESPONSE) return json({ seq, items, more: true });
          items.push({ key, rev: e.rev, at: e.at, ...(e.del ? { del: true } : body ? { iv: body.iv, data: body.data } : { missing: true }) });
          seq = e.seq;
        }
      }
      return json({ seq: index.seq, items, more: false });
    }

    if (req.method === "POST") {
      const body = await readJson(req, MAX_BODY);
      const list = Array.isArray(body.items) ? body.items.slice(0, 200) : [];
      const wanted = list.map((raw) => {
        const it = (raw ?? {}) as Record<string, unknown>;
        if (typeof it.key !== "string" || !KEY_RE.test(it.key)) throw new HttpError(400, "bad_key");
        const base = typeof it.base === "number" && Number.isSafeInteger(it.base) && it.base >= 0 ? it.base : 0;
        const at = typeof it.at === "number" && Number.isFinite(it.at) ? it.at : Date.now();
        return { key: it.key, base, at, del: it.del === true, body: it.del === true ? null : sealed(it, MAX_ITEM) };
      });
      const written = new Set<string>();
      for (let attempt = 0; attempt < 8; attempt++) {
        const { index, etag, exists } = await readIndex(store, uid);
        const conflicts: { key: string; rev: number }[] = [];
        const staged: { key: string; rev: number; at: number; del: boolean; prev: number }[] = [];
        for (const w of wanted) {
          const cur = index.items[w.key]?.rev ?? 0;
          if (cur !== w.base) {
            conflicts.push({ key: w.key, rev: cur });
            continue;
          }
          const rev = cur + 1;
          const slot = itemKey(uid, w.key, rev);
          if (w.body && !written.has(slot)) {
            // Each revision is written once, ever: if it's already taken, someone beat us.
            const res = await store.setJSON(slot, w.body, { onlyIfNew: true });
            if (!res.modified) {
              conflicts.push({ key: w.key, rev: cur });
              continue;
            }
            written.add(slot);
          }
          staged.push({ key: w.key, rev, at: w.at, del: w.del, prev: cur });
        }
        if (!staged.length) return json({ seq: index.seq, results: [], conflicts });
        const next: Index = { v: 1, seq: index.seq, items: { ...index.items } };
        for (const s of staged) {
          next.seq += 1;
          next.items[s.key] = { rev: s.rev, seq: next.seq, at: s.at, ...(s.del ? { del: true as const } : {}) };
        }
        // Compare-and-swap on the index (where the store gives no version tag, just write).
        const res = etag
          ? await store.setJSON(indexKey(uid), next, { onlyIfMatch: etag })
          : exists
            ? await store.setJSON(indexKey(uid), next)
            : await store.setJSON(indexKey(uid), next, { onlyIfNew: true });
        if (!res.modified) continue; // someone else synced at the same moment — re-check against theirs
        // Old revisions are no longer needed.
        const sweep = Promise.all(staged.filter((s) => s.prev > 0).map((s) => store.delete(itemKey(uid, s.key, s.prev)).catch(() => {})));
        if (typeof context.waitUntil === "function") context.waitUntil(sweep);
        else await sweep;
        return json({ seq: next.seq, results: staged.map((s) => ({ key: s.key, rev: s.rev })), conflicts });
      }
      throw new HttpError(409, "busy");
    }

    return json({ error: "method_not_allowed" }, 405);
  } catch (error) {
    return fail(error, "sync");
  }
};

export const config: Config = {
  path: "/api/sync",
  method: ["GET", "POST"],
};
