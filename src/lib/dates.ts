import type { Countdown } from "./types";

const DAY = 86_400_000;

export const pad = (n: number) => String(n).padStart(2, "0");

export function toISODate(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function fromISODate(iso: string, time?: string | null): Date {
  const [y, m, d] = iso.split("-").map(Number);
  const [hh, mm] = (time ?? "00:00").split(":").map(Number);
  return new Date(y, (m || 1) - 1, d || 1, hh || 0, mm || 0, 0, 0);
}

export function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/** Whole calendar days from `a` to `b` (DST-safe). */
export function dayDiff(a: Date, b: Date): number {
  return Math.round((startOfDay(b).getTime() - startOfDay(a).getTime()) / DAY);
}

export function isLeap(year: number) {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

function occurrenceIn(year: number, c: Pick<Countdown, "date" | "time">): Date {
  const base = fromISODate(c.date, c.time);
  let month = base.getMonth();
  let day = base.getDate();
  if (month === 1 && day === 29 && !isLeap(year)) day = 28;
  return new Date(year, month, day, base.getHours(), base.getMinutes());
}

export type CountdownState = {
  target: Date;
  start: Date;
  /** Calendar days until target (negative when past). */
  days: number;
  /** Milliseconds until target (negative when past). */
  ms: number;
  phase: "future" | "today" | "past";
  /** 0 → 1 progress from start to target. */
  progress: number;
  /** For yearly events with a past origin year: which occurrence this is (e.g. 26th birthday). */
  nth: number | null;
  hasTime: boolean;
};

export function describeCountdown(c: Pick<Countdown, "date" | "time" | "repeat" | "createdAt">, now: Date = new Date()): CountdownState {
  const hasTime = Boolean(c.time);
  let target: Date;
  let start: Date;
  let nth: number | null = null;

  if (c.repeat === "yearly") {
    const origin = fromISODate(c.date, c.time);
    target = occurrenceIn(now.getFullYear(), c);
    if (dayDiff(now, target) < 0) target = occurrenceIn(now.getFullYear() + 1, c);
    if (dayDiff(origin, target) < 0) {
      // The first occurrence hasn't happened yet (e.g. a wedding date next year).
      target = origin;
      start = new Date(Math.min(c.createdAt, target.getTime() - DAY));
    } else {
      start = occurrenceIn(target.getFullYear() - 1, c);
    }
    const n = target.getFullYear() - origin.getFullYear();
    nth = n > 0 ? n : null;
  } else {
    target = fromISODate(c.date, c.time);
    start = new Date(Math.min(c.createdAt, target.getTime() - DAY));
  }

  const days = dayDiff(now, target);
  const ms = target.getTime() - now.getTime();
  const phase: CountdownState["phase"] = days > 0 ? "future" : days === 0 ? "today" : "past";
  const span = Math.max(1, target.getTime() - start.getTime());
  const progress = phase === "future" ? Math.min(1, Math.max(0, (now.getTime() - start.getTime()) / span)) : 1;

  return { target, start, days, ms, phase, progress, nth, hasTime };
}

const sameYear = (d: Date, now = new Date()) => d.getFullYear() === now.getFullYear();

export function formatDate(d: Date, opts: { weekday?: boolean; year?: "auto" | "always" | "never" } = {}): string {
  const { weekday = true, year = "auto" } = opts;
  const showYear = year === "always" || (year === "auto" && !sameYear(d));
  return d.toLocaleDateString(undefined, {
    weekday: weekday ? "short" : undefined,
    month: "short",
    day: "numeric",
    year: showYear ? "numeric" : undefined,
  });
}

export function formatTime(d: Date): string {
  return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

/** Compact stamp for lists: "now", "4m", "3h", "Yesterday", "Mon", "Oct 3", "Oct 3, 2024". */
export function shortStamp(ts: number, now = Date.now()): string {
  const diff = now - ts;
  if (diff < 60_000) return "now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m`;
  const d = new Date(ts);
  const n = new Date(now);
  const days = dayDiff(d, n);
  if (days === 0) return `${Math.floor(diff / 3_600_000)}h`;
  if (days === 1) return "Yesterday";
  if (days < 7) return d.toLocaleDateString(undefined, { weekday: "short" });
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: sameYear(d, n) ? undefined : "numeric" });
}

/** "just now", "2 minutes ago", "yesterday at 4:12 PM", "Oct 3" … */
export function relativeLong(ts: number, now = Date.now()): string {
  const diff = Math.max(0, now - ts);
  if (diff < 45_000) return "just now";
  if (diff < 3_600_000) {
    const m = Math.max(1, Math.round(diff / 60_000));
    return `${m} minute${m === 1 ? "" : "s"} ago`;
  }
  const d = new Date(ts);
  const days = dayDiff(d, new Date(now));
  if (days === 0) {
    const h = Math.max(1, Math.round(diff / 3_600_000));
    return `${h} hour${h === 1 ? "" : "s"} ago`;
  }
  if (days === 1) return `yesterday at ${formatTime(d)}`;
  return formatDate(d, { weekday: false });
}

export function noteGroup(ts: number, now = new Date()): string {
  const d = new Date(ts);
  const days = dayDiff(d, now);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return "Previous 7 days";
  if (days < 30) return "Previous 30 days";
  return d.toLocaleDateString(undefined, { month: "long", year: sameYear(d, now) ? undefined : "numeric" });
}

export function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`;
}

export function splitDuration(ms: number) {
  const total = Math.max(0, Math.floor(ms / 1000));
  return {
    h: Math.floor(total / 3600),
    m: Math.floor((total % 3600) / 60),
    s: total % 60,
  };
}

/** Human phrasing for a countdown's distance, e.g. "7 weeks", "in 3 days", "tomorrow". */
export function countdownPhrase(state: CountdownState): string {
  const { days, phase } = state;
  if (phase === "today") return "Today";
  if (phase === "past") return days === -1 ? "Yesterday" : `${Math.abs(days)} days ago`;
  if (days === 1) return "Tomorrow";
  if (days < 14) return `${days} days`;
  const weeks = Math.floor(days / 7);
  const rest = days % 7;
  if (days < 70) return rest ? `${weeks} weeks, ${rest} day${rest === 1 ? "" : "s"}` : `${weeks} weeks`;
  const months = Math.round(days / 30.44);
  return `≈ ${months} months`;
}
