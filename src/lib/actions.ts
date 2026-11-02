import { app } from "../store/app";
import { sidebarSections, visibleOrder } from "./noteList";
import { toast } from "../store/toasts";
import { docToMarkdown, displayTitle, isBlank, slugify } from "./text";
import { play } from "./sound";
import { FLUSH_EVENT } from "../components/editor/NoteEditor";
import { fx } from "../fx/engine";
import { dissolve, eclipseWipe, rainWash } from "../fx/dom";
import { setEntrance } from "../fx/intent";

export const NEW_COUNTDOWN_EVENT = "umbra:new-countdown";

export function flushEditor() {
  window.dispatchEvent(new Event(FLUSH_EVENT));
}

/**
 * Opens search with the keyboard already up. Phones only raise the keyboard for a focus made
 * during the tap itself, and the search box doesn't exist yet at that moment — so an invisible
 * stand-in field takes the focus (and the keyboard) right away, then hands both to the search
 * box the instant it appears.
 */
export function openSearch() {
  if (typeof matchMedia !== "undefined" && matchMedia("(pointer: coarse)").matches) {
    const proxy = document.createElement("input");
    proxy.type = "text";
    proxy.tabIndex = -1;
    proxy.setAttribute("aria-hidden", "true");
    proxy.style.cssText = "position:fixed;top:0;left:0;width:1px;height:1px;padding:0;border:0;opacity:0;font-size:16px;pointer-events:none;";
    document.body.appendChild(proxy);
    proxy.focus({ preventScroll: true });
    const done = (e?: FocusEvent) => {
      if (e?.target === proxy) return;
      document.removeEventListener("focusin", done);
      proxy.remove();
    };
    document.addEventListener("focusin", done);
    window.setTimeout(done, 1500);
  }
  app().setUI({ palette: true });
}

export function newNote(init?: { title?: string }) {
  flushEditor();
  if (fx.active) {
    // The diamond ring: sunlight bursts from the edge of the page, and it develops in.
    setEntrance("dawn");
    fx.diamondRing();
    play("dawn");
  } else play("pop");
  const id = app().createNote(init);
  return id;
}

export function trashNote(id: string) {
  flushEditor();
  const s = app();
  const note = s.notes[id];
  if (!note) return;
  const wasBlank = isBlank(note);
  if (fx.active && s.ui.activeId === id && s.ui.view === "notes") {
    // The umbra passes over the page and swallows it — or, in the rain, it's washed away.
    (fx.rain ? rainWash : eclipseWipe)(document.querySelector<HTMLElement>(".canvas .note"), document.querySelector<HTMLElement>("main.canvas"));
    setEntrance("none");
  } else if (fx.active) {
    dissolve(document.querySelector<HTMLElement>(`[data-note-id="${id}"]`));
    play("drop");
  } else play("drop");
  s.trashNote(id);
  if (!wasBlank) {
    toast(`Moved “${displayTitle(note).slice(0, 40)}” to trash`, {
      action: { label: "Undo", run: () => app().restoreNote(id) },
    });
  }
}

export function duplicateNote(id: string) {
  flushEditor();
  const copy = app().duplicateNote(id);
  if (copy) toast("Duplicated", { tone: "success" });
}

export function togglePin(id: string) {
  const s = app();
  const pinned = !s.notes[id]?.pinned;
  s.togglePin(id);
  toast(pinned ? "Pinned to top" : "Unpinned");
}

export async function copyMarkdown(id: string) {
  flushEditor();
  const note = app().notes[id];
  if (!note) return;
  try {
    await navigator.clipboard.writeText(docToMarkdown(note.doc, note.title));
    toast("Copied as Markdown", { tone: "success" });
  } catch {
    toast("Couldn't access the clipboard", { tone: "error" });
  }
}

export function download(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function downloadMarkdown(id: string) {
  flushEditor();
  const note = app().notes[id];
  if (!note) return;
  const md = docToMarkdown(note.doc, note.title);
  download(`${slugify(displayTitle(note))}.md`, new Blob([md], { type: "text/markdown;charset=utf-8" }));
}

// ── Groups ────────────────────────────────────────────────────────────────

/** Files a note into a group (or takes it out of one). */
export function moveNote(noteId: string, groupId: string | null) {
  const s = app();
  const note = s.notes[noteId];
  if (!note || (note.groupId ?? null) === groupId) return;
  const before = note.groupId ?? null;
  s.moveToGroup(noteId, groupId);
  play("pop");
  const group = groupId ? s.groups.find((g) => g.id === groupId) : null;
  // The group lights up as the note lands in it.
  requestAnimationFrame(() => {
    const head = document.querySelector<HTMLElement>(groupId ? `[data-group-head="${groupId}"]` : ".sb-list");
    head?.classList.remove("is-landed");
    void head?.offsetWidth;
    head?.classList.add("is-landed");
  });
  toast(group ? `Moved to ${group.name}${note.pinned ? " (it stays pinned on top)" : ""}` : "Taken out of its group", {
    action: { label: "Undo", run: () => app().moveToGroup(noteId, before) },
  });
}

/** Makes a new group (optionally putting a note straight into it) and starts naming it. */
export function newGroup(noteId?: string) {
  const s = app();
  const id = s.createGroup("New group");
  if (noteId) s.moveToGroup(noteId, id);
  if (!s.settings.sidebar) s.setSettings({ sidebar: true });
  s.setUI({ renaming: id, mobile: "list", view: s.ui.view });
  play("pop");
  return id;
}

export function newNoteInGroup(groupId: string) {
  const s = app();
  if (s.groups.find((g) => g.id === groupId)?.collapsed) s.setGroupCollapsed(groupId, false);
  flushEditor();
  if (fx.active) {
    setEntrance("dawn");
    fx.diamondRing();
    play("dawn");
  } else play("pop");
  return s.createNote({ groupId });
}

/** Removes a group. Its notes stay — they just aren't filed anywhere any more. */
export function deleteGroup(groupId: string) {
  const saved = app().deleteGroup(groupId);
  if (!saved) return;
  play("drop");
  toast(saved.noteIds.length ? `Removed “${saved.group.name}” — its notes are still here` : `Removed “${saved.group.name}”`, {
    action: { label: "Undo", run: () => app().restoreGroup(saved) },
  });
}

export function selectAdjacent(delta: 1 | -1) {
  const s = app();
  const list = visibleOrder(sidebarSections(s.notes, s.groups, s.ui.unlocked));
  if (!list.length) return;
  const i = list.findIndex((n) => n.id === s.ui.activeId);
  const next = list[Math.min(list.length - 1, Math.max(0, (i < 0 ? 0 : i + delta)))];
  if (next) {
    flushEditor();
    s.selectNote(next.id);
    if (s.ui.view !== "notes") s.setUI({ view: "notes" });
  }
}

export function openShare(anchor: string) {
  flushEditor();
  app().setUI({ share: anchor });
}
