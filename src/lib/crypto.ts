/**
 * End-to-end encryption for share links.
 *
 * A fresh 128-bit AES-GCM key is generated per share. The key travels only in the
 * URL fragment (#…), which browsers never send to servers — so Netlify only ever
 * stores ciphertext. Payloads are gzip-compressed before encryption when supported.
 */

export function toB64Url(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function fromB64Url(input: string): Uint8Array<ArrayBuffer> {
  const b64 = input.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((input.length + 3) % 4);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function randomBytes(n: number): Uint8Array<ArrayBuffer> {
  return crypto.getRandomValues(new Uint8Array(n));
}

export function newShareKey(): string {
  return toB64Url(randomBytes(16));
}

async function importKey(raw: string): Promise<CryptoKey> {
  const bytes = fromB64Url(raw);
  if (bytes.length !== 16 && bytes.length !== 32) throw new Error("bad_key");
  return crypto.subtle.importKey("raw", bytes, "AES-GCM", false, ["encrypt", "decrypt"]);
}

const FLAG_RAW = 0;
const FLAG_GZIP = 1;

async function pipeThrough(bytes: Uint8Array<ArrayBuffer>, stream: CompressionStream | DecompressionStream) {
  const res = new Response(new Blob([bytes]).stream().pipeThrough(stream));
  return new Uint8Array(await res.arrayBuffer());
}

async function pack(value: unknown): Promise<Uint8Array<ArrayBuffer>> {
  const raw = new TextEncoder().encode(JSON.stringify(value));
  let body: Uint8Array<ArrayBuffer> = raw;
  let flag = FLAG_RAW;
  if (typeof CompressionStream !== "undefined" && raw.length > 256) {
    try {
      const gz = await pipeThrough(raw, new CompressionStream("gzip"));
      if (gz.length < raw.length) {
        body = gz;
        flag = FLAG_GZIP;
      }
    } catch {
      /* fall back to raw */
    }
  }
  const out = new Uint8Array(body.length + 1);
  out[0] = flag;
  out.set(body, 1);
  return out;
}

async function unpack(bytes: Uint8Array<ArrayBuffer>): Promise<unknown> {
  const flag = bytes[0];
  let body = bytes.subarray(1) as Uint8Array<ArrayBuffer>;
  if (flag === FLAG_GZIP) body = await pipeThrough(body, new DecompressionStream("gzip"));
  else if (flag !== FLAG_RAW) throw new Error("bad_format");
  return JSON.parse(new TextDecoder().decode(body));
}

export type Envelope = { v: 1; iv: string; data: string };

export async function seal(keyRaw: string, value: unknown): Promise<Envelope> {
  const key = await importKey(keyRaw);
  const iv = randomBytes(12);
  const plain = await pack(value);
  const cipher = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plain);
  return { v: 1, iv: toB64Url(iv), data: toB64Url(new Uint8Array(cipher)) };
}

export async function open<T = unknown>(keyRaw: string, envelope: { iv: string; data: string }): Promise<T> {
  const key = await importKey(keyRaw);
  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: fromB64Url(envelope.iv) },
    key,
    fromB64Url(envelope.data),
  );
  return (await unpack(new Uint8Array(plain))) as T;
}

/** Stable, cheap fingerprint used to skip redundant pushes. */
export function fingerprint(value: unknown): string {
  const s = JSON.stringify(value);
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193);
    h2 = Math.imul(h2 ^ c, 0x5bd1e995);
  }
  return `${(h1 >>> 0).toString(36)}${(h2 >>> 0).toString(36)}${s.length.toString(36)}`;
}
