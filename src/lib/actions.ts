import { app, sortedNotes } from "../store/app";
import { toast } from "../store/toasts";
import { docToMarkdown, displayTitle, slugify } from "./text";
import { play } from "./sound";
import { FLUSH_EVENT } from "../components/editor/NoteEditor";
import { fx } from "../fx/engine";
import { dissolve, eclipseWipe, rainWash } from "../fx/dom";
import { setEntrance } from "../fx/intent";

export const NEW_COUNTDOWN_EVENT = "umbra:new-countdown";

export function flushEditor() {
  window.dispatchEvent(new Event(FLUSH_EVENT));
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
  const wasBlank = !note.title.trim() && !note.text.trim();
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
