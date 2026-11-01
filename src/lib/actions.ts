import { app, sortedNotes } from "../store/app";
import { toast } from "../store/toasts";
import { docToMarkdown, displayTitle, slugify } from "./text";
import { play } from "./sound";
import { FLUSH_EVENT } from "../components/editor/NoteEditor";

export const NEW_COUNTDOWN_EVENT = "umbra:new-countdown";

export function flushEditor() {
  window.dispatchEvent(new Event(FLUSH_EVENT));
}

export function newNote(init?: { title?: string }) {
  flushEditor();
  const id = app().createNote(init);
  play("pop");
  return id;
}

export function trashNote(id: string) {
  flushEditor();
  const s = app();
  const note = s.notes[id];
  if (!note) return;
  const wasBlank = !note.title.trim() && !note.text.trim();
  s.trashNote(id);
  play("drop");
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

export function selectAdjacent(delta: 1 | -1) {
  const s = app();
  const list = sortedNotes(s.notes);
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
