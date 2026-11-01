import { useCallback, useEffect, useLayoutEffect, useRef } from "react";
import type { Editor } from "@tiptap/core";
import { EditorContent, useEditor } from "@tiptap/react";
import { useApp } from "../../store/app";
import { buildExtensions } from "./extensions";
import { safeDoc } from "./safeDoc";
import { BubbleBar } from "./BubbleBar";
import { SlashMenu } from "./SlashMenu";
import { wordCount } from "../../lib/text";
import { formatDate } from "../../lib/dates";

const supportsFieldSizing = typeof CSS !== "undefined" && CSS.supports?.("field-sizing", "content");

/** Remembers scroll position per note for the session. */
const scrollMemory = new Map<string, number>();

export const FLUSH_EVENT = "umbra:flush-editor";

type Props = { noteId: string; scroller: HTMLElement | null };

export function NoteEditor({ noteId, scroller }: Props) {
  const note = useApp((s) => s.notes[noteId]);
  const isShared = useApp((s) => Boolean(s.shares[noteId]));
  const updateNote = useApp((s) => s.updateNote);
  const titleRef = useRef<HTMLTextAreaElement>(null);
  const saveTimer = useRef<number | undefined>(undefined);
  const pending = useRef<Editor | null>(null);
  // The doc object this editor last loaded or produced. Title edits keep the same
  // reference, so only genuinely new documents (another tab, an import) differ.
  const lastDoc = useRef(note?.doc ?? null);

  const focusTitleEnd = useCallback(() => {
    const el = titleRef.current;
    if (!el) return;
    el.focus();
    const len = el.value.length;
    el.setSelectionRange(len, len);
  }, []);

  const flush = useCallback(() => {
    window.clearTimeout(saveTimer.current);
    saveTimer.current = undefined;
    const ed = pending.current;
    pending.current = null;
    if (!ed) return;
    try {
      const doc = ed.getJSON();
      lastDoc.current = doc;
      updateNote(noteId, { doc, text: ed.getText({ blockSeparator: "\n" }) });
    } catch (err) {
      console.error("Could not capture editor state", err);
    }
  }, [noteId, updateNote]);

  const editor = useEditor(
    {
      extensions: buildExtensions({ onExitTop: focusTitleEnd }),
      content: safeDoc(note?.doc, note?.text ?? "") ?? "",
      immediatelyRender: true,
      shouldRerenderOnTransaction: false,
      editorProps: {
        attributes: { class: "prose", spellcheck: "true", "aria-label": "Note body" },
        scrollThreshold: { top: 80, bottom: 140, left: 0, right: 0 },
        scrollMargin: { top: 80, bottom: 140, left: 0, right: 0 },
        handleClick(_view, _pos, event) {
          const link = (event.target as HTMLElement).closest("a[href]") as HTMLAnchorElement | null;
          if (link && (event.metaKey || event.ctrlKey)) {
            window.open(link.href, "_blank", "noopener,noreferrer");
            return true;
          }
          return false;
        },
      },
      onUpdate: ({ editor: ed }) => {
        pending.current = ed;
        window.clearTimeout(saveTimer.current);
        saveTimer.current = window.setTimeout(flush, 320);
      },
      onBlur: () => flush(),
    },
    [noteId],
  );

  // Flush on unmount / page hide / explicit request.
  useEffect(() => {
    const onFlush = () => flush();
    window.addEventListener(FLUSH_EVENT, onFlush);
    return () => {
      window.removeEventListener(FLUSH_EVENT, onFlush);
      flush();
    };
  }, [flush]);

  // A brand-new note: put the caret in the title synchronously, in the same commit that
  // mounts it, so keystrokes typed right after "new note" can't land anywhere else.
  useLayoutEffect(() => {
    const n = useApp.getState().notes[noteId];
    if (n && !n.title && !n.text.trim()) titleRef.current?.focus({ preventScroll: true });
  }, [noteId]);

  // Remember scroll position per note.
  useLayoutEffect(() => {
    if (!scroller) return;
    scroller.scrollTop = scrollMemory.get(noteId) ?? 0;
    return () => {
      scrollMemory.set(noteId, scroller.scrollTop);
    };
  }, [noteId, scroller]);

  // A different document arrived from elsewhere (another tab, an import) — show it,
  // unless you're mid-edit (then your next save wins, as in any last-write-wins app).
  const doc = note?.doc ?? null;
  useEffect(() => {
    if (!editor || doc === lastDoc.current) return;
    lastDoc.current = doc;
    if (editor.isFocused || pending.current) return;
    editor.commands.setContent(safeDoc(doc, useApp.getState().notes[noteId]?.text ?? "") ?? "", { emitUpdate: false });
  }, [editor, doc, noteId]);

  // Auto-grow the title where `field-sizing` isn't supported.
  useLayoutEffect(() => {
    if (supportsFieldSizing) return;
    const el = titleRef.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = `${el.scrollHeight}px`;
  }, [note?.title]);

  // Ctrl/⌘ K with a selection = edit link (handled by the bubble), so expose the editor.
  useEffect(() => {
    if (!editor) return;
    (window as unknown as { __umbraEditor?: Editor }).__umbraEditor = editor;
    return () => {
      const w = window as unknown as { __umbraEditor?: Editor };
      if (w.__umbraEditor === editor) delete w.__umbraEditor;
    };
  }, [editor]);

  if (!note) return null;

  const words = wordCount(`${note.title} ${note.text}`);
  const minutes = Math.round(words / 230);

  return (
    <div
      className="note"
      onMouseDown={(e) => {
        // Clicking the empty space below the text puts the caret at the end.
        if (e.target === e.currentTarget && editor) {
          e.preventDefault();
          editor.commands.focus("end");
        }
      }}
    >
      <textarea
        ref={titleRef}
        className="note-title display"
        rows={1}
        value={note.title}
        placeholder="Untitled"
        aria-label="Title"
        spellCheck
        onChange={(e) => updateNote(noteId, { title: e.target.value.replace(/[\r\n]+/g, " ") })}
        onKeyDown={(e) => {
          if (e.nativeEvent.isComposing) return;
          const el = e.currentTarget;
          if (e.key === "Enter" || (e.key === "ArrowDown" && el.selectionStart === el.value.length)) {
            e.preventDefault();
            if (!editor) return;
            // TipTap defers DOM focus to the next frame; focus synchronously so a
            // fast typist's next keystroke can't land in the title.
            editor.commands.focus("start");
            editor.view.focus();
          }
        }}
      />
      <div className="note-meta mono">
        <span>{formatDate(new Date(note.createdAt), { weekday: false })}</span>
        <span className="sep" />
        <span className="tabular">
          {words.toLocaleString()} word{words === 1 ? "" : "s"}
        </span>
        {minutes >= 1 && (
          <>
            <span className="sep" />
            <span>{minutes} min read</span>
          </>
        )}
        {isShared && (
          <>
            <span className="sep" />
            <span className="note-meta-live">
              <span className="live-dot" /> Shared
            </span>
          </>
        )}
      </div>
      <EditorContent editor={editor} className="note-body" />
      {editor && <BubbleBar editor={editor} />}
      <SlashMenu />
    </div>
  );
}
