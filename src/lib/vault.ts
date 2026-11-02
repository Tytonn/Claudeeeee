import { app } from "../store/app";
import { toast } from "../store/toasts";
import { fromB64Url, randomBytes, toB64Url } from "./crypto";
import type { Vault } from "./types";
import { play } from "./sound";
import { flushEditor } from "./actions";
import { fx } from "../fx/engine";
import { vanish } from "../fx/dom";

/**
 * Hidden notes. A note you hide leaves the list, search and the trash; to see hidden notes
 * again you search "hidden" and enter your 4-digit PIN.
 *
 * The PIN is only ever kept as a salted, slow hash. It's a privacy screen, not a safe: it
 * keeps hidden notes out of sight of anyone using this device, and wrong guesses are slowed
 * down — but the notes themselves are stored (and synced, end-to-end encrypted) like any other.
 */

export const PIN_LENGTH = 4;
const ITERATIONS = 210_000;
const enc = new TextEncoder();

async function derive(pin: string, salt: Uint8Array<ArrayBuffer>, iterations: number): Promise<Uint8Array> {
  const base = await crypto.subtle.importKey("raw", enc.encode(`umbra:pin:${pin}`), "PBKDF2", false, ["deriveBits"]);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, base, 256));
}

export async function makeVault(pin: string): Promise<Vault> {
  const salt = randomBytes(16);
  const hash = await derive(pin, salt, ITERATIONS);
  return { v: 1, salt: toB64Url(salt), hash: toB64Url(hash), iter: ITERATIONS, updatedAt: Date.now() };
}

export async function checkPin(vault: Vault, pin: string): Promise<boolean> {
  const got = await derive(pin, fromB64Url(vault.salt), vault.iter);
  const want = fromB64Url(vault.hash);
  if (got.length !== want.length) return false;
  let diff = 0;
  for (let i = 0; i < got.length; i++) diff |= got[i] ^ want[i];
  return diff === 0;
}

// ── Wrong guesses slow things down (per device) ──────────────────────────

const FAILS_KEY = "umbra:pin-fails";
type Fails = { n: number; until: number };

export function readFails(): Fails {
  try {
    const raw = JSON.parse(localStorage.getItem(FAILS_KEY) ?? "null");
    if (raw && typeof raw.n === "number" && typeof raw.until === "number") return raw;
  } catch {
    /* fall through */
  }
  return { n: 0, until: 0 };
}

/** Records a wrong PIN. After five, each further miss means a wait (30s, doubling, up to 10 minutes). */
export function failedPin(): Fails {
  const f = readFails();
  const n = f.n + 1;
  const until = n >= 5 ? Date.now() + Math.min(600_000, 30_000 * 2 ** (n - 5)) : 0;
  const next = { n, until };
  try {
    localStorage.setItem(FAILS_KEY, JSON.stringify(next));
  } catch {
    /* ignore */
  }
  return next;
}

export function clearFails() {
  try {
    localStorage.removeItem(FAILS_KEY);
  } catch {
    /* ignore */
  }
}

// ── Actions ───────────────────────────────────────────────────────────────

/** Search → "Hidden notes": straight in if they're unlocked, otherwise the PIN pad (or making a PIN). */
export function openHidden() {
  const s = app();
  if (s.ui.unlocked) {
    revealHidden();
    return;
  }
  s.setUI({ vault: { mode: s.vault ? "unlock" : "setup", then: { open: true } } });
}

/** Shows the Hidden section: the list comes into view (on a phone, the list page). */
export function revealHidden() {
  const s = app();
  if (s.ui.mobile !== "list") s.setUI({ mobile: "list" });
  if (!s.settings.sidebar) s.setSettings({ sidebar: true });
  requestAnimationFrame(() => {
    const el = document.querySelector<HTMLElement>(".sb-vault");
    el?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    el?.classList.remove("is-arriving");
    void el?.offsetWidth;
    el?.classList.add("is-arriving");
  });
}

/** Hides a note. The first time, you choose a PIN first. */
export function hideNote(id: string) {
  const s = app();
  if (!s.notes[id]) return;
  if (!s.vault) {
    s.setUI({ vault: { mode: "setup", then: { hide: id } } });
    return;
  }
  commitHide(id);
}

export function commitHide(id: string) {
  flushEditor();
  const s = app();
  const note = s.notes[id];
  if (!note) return;
  const row = document.querySelector<HTMLElement>(`.sb-item[data-note-id="${id}"]`);
  // Unlocked, it just moves into the Hidden section; locked, it slips out of sight.
  if (!s.ui.unlocked && fx.active) vanish(row);
  play("eclipse");
  s.setHidden(id, true);
  toast(s.ui.unlocked ? "Moved to Hidden" : "Hidden — search “hidden” to find it again", {
    action: { label: "Undo", run: () => app().setHidden(id, false) },
  });
}

export function unhideNote(id: string) {
  const s = app();
  if (!s.notes[id]) return;
  s.setHidden(id, false);
  play("pop");
  toast("Back with your other notes");
}

/** Puts hidden notes away again. */
export function lockHidden(quiet = false) {
  const s = app();
  if (!s.ui.unlocked) return;
  flushEditor();
  const section = document.querySelector<HTMLElement>(".sb-vault");
  if (section && fx.active && !quiet) vanish(section);
  s.setUnlocked(false);
  if (!quiet) play("drop");
}

/** Hidden notes lock themselves when you've been away from the app for a minute. */
export function startVaultWatch() {
  let hiddenAt = 0;
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) hiddenAt = Date.now();
    else if (hiddenAt && Date.now() - hiddenAt > 60_000) lockHidden(true);
  });
}
