import { app } from "../store/app";
import { toast } from "../store/toasts";
import { FLUSH_EVENT } from "../components/editor/NoteEditor";

/*
 * Export as PDF, through the browser's own print window ("Save as PDF"): the open note alone, set
 * as a clean page of ink on white in its own fonts — its title as it looks in the note, then the
 * words, pictures, tables and checklists. Printing any other way (⌘P) makes the same page.
 *
 * Just before printing, a copy of the note is laid on the page (and everything else steps aside:
 * see the print styles in layout.css); straight after, it's gone.
 */

/** The parts of the editor that are for writing, not reading. */
const EDITOR_ONLY = [
  ".collab-caret",
  ".ProseMirror-widget",
  ".ProseMirror-gapcursor",
  ".column-resize-handle",
  ".note-image-ph",
  ".note-image-status",
  ".note-image-zoom",
  ".note-image-handle",
  ".note-image-badge",
  ".note-image-sizes",
].join(",");

let copy: HTMLElement | null = null;
let pageTitle: string | null = null;

/** The note on screen: its page, its words and its title (a shared note's too). */
function openNote() {
  const page = document.querySelector<HTMLElement>(".canvas .note") ?? document.querySelector<HTMLElement>(".viewer-note");
  const body = page?.querySelector<HTMLElement>(".ProseMirror");
  if (!page || !body) return null;
  const t = page.querySelector<HTMLElement>(".note-title");
  // (a shared note's title may still be decoding itself on screen: its label is the real one)
  const title = (t instanceof HTMLTextAreaElement ? t.value : t?.getAttribute("aria-label") || t?.textContent || "").trim();
  return { page, body, title };
}

function lay() {
  clear();
  const note = openNote();
  if (!note) return;
  const doc = document.createElement("article");
  doc.className = "print-doc";
  // the note's own title look
  const looks = note.page.closest(".viewer-note") ?? note.page;
  for (const name of ["data-title-font", "data-title-size", "data-title-align"]) {
    const v = note.page.getAttribute(name) ?? looks.getAttribute(name);
    if (v) doc.setAttribute(name, v);
  }
  if (note.title) {
    const h = document.createElement("h1");
    h.className = "note-title print-title";
    h.textContent = note.title;
    doc.append(h);
  }
  const body = note.body.cloneNode(true) as HTMLElement;
  body.className = "prose print-body";
  for (const a of ["contenteditable", "role", "aria-label", "translate", "tabindex", "spellcheck"]) body.removeAttribute(a);
  body.querySelectorAll(EDITOR_ONLY).forEach((el) => el.remove());
  body.querySelectorAll("[contenteditable]").forEach((el) => el.removeAttribute("contenteditable"));
  body.querySelectorAll("[data-placeholder]").forEach((el) => el.removeAttribute("data-placeholder"));
  body.querySelectorAll(".selectedCell").forEach((el) => el.classList.remove("selectedCell"));
  // someone else's selection, in a shared note, is just the words
  body.querySelectorAll(".collab-selection").forEach((el) => el.replaceWith(...Array.from(el.childNodes)));
  // a copy keeps only what's written into the page, not what's been ticked since: tick them again
  const ticks = note.body.querySelectorAll<HTMLInputElement>('input[type="checkbox"]');
  body.querySelectorAll<HTMLInputElement>('input[type="checkbox"]').forEach((box, i) => {
    const on = ticks[i]?.checked ?? false;
    box.checked = on;
    box.toggleAttribute("checked", on);
  });
  doc.append(body);
  document.body.append(doc);
  copy = doc;
  document.documentElement.classList.add("is-printing");
  // (the browser names the PDF after the page)
  pageTitle = document.title;
  document.title = note.title || "Untitled";
}

function clear() {
  copy?.remove();
  copy = null;
  document.documentElement.classList.remove("is-printing");
  if (pageTitle !== null) {
    document.title = pageTitle;
    pageTitle = null;
  }
}

/** Every print of the page (Export as PDF, ⌘P, the browser's menu) prints the open note this way. */
export function startPrint() {
  addEventListener("beforeprint", lay);
  addEventListener("afterprint", clear);
}

const frame = () => new Promise<void>((r) => requestAnimationFrame(() => r()));

/** Waits (a little) for the note's pictures to arrive: they're decrypted as they come into view. */
async function picturesIn(page: Element | null, ms: number) {
  const until = Date.now() + ms;
  while (page && Date.now() < until) {
    const imgs = Array.from(page.querySelectorAll<HTMLImageElement>(".note-image img.note-image-img"));
    const frames = page.querySelectorAll(".note-image").length;
    if (imgs.length >= frames && imgs.every((img) => img.getAttribute("src") && img.complete)) return;
    await new Promise((r) => setTimeout(r, 100));
  }
}

/** Export as PDF: the print window, with just this note on the page (choose "Save as PDF"). */
export async function exportPdf(id: string) {
  const s = app();
  if (!s.notes[id]) return;
  window.dispatchEvent(new Event(FLUSH_EVENT));
  if (s.ui.activeId !== id || s.ui.view !== "notes" || s.ui.openShared) {
    s.selectNote(id);
    s.setUI({ view: "notes" });
    await frame();
    await frame();
  }
  await picturesIn(document.querySelector(".canvas .note"), 5000);
  if (typeof window.print !== "function") {
    toast("This browser can't print from here.", { tone: "error" });
    return;
  }
  toast("Choose “Save as PDF” in the print window", { duration: 5000 });
  // (let the hint show before the print window takes over)
  await frame();
  await frame();
  window.print();
}
