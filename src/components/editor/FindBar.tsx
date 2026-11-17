import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import type { Editor } from "@tiptap/core";
import { create } from "zustand";
import { AnimatePresence, motion, useAnimate } from "motion/react";
import { CaseSensitive, ChevronDown, ChevronRight, ChevronUp, Search, WholeWord, X } from "lucide-react";
import { IconButton } from "../ui/IconButton";
import { toast } from "../../store/toasts";
import { useApp } from "../../store/app";
import { ALT, MOD, SHIFT, isMac } from "../../lib/theme";
import { useIsMobile } from "../../lib/hooks";
import { keepBefore, restoreVersion } from "../../lib/history";
import { clearFind, findInText, findState, inCaseOf, replaceAll, replaceCurrent, revealCurrent, selectCurrent, setFind, stepFind, type FindOptions } from "./find";

/**
 * Find and replace, in the open note: Ctrl/⌘ F. Every match is marked as you type (the first one
 * after the caret is the current one); Enter and Shift+Enter step through them; Esc puts you on
 * the current one, in the note. The replace row (Ctrl+H, ⌥⌘F on a Mac, or the arrow on the left)
 * replaces one at a time, or all at once — one step to undo, with a version of the note kept
 * first. The title is kept apart from the words, so it's not stepped through, but Replace all
 * changes it too.
 */

/** What find works on: the open note's editor, and its title. */
export type FindTarget = {
  editor: Editor;
  /** The note, in your notes (a version of it is kept before Replace all) — none for a friend's note. */
  noteId: string | null;
  title: { get(): string; set(value: string): void } | null;
};

type FindUI = {
  open: boolean;
  /** The replace row is showing. */
  replace: boolean;
  query: string;
  replacement: string;
  caseSensitive: boolean;
  wholeWord: boolean;
  /** Bumped to put the caret in a field (`field`), with what's in it selected. */
  focus: number;
  field: "find" | "replace";
  target: FindTarget | null;
};

export const useFind = create<FindUI>(() => ({
  open: false,
  replace: false,
  query: "",
  replacement: "",
  caseSensitive: false,
  wholeWord: false,
  focus: 0,
  field: "find",
  target: null,
}));

/** The open note's editor offers itself to find (NoteEditor, a friend's LiveNote). */
export function useFindTarget(editor: Editor | null, noteId: string | null, title: FindTarget["title"]) {
  const latest = useRef(title);
  latest.current = title;
  const hasTitle = Boolean(title);
  useEffect(() => {
    if (!editor) return;
    const target: FindTarget = {
      editor,
      noteId,
      title: hasTitle ? { get: () => latest.current?.get() ?? "", set: (v) => latest.current?.set(v) } : null,
    };
    useFind.setState({ target });
    return () => {
      if (useFind.getState().target !== target) return;
      useFind.setState({ target: null });
      // (no note open after this — the trash, say: find closes. Another note opening in its
      // place takes over at once, and find stays open on it.)
      window.setTimeout(() => {
        if (!useFind.getState().target) useFind.setState({ open: false });
      }, 0);
    };
  }, [editor, noteId, hasTitle]);
}

/** Can Ctrl/⌘ F be find right now (rather than the browser's own)? */
export function canFind(): boolean {
  const t = useFind.getState().target;
  return Boolean(t && !t.editor.isDestroyed && !document.querySelector('[role="dialog"][aria-modal="true"]'));
}

/** What's selected — a word or a few, on one line — is what you're looking for. */
function pickedText(editor: Editor | null | undefined): string {
  const el = document.activeElement;
  if (el instanceof HTMLTextAreaElement && el.classList.contains("note-title") && el.selectionStart !== el.selectionEnd) {
    return el.value.slice(el.selectionStart, el.selectionEnd).slice(0, 120);
  }
  if (!editor || editor.isDestroyed) return "";
  const { from, to, empty } = editor.state.selection;
  if (empty || to - from > 120) return "";
  const text = editor.state.doc.textBetween(from, to, "\n");
  return /\n/.test(text) ? "" : text;
}

/** Opens find (with the replace row, if asked) — on what's selected, if anything is. */
export function openFind(opts: { replace?: boolean } = {}) {
  const s = useFind.getState();
  const picked = pickedText(s.target?.editor);
  const query = picked.trim() ? picked : s.query;
  const replace = Boolean(opts.replace) || s.replace;
  useFind.setState({ open: true, query, replace, focus: s.focus + 1, field: opts.replace && query ? "replace" : "find" });
}

