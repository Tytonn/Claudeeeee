import { create } from "zustand";
import { ApiError, apiLogin, apiLogout, apiSignup, setSessionToken } from "../lib/api";
import { fromB64Url, randomBytes, toB64Url } from "../lib/crypto";

/**
 * Your umbra account, so your notes follow you to other devices.
 *
 * The password never leaves this browser. It's stretched (PBKDF2, 600k rounds) into two
 * keys: `auth` proves it's you to the server (which stores only a hash of it), and the
 * other unwraps your data key — the key every synced record is encrypted with. So the
 * server can't read your notes, and can't reset a forgotten password either.
 */

export type AccountUser = { uid: string; username: string };
type Stored = AccountUser & { token: string; dek: string };
export type SyncState = "off" | "syncing" | "synced" | "offline" | "error";

const KEY = "umbra:account";

function readStored(): Stored | null {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "null");
    if (raw && typeof raw.uid === "string" && typeof raw.username === "string" && typeof raw.token === "string" && typeof raw.dek === "string") return raw as Stored;
  } catch {
    /* fall through */
  }
  return null;
}

const initial = readStored();
setSessionToken(initial?.token ?? null);

export const useAccount = create<{
  user: AccountUser | null;
  sync: SyncState;
  lastSync: number;
  error: string | null;
}>(() => ({
  user: initial ? { uid: initial.uid, username: initial.username } : null,
  sync: initial ? "syncing" : "off",
  lastSync: 0,
  error: null,
}));

/** The key your synced data is encrypted with (base64url), when signed in. */
export function dataKey(): string | null {
  return readStored()?.dek ?? null;
}

export function sessionToken(): string | null {
  return readStored()?.token ?? null;
}

const enc = new TextEncoder();

export function normalizeUsername(raw: string) {
  return raw.trim().toLowerCase();
}

export function usernameProblem(raw: string): string | null {
  const u = normalizeUsername(raw);
  if (u.length < 3) return "At least 3 characters.";
  if (u.length > 24) return "At most 24 characters.";
  if (!/^[a-z0-9][a-z0-9_.-]*$/.test(u)) return "Letters, numbers, dots, dashes and underscores.";
  return null;
}

async function stretch(username: string, password: string) {
  const base = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = new Uint8Array(
    await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: enc.encode(`umbra:v1:${username}`), iterations: 600_000 }, base, 512),
  );
  const auth = toB64Url(bits.slice(0, 32));
  const kek = await crypto.subtle.importKey("raw", bits.slice(32, 64), "AES-GCM", false, ["encrypt", "decrypt"]);
  return { auth, kek };
}

async function wrap(kek: CryptoKey, dek: Uint8Array<ArrayBuffer>) {
  const iv = randomBytes(12);
  const data = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, kek, dek));
  return { iv: toB64Url(iv), data: toB64Url(data) };
}

async function unwrap(kek: CryptoKey, wrapped: { iv: string; data: string }) {
  return new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromB64Url(wrapped.iv) }, kek, fromB64Url(wrapped.data)));
}

const listeners = new Set<(user: AccountUser | null) => void>();
/** Called when you sign in or out (the sync engine listens). */
export function onAccountChange(fn: (user: AccountUser | null) => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function store(s: Stored | null) {
  try {
    if (s) localStorage.setItem(KEY, JSON.stringify(s));
    else localStorage.removeItem(KEY);
  } catch {
    /* private mode: stays signed in for this tab only */
  }
  setSessionToken(s?.token ?? null);
  const user = s ? { uid: s.uid, username: s.username } : null;
  useAccount.setState({ user, sync: s ? "syncing" : "off", error: null, lastSync: 0 });
  listeners.forEach((fn) => fn(user));
}

export function explainAccountError(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.code === "taken") return "That username is taken.";
    if (err.code === "bad_login") return "Wrong username or password.";
    if (err.code === "locked") return "Too many tries — wait a few minutes and try again.";
    if (err.code === "bad_username") return "Usernames are 3–24 letters, numbers, dots, dashes or underscores.";
    if (err.code === "offline") return "You're offline — connect and try again.";
    if (err.code === "no_backend") return "Accounts run on Netlify Functions — deploy the site (or run npm run dev).";
    return `The server said no (${err.code}).`;
  }
  return err instanceof Error ? err.message : "Something went wrong.";
}

export async function signUp(rawUsername: string, password: string) {
  const username = normalizeUsername(rawUsername);
  const problem = usernameProblem(username);
  if (problem) throw new Error(problem);
  if (password.length < 8) throw new Error("Use at least 8 characters for your password.");
  const { auth, kek } = await stretch(username, password);
  const dek = randomBytes(32);
  const res = await apiSignup({ username, auth, wrapped: await wrap(kek, dek) });
  store({ uid: res.uid, username: res.username, token: res.token, dek: toB64Url(dek) });
}

export async function signIn(rawUsername: string, password: string) {
  const username = normalizeUsername(rawUsername);
  if (usernameProblem(username)) throw new Error("Wrong username or password.");
  const { auth, kek } = await stretch(username, password);
  const res = await apiLogin({ username, auth });
  let dek: Uint8Array;
  try {
    dek = await unwrap(kek, res.wrapped);
  } catch {
    throw new Error("Couldn't unlock your account's data on this device.");
  }
  store({ uid: res.uid, username: res.username, token: res.token, dek: toB64Url(dek) });
}

export async function signOut() {
  await apiLogout().catch(() => {});
  store(null);
}

/** The server no longer recognizes this device's session (signed out elsewhere, or expired). */
export function sessionExpired() {
  store(null);
  useAccount.setState({ error: "You were signed out. Sign in again to keep syncing." });
}
