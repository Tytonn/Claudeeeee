import { createStore, del, entries, get, set } from "idb-keyval";
import type { JSONContent } from "@tiptap/core";
import { useApp } from "../store/app";
import { onAccountChange, sessionToken, useAccount } from "../account/account";
import { fromB64Url, randomBytes, toB64Url } from "./crypto";

/**
 * Pictures in notes.
 *
 * An image is shrunk and re-encoded in the browser (sharp at any screen size, but small), then
 * kept on this device. If it ever needs to leave the device — your notes sync to your account,
 * or the note is shared — it's encrypted with a key of its own first, and that key travels
 * inside the note (which is itself end-to-end encrypted). So whoever can read the note can see
 * its pictures, and nobody else can, the server included. Each device downloads an image once
 * and keeps it.
 */

export type ImageAttrs = { id: string; key: string; w: number; h: number; ph: string; alt: string; type: string };
export type ImageAuth = { session: true } | { share: string; token: string };

type Local = { blob: Blob; key: string; type: string; uploaded: boolean; at: number; auth?: { share: string; token: string } };

const db = createStore("umbra-images", "img");
const MAX_EDGE = 2200;
const MAX_BYTES = 2_400_000;
const ID_RE = /^[A-Za-z0-9_-]{22}$/;

// ── Preparing a picture ───────────────────────────────────────────────────

function canvasBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b), type, quality));
}

async function decode(file: Blob): Promise<ImageBitmap | HTMLImageElement> {
  try {
    return await createImageBitmap(file);
  } catch {
    // Some formats only decode through an <img>.
    const url = URL.createObjectURL(file);
    try {
      const img = new Image();
      img.src = url;
      await img.decode();
      return img;
    } finally {
      URL.revokeObjectURL(url);
    }
  }
}

const sizeOf = (src: ImageBitmap | HTMLImageElement) => ("naturalWidth" in src ? { w: src.naturalWidth, h: src.naturalHeight } : { w: src.width, h: src.height });

function draw(src: ImageBitmap | HTMLImageElement, w: number, h: number) {
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(src, 0, 0, w, h);
  return canvas;
}

/** A tiny, blurry stand-in (well under a kilobyte) shown while the real thing loads. */
function placeholder(src: ImageBitmap | HTMLImageElement, w: number, h: number): string {
  const s = 24 / Math.max(w, h);
  const c = draw(src, Math.max(2, Math.round(w * s)), Math.max(2, Math.round(h * s)));
  return c.toDataURL("image/jpeg", 0.6);
}

function hasAlpha(src: ImageBitmap | HTMLImageElement, w: number, h: number) {
  const c = draw(src, Math.min(48, w), Math.min(48, h));
  const data = c.getContext("2d")!.getImageData(0, 0, c.width, c.height).data;
  for (let i = 3; i < data.length; i += 4) if (data[i] < 250) return true;
  return false;
}

/** Shrinks and re-encodes a picture: WebP where the browser can make it, JPEG (or PNG for transparency) where not. */
export async function prepareImage(file: File): Promise<{ blob: Blob; type: string; w: number; h: number; ph: string }> {
  if (!file.type.startsWith("image/")) throw new Error("That isn't an image.");
  const src = await decode(file);
  const { w: W, h: H } = sizeOf(src);
  if (!W || !H) throw new Error("Couldn't read that image.");
  const ph = placeholder(src, W, H);
  // Animated GIFs stay as they are (redrawing would freeze them), as long as they're not huge.
  if (file.type === "image/gif" && file.size <= MAX_BYTES) return { blob: file, type: "image/gif", w: W, h: H, ph };
  let edge = MAX_EDGE;
  for (let attempt = 0; attempt < 4; attempt++) {
    const s = Math.min(1, edge / Math.max(W, H));
    const w = Math.max(1, Math.round(W * s));
    const h = Math.max(1, Math.round(H * s));
    const canvas = draw(src, w, h);
    const quality = attempt < 2 ? 0.86 - attempt * 0.08 : 0.72;
    let blob = await canvasBlob(canvas, "image/webp", quality);
    if (!blob || blob.type !== "image/webp") {
      const alpha = /png|webp|gif|svg/.test(file.type) && hasAlpha(src, W, H);
      blob = await canvasBlob(canvas, alpha ? "image/png" : "image/jpeg", quality + 0.02);
    }
    if (blob && blob.size <= MAX_BYTES) return { blob, type: blob.type, w, h, ph };
    edge = Math.round(edge * 0.75);
  }
  throw new Error("That image is too big to add.");
}

// ── Encryption ────────────────────────────────────────────────────────────

const importKey = (keyRaw: string, use: "encrypt" | "decrypt") => crypto.subtle.importKey("raw", fromB64Url(keyRaw), "AES-GCM", false, [use]);

async function encrypt(keyRaw: string, blob: Blob): Promise<Uint8Array<ArrayBuffer>> {
  const iv = randomBytes(12);
  const data = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await importKey(keyRaw, "encrypt"), await blob.arrayBuffer()));
  const out = new Uint8Array(12 + data.length);
  out.set(iv, 0);
  out.set(data, 12);
  return out;
}

async function decrypt(keyRaw: string, bytes: Uint8Array<ArrayBuffer>, type: string): Promise<Blob> {
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: bytes.slice(0, 12) }, await importKey(keyRaw, "decrypt"), bytes.slice(12));
  return new Blob([plain], { type });
}

// ── Showing a picture ─────────────────────────────────────────────────────

const urls = new Map<string, string>();
const loading = new Map<string, Promise<string | null>>();

/**
 * An object URL for an image: from this device if it's here, otherwise downloaded (once) and
 * decrypted. `null` means it isn't available yet — say, still uploading from another device.
 */