/** Closes find. `land`: put the caret on the current match, in the note (as Esc does). */
export function closeFind(opts: { land?: boolean } = {}) {
  const { target, open } = useFind.getState();
  if (!open) return;
  const editor = target?.editor;
  if (opts.land && editor && !editor.isDestroyed && !selectCurrent(editor)) editor.commands.focus(undefined, { scrollIntoView: false });
  useFind.setState({ open: false });
  clearFind(editor);
}

/** How much of the top of the note the bar covers (so a match is never brought into view under it). */
function clearTopFor(editor: Editor): number {
  const b = document.querySelector(".find-bar")?.getBoundingClientRect();
  const sc = editor.view.dom.closest(".canvas-scroll")?.getBoundingClientRect();
  return b && sc ? Math.max(48, b.bottom - sc.top + 24) : 120;
}

/** The next or previous match, while find is open (F3, Ctrl/⌘ G — from the note, too). */
export function findStep(step: 1 | -1) {
  const { target, open } = useFind.getState();
  if (!open || !target || target.editor.isDestroyed) return;
  stepFind(target.editor, step);
  requestAnimationFrame(() => revealCurrent(target.editor, clearTopFor(target.editor)));
}

const plural = (n: number, one: string, many: string) => `${n.toLocaleString()} ${n === 1 ? one : many}`;

/** Replaces every match in `text` (from the end back, so each place stays true). */
function replaceIn(text: string, query: string, opts: FindOptions, replacement: string): { text: string; count: number } {
  const at = findInText(text, query, opts);
  let out = text;
  for (let i = at.length - 1; i >= 0; i--) out = out.slice(0, at[i]) + inCaseOf(text.slice(at[i], at[i] + query.length), replacement, opts) + out.slice(at[i] + query.length);
  return { text: out, count: at.length };
}

export function FindBar() {
  const open = useFind((s) => s.open);
  const target = useFind((s) => s.target);
  // (asked to open, but no note came to find in: let it go, rather than turn up later out of the blue)
  useEffect(() => {
    if (!open || target) return;
    const t = window.setTimeout(() => {
      if (!useFind.getState().target) useFind.setState({ open: false });
    }, 1500);
    return () => window.clearTimeout(t);
  }, [open, target]);
  return <AnimatePresence>{open && target && <Bar key="find" target={target} />}</AnimatePresence>;
}

