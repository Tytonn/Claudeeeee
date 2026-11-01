const ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

/** Random base62 id (default 12 chars ≈ 71 bits). */
export function uid(length = 12): string {
  let out = "";
  while (out.length < length) {
    const bytes = crypto.getRandomValues(new Uint8Array(length * 2));
    for (const b of bytes) if (b < 248 && out.length < length) out += ALPHABET[b % 62];
  }
  return out;
}