export function imageUrl(a: Pick<ImageAttrs, "id" | "key" | "type">): Promise<string | null> {
  if (!ID_RE.test(a.id) || !a.key) return Promise.resolve(null);
  const ready = urls.get(a.id);
  if (ready) return Promise.resolve(ready);
  const busy = loading.get(a.id);
  if (busy) return busy;
  const job = (async () => {
    const local = (await get(a.id, db).catch(() => null)) as Local | undefined | null;
    let blob = local?.blob ?? null;
    if (!blob) {
      const res = await fetch(`/api/images/${a.id}`).catch(() => null);
      if (!res || !res.ok) return null;
      try {
        blob = await decrypt(a.key, new Uint8Array(await res.arrayBuffer()), a.type || "image/webp");
      } catch {
        return null;
      }
      void set(a.id, { blob, key: a.key, type: blob.type, uploaded: true, at: Date.now() } satisfies Local, db).catch(() => {});
    }
    const url = URL.createObjectURL(blob);
    urls.set(a.id, url);
    return url;
  })().finally(() => loading.delete(a.id));
  loading.set(a.id, job);
  return job;
}

// ── Adding and uploading ──────────────────────────────────────────────────

/** How this device may upload a note's pictures: signed in, or as the owner of its shared link. */
export function authForNote(noteId: string | null | undefined): ImageAuth | null {
  if (useAccount.getState().user) return { session: true };
  const share = noteId ? useApp.getState().shares[noteId] : undefined;
  return share ? { share: share.id, token: share.token } : null;
}

const uploads = new Map<string, Promise<boolean>>();

async function upload(id: string, entry: Local, auth: ImageAuth): Promise<boolean> {
  const running = uploads.get(id);
  if (running) return running;
  const job = (async () => {
    const headers: Record<string, string> = { "content-type": "application/json" };
    if ("share" in auth) {
      headers.authorization = `Bearer ${auth.token}`;
      headers["x-umbra-share"] = auth.share;
    } else {
      const token = sessionToken();
      if (!token) return false;
      headers["x-umbra-session"] = token;
    }
    try {
      const res = await fetch(`/api/images/${id}`, { method: "PUT", headers, body: JSON.stringify({ data: toB64Url(await encrypt(entry.key, entry.blob)) }) });
      if (!res.ok) return false;
      await set(id, { ...entry, uploaded: true }, db);
      return true;
    } catch {
      return false;
    }
  })().finally(() => uploads.delete(id));
  uploads.set(id, job);
  return job;
}

/**
 * Takes in a picture: prepares it, keeps it on this device, and sends it up (encrypted) when
 * it has somewhere to go. Returns what the note needs to show it.
 */
export async function addImage(file: File, auth: ImageAuth | null): Promise<ImageAttrs> {
  const { blob, type, w, h, ph } = await prepareImage(file);
  const id = toB64Url(randomBytes(16));
  const key = toB64Url(randomBytes(32));
  const entry: Local = { blob, key, type, uploaded: false, at: Date.now(), ...(auth && "share" in auth ? { auth } : {}) };
  await set(id, entry, db);
  urls.set(id, URL.createObjectURL(blob));
  if (auth) void upload(id, entry, auth);
  const alt = file.name.replace(/\.[a-z0-9]+$/i, "").replace(/[-_]+/g, " ").trim().slice(0, 120);
  return { id, key, w, h, ph, alt: /^(image|img|photo|screenshot)?\s*\d*$/i.test(alt) ? "" : alt, type };
}

/** Every picture in a note. */
export function imageIds(doc: JSONContent | null | undefined): string[] {
  const out: string[] = [];
  const walk = (n: JSONContent) => {
    if (n.type === "image" && typeof n.attrs?.id === "string") out.push(n.attrs.id);
    n.content?.forEach(walk);
  };
  if (doc) walk(doc);
  return out;
}

export const hasImages = (doc: JSONContent | null | undefined) => imageIds(doc).length > 0;

/** Makes sure a note's pictures are on the server (before a link to it goes out). */
export async function ensureUploaded(doc: JSONContent | null | undefined, auth: ImageAuth | null): Promise<void> {
  if (!auth) return;
  for (const id of imageIds(doc)) {
    const entry = (await get(id, db).catch(() => null)) as Local | undefined | null;
    if (entry && !entry.uploaded) await upload(id, entry, auth);
  }
}

/**
 * In the background: sends up pictures that couldn't go before (offline, or before you signed
 * in or shared), and tidies away local copies nothing uses any more.
 */
export function startImageSync() {
  let timer = 0;
  let running = false;
  const run = async () => {
    if (running || !navigator.onLine) return;
    running = true;
    try {
      const s = useApp.getState();
      const where = new Map<string, string>();
      for (const n of Object.values(s.notes)) for (const id of imageIds(n.doc)) where.set(id, n.id);
      const all = (await entries(db).catch(() => [])) as [IDBValidKey, Local][];
      for (const [k, entry] of all) {
        const id = String(k);
        if (!entry || typeof entry !== "object") continue;
        const noteId = where.get(id);
        if (!entry.uploaded) {
          const auth = entry.auth ?? (noteId ? authForNote(noteId) : null);
          if (auth) await upload(id, entry, auth);
        } else if (!noteId && !entry.auth && Date.now() - entry.at > 14 * 86_400_000) {
          // Not in any of your notes for two weeks (and not someone else's shared note): let it go.
          await del(id, db).catch(() => {});
        }
      }
    } finally {
      running = false;
    }
  };
  const soon = (ms = 1500) => {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => void run(), ms);
  };
  addEventListener("online", () => soon());
  onAccountChange(() => soon());
  useApp.subscribe((s, prev) => {
    if (s.shares !== prev.shares) soon();
  });
  window.setInterval(() => void run(), 120_000);
  soon(6000);
}