function Bar({ target }: { target: FindTarget }) {
  const query = useFind((s) => s.query);
  const replacement = useFind((s) => s.replacement);
  const caseSensitive = useFind((s) => s.caseSensitive);
  const wholeWord = useFind((s) => s.wholeWord);
  const showReplace = useFind((s) => s.replace);
  const focus = useFind((s) => s.focus);
  const field = useFind((s) => s.field);
  const editor = target.editor;
  const isMobile = useIsMobile();
  const bar = useRef<HTMLDivElement>(null);
  const findInput = useRef<HTMLInputElement>(null);
  const replaceInput = useRef<HTMLInputElement>(null);
  /** Where the caret was when find opened: the search goes on from there. */
  const anchor = useRef<number | undefined>(undefined);
  const [, rerender] = useState(0);
  const [field_, animateField] = useAnimate<HTMLLabelElement>();
  const opts: FindOptions = { caseSensitive, wholeWord };
  const canReplace = editor.isEditable;

  const reveal = () => requestAnimationFrame(() => revealCurrent(editor, clearTopFor(editor)));

  // Opened (again): the caret into the field asked for, its words selected, ready to type over —
  // at once, in the same commit, so not a keystroke typed straight after Ctrl/⌘ F goes astray.
  useLayoutEffect(() => {
    anchor.current = editor.isDestroyed ? undefined : editor.state.selection.from;
    const el = field === "replace" && replaceInput.current ? replaceInput.current : findInput.current;
    el?.focus({ preventScroll: true });
    el?.select();
    // (the note's editor focuses itself a frame late: one still on its way mustn't take the caret back)
    const raf = requestAnimationFrame(() => {
      if (el && !editor.isDestroyed && editor.view.dom.contains(document.activeElement)) el.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(raf);
  }, [focus]); // eslint-disable-line react-hooks/exhaustive-deps

  // Another note opened under the bar: look from its own caret.
  const lastEditor = useRef(editor);
  if (lastEditor.current !== editor) {
    lastEditor.current = editor;
    anchor.current = undefined;
  }

  // The note's marks follow what you type here (in a long note, once you pause — not at every
  // letter) — and are gone when find closes.
  useEffect(() => {
    if (editor.isDestroyed) return;
    const look = () => {
      if (editor.isDestroyed) return;
      setFind(editor, query, opts, anchor.current);
      if (query) reveal();
    };
    if (editor.state.doc.content.size < 60_000) {
      look();
      return;
    }
    const t = window.setTimeout(look, 140);
    return () => window.clearTimeout(t);
  }, [editor, query, caseSensitive, wholeWord]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => clearFind(editor), [editor]);

  // The count follows the note: your typing, a friend's edits — and whether you can edit it at all.
  useEffect(() => {
    const on = () => rerender((n) => n + 1);
    editor.on("transaction", on);
    editor.on("update", on);
    return () => {
      editor.off("transaction", on);
      editor.off("update", on);
    };
  }, [editor]);

  const st = findState(editor);
  const total = st?.matches.length ?? 0;
  const current = st?.current ?? -1;
  const titleText = target.title?.get() ?? "";
  const inTitle = query && titleText ? findInText(titleText, query, opts).length : 0;
  const none = Boolean(query) && total === 0;

  const set = (patch: Partial<Pick<ReturnType<typeof useFind.getState>, "query" | "replacement" | "caseSensitive" | "wholeWord" | "replace">>) => useFind.setState(patch);
  // (nothing to go to: the field shakes its head)
  const shake = () => {
    if (field_.current) void animateField(field_.current, { x: [0, -5, 5, -3, 3, 0] }, { duration: 0.32 });
  };

  /** (a search still waiting for you to pause — in a long note — done now: what's acted on is what's typed) */
  const sync = () => {
    const now = findState(editor);
    if (now && (now.query !== query || now.opts.caseSensitive !== caseSensitive || now.opts.wholeWord !== wholeWord)) setFind(editor, query, opts, anchor.current);
    return findState(editor)?.matches.length ?? 0;
  };

  const go = (step: 1 | -1) => {
    if (!sync()) return shake();
    stepFind(editor, step);
    reveal();
  };

  const replaceOne = () => {
    if (!canReplace) return;
    sync();
    if (!replaceCurrent(editor, replacement)) return shake();
    reveal();
  };

  const replaceEvery = () => {
    if (!canReplace || !query) return;
    const found = sync();
    const titleNow = target.title?.get() ?? "";
    const inTitleNow = titleNow ? replaceIn(titleNow, query, opts, replacement) : { text: titleNow, count: 0 };
    if (!found && !inTitleNow.count) return shake();
    // (the note as it is now, kept as a version first — read at once, before anything changes)
    const before = target.noteId ? keepBefore(target.noteId, "replace") : Promise.resolve(null);
    const body = replaceAll(editor, replacement);
    if (inTitleNow.count) target.title?.set(inTitleNow.text);
    const n = body + inTitleNow.count;
    const noteId = target.noteId;
    toast(`Replaced ${plural(n, "match", "matches")}${inTitleNow.count ? ` — ${inTitleNow.count === n ? "in the title" : `${inTitleNow.count} in the title`}` : ""}`, {
      tone: "success",
      duration: 8000,
      action: {
        label: "Undo",
        run: () => {
          if (!editor.isDestroyed) {
            if (body) editor.commands.undo();
            if (inTitleNow.count && target.title?.get() === inTitleNow.text) target.title.set(titleNow);
          } else if (noteId && useApp.getState().notes[noteId]) {
            // (the note's closed since: bring back the version kept just before)
            void before.then((v) => v && restoreVersion(noteId, v.id));
          }
        },
      },
    });
  };

  const onKey = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    const mod = isMac ? e.metaKey : e.ctrlKey;
    const inReplace = e.target === replaceInput.current;
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      closeFind({ land: true });
      return;
    }
    if (e.key === "Enter" && !e.nativeEvent.isComposing && (e.target === findInput.current || inReplace)) {
      e.preventDefault();
      if (inReplace) {
        if (mod || (e.ctrlKey && e.altKey)) replaceEvery();
        else replaceOne();
      } else go(e.shiftKey ? -1 : 1);
      return;
    }
    if (e.key === "F3" || (mod && !e.altKey && e.code === "KeyG")) {
      e.preventDefault();
      go(e.shiftKey ? -1 : 1);
      return;
    }
    if (mod && !e.shiftKey && !e.altKey && e.code === "KeyF") {
      // (Ctrl/⌘ F again: back to the find field, its words selected)
      e.preventDefault();
      findInput.current?.focus();
      findInput.current?.select();
      return;
    }
    if (e.altKey && !mod && !e.shiftKey && (e.code === "KeyC" || e.code === "KeyW")) {
      e.preventDefault();
      if (e.code === "KeyC") set({ caseSensitive: !caseSensitive });
      else set({ wholeWord: !wholeWord });
    }
  };

  const count = !query ? "" : total ? `${current >= 0 ? (current + 1).toLocaleString() : "–"} of ${total.toLocaleString()}${st?.capped ? "+" : ""}` : inTitle ? "Only in the title" : "No results";
  const replaceKbd = isMac ? `${ALT} ${MOD} F` : "Ctrl H";

  return (
    <motion.div
      ref={bar}
      className={`find-bar ${showReplace && canReplace ? "has-replace" : ""}`}
      role="search"
      aria-label="Find in this note"
      onKeyDown={onKey}
      initial={{ opacity: 0, y: -8, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -6, scale: 0.98, transition: { duration: 0.12 } }}
      transition={{ type: "spring", stiffness: 520, damping: 38 }}
    >
      <div className="find-row">
        {canReplace ? (
          <IconButton
            label={showReplace ? "Hide replace" : "Replace"}
            kbd={showReplace ? undefined : replaceKbd}
            size="sm"
            tabIndex={-1}
            className={`find-toggle-replace ${showReplace ? "is-open" : ""}`}
            onClick={() => {
              set({ replace: !showReplace });
              if (!showReplace) requestAnimationFrame(() => replaceInput.current?.focus());
            }}
          >
            <ChevronRight size={15} strokeWidth={1.8} />
          </IconButton>
        ) : (
          <span className="find-lead" aria-hidden>
            <Search size={14} strokeWidth={1.8} />
          </span>
        )}
        <label ref={field_} className={`find-field ${none ? "is-none" : ""}`}>
          <input
            ref={findInput}
            className="find-input"
            value={query}
            placeholder="Find in this note"
            aria-label="Find"
            spellCheck={false}
            autoComplete="off"
            autoCapitalize="off"
            autoCorrect="off"
            enterKeyHint="search"
            onChange={(e) => set({ query: e.target.value })}
          />
          <span className={`find-count tabular ${none && !inTitle ? "is-none" : ""}`} aria-live="polite">
            {count}
          </span>
        </label>
        <IconButton label="Match case" kbd={`${ALT} C`} size="sm" tabIndex={-1} active={caseSensitive} aria-pressed={caseSensitive} onClick={() => set({ caseSensitive: !caseSensitive })}>
          <CaseSensitive size={17} strokeWidth={1.7} />
        </IconButton>
        <IconButton label="Whole word" kbd={`${ALT} W`} size="sm" tabIndex={-1} active={wholeWord} aria-pressed={wholeWord} onClick={() => set({ wholeWord: !wholeWord })}>
          <WholeWord size={17} strokeWidth={1.7} />
        </IconButton>
        <span className="find-sep" aria-hidden />
        <IconButton label="Previous" kbd={`${SHIFT} ↵`} size="sm" tabIndex={-1} disabled={!total} onClick={() => go(-1)}>
          <ChevronUp size={16} strokeWidth={1.8} />
        </IconButton>
        <IconButton label="Next" kbd="↵" size="sm" tabIndex={-1} disabled={!total} onClick={() => go(1)}>
          <ChevronDown size={16} strokeWidth={1.8} />
        </IconButton>
        <IconButton label="Close" kbd="Esc" size="sm" tabIndex={-1} onClick={() => closeFind({ land: true })}>
          <X size={15} strokeWidth={1.8} />
        </IconButton>
      </div>
      <AnimatePresence initial={false}>
        {showReplace && canReplace && (
          <motion.div
            key="replace"
            className="find-replace"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
          >
            <div className="find-row">
              <span className="find-lead" aria-hidden />
              <label className="find-field">
                <input
                  ref={replaceInput}
                  className="find-input"
                  value={replacement}
                  placeholder="Replace with"
                  aria-label="Replace with"
                  spellCheck={false}
                  autoComplete="off"
                  autoCapitalize="off"
                  autoCorrect="off"
                  enterKeyHint="done"
                  onChange={(e) => set({ replacement: e.target.value })}
                />
              </label>
              <button type="button" className="ghost-btn sm find-btn" disabled={!total} onClick={replaceOne} title={isMobile ? undefined : "Replace this one, and go on to the next (↵)"}>
                Replace
              </button>
              <button type="button" className="ghost-btn sm find-btn is-all" disabled={!total && !inTitle} onClick={replaceEvery} title={isMobile ? undefined : `Replace every match, the title's too (${MOD} ↵)`}>
                {isMobile ? "All" : "Replace all"}
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
