import type { Note, NoteGroup } from "./types";
import { noteGroup as dateLabel } from "./dates";

/** One block of the sidebar list. */
export type Section =
  | { kind: "hidden"; key: "hidden"; notes: Note[] }
  | { kind: "pinned"; key: "pinned"; notes: Note[] }
  | { kind: "group"; key: string; group: NoteGroup; notes: Note[] }
  | { kind: "date"; key: string; label: string; notes: Note[] };

const byRecent = (a: Note, b: Note) => Number(!!b.pinned) - Number(!!a.pinned) || b.updatedAt - a.updatedAt;

/**
 * The sidebar, top to bottom: hidden notes (only while unlocked), pinned notes, your groups,
 * then everything else by when it was last edited.
 */
export function sidebarSections(notes: Record<string, Note>, groups: NoteGroup[], unlocked: boolean, now = new Date()): Section[] {
  const live = Object.values(notes).filter((n) => !n.deletedAt);
  const sections: Section[] = [];
  if (unlocked) sections.push({ kind: "hidden", key: "hidden", notes: live.filter((n) => n.hidden).sort(byRecent) });
  const visible = live.filter((n) => !n.hidden);
  const pinned = visible.filter((n) => n.pinned).sort(byRecent);
  if (pinned.length) sections.push({ kind: "pinned", key: "pinned", notes: pinned });
  const known = new Set(groups.map((g) => g.id));
  for (const g of groups) {
    sections.push({ kind: "group", key: `g:${g.id}`, group: g, notes: visible.filter((n) => !n.pinned && n.groupId === g.id).sort(byRecent) });
  }
  const rest = visible.filter((n) => !n.pinned && !(n.groupId && known.has(n.groupId))).sort(byRecent);
  for (const n of rest) {
    const label = dateLabel(n.updatedAt, now);
    const last = sections[sections.length - 1];
    if (last && last.kind === "date" && last.label === label) last.notes.push(n);
    else sections.push({ kind: "date", key: `d:${label}`, label, notes: [n] });
  }
  return sections;
}

/** The notes in the order you see them (for ⌥↑ / ⌥↓), skipping folded-up groups. */
export function visibleOrder(sections: Section[]): Note[] {
  return sections.flatMap((s) => (s.kind === "group" && s.group.collapsed ? [] : s.notes));
}
