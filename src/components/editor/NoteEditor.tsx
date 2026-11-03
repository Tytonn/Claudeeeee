import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { Editor } from "@tiptap/core";
import { EditorContent, useEditor } from "@tiptap/react";
import { useApp } from "../../store/app";
import { buildExtensions } from "./extensions";
import { authForNote } from "../../lib/images";
import { safeDoc } from "./safeDoc";
import { LightCaret } from "../../fx/LightCaret";
import { InkSettle } from "../../fx/InkSettle";
import { fx } from "../../fx/engine";
import { play } from "../../lib/sound";
import { BubbleBar } from "./BubbleBar";
import { SlashMenu } from "./SlashMenu";
import { wordCount } from "../../lib/text";
import { formatDate } from "../../lib/dates";
import { useCollabSession, userFor } from "../../collab/manager";
import { useYText } from "../../collab/useYText";
import { TITLE } from "../../collab/fields";
import { Presence } from "../Presence";
import { Menu } from "../ui/Menu";
import { Popover, pointAnchor } from "../ui/Popover";
import { TITLE_FONTS, isMac } from "../../lib/theme";
import type { TitleFontId } from "../../lib/types";

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
  const [titleMenu, setTitleMenu] = useState<{ x: number; y: number } | null>(null);
  const titlePress = useRef<{ mouse: boolean; selected: boolean } | null>(null);
  const [noteEl, setNoteEl] = useState<HTMLDivElement | null>(null);
  const wordsRef = useRef<HTMLSpanElement>(null);
  const milestone = useRef<number | null>(null);
  const saveTimer = useRef<number | undefined>(undefined);
  const pending = useRef<Editor | null>(null);
  // The doc object this editor last loaded or produced. Title edits keep the same
  // reference, so only genuinely new documents (another tab, an import) differ.
  const lastDoc = useRef(note?.doc ?? null);
  // Shared for co-editing? Then the words live in a live doc that both of you edit.
  const session = useCollabSession(noteId);
  const ytitle = useMemo(() => session?.doc.getText(TITLE) ?? null, [session]);
  const [liveTitle, setLiveTitle] = useYText(ytitle, titleRef);

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
      extensions: buildExtensions({
        onExitTop: focusTitleEnd,
        collab: session ? { doc: session.doc, awareness: session.awareness, user: userFor(useApp.getState().settings) } : undefined,
        imageAuth: () => authForNote(noteId),
      }),
      // A live doc brings its own content.
      content: session ? undefined : (safeDoc(note?.doc, note?.text ?? "") ?? ""),
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
        if (session) return; // the live doc's session keeps the note up to date
        pending.current = ed;
        window.clearTimeout(saveTimer.current);
        saveTimer.current = window.setTimeout(flush, 320);
      },
      onBlur: () => flush(),
    },
    [noteId, session],
  );

  // While this note is open, the live doc syncs quickly and shows you as "here".
  useEffect(() => {
    if (!session) return;
    session.bind();
    return () => session.unbind();
  }, [session]);

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
    if (session) return; // the live doc is the source of truth; never overwrite it
    if (editor.isFocused || pending.current) return;
    editor.commands.setContent(safeDoc(doc, useApp.getState().notes[noteId]?.text ?? "") ?? "", { emitUpdate: false });
  }, [editor, doc, noteId, session]);

  // Auto-grow the title where `field-sizing` isn't supported.
  useLayoutEffect(() => {
    if (supportsFieldSizing) return;
    const el = titleRef.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = `${el.scrollHeight}px`;
  }, [note?.title, liveTitle]);

  // Ctrl/⌘ K with a selection = edit link (handled by the bubble), so expose the editor.
  useEffect(() => {
    if (!editor) return;
    (window as unknown as { __umbraEditor?: Editor }).__umbraEditor = editor;
    return () => {
      const w = window as unknown as { __umbraEditor?: Editor };
      if (w.__umbraEditor === editor) delete w.__umbraEditor;
    };
  }, [editor]);

  const words = note ? wordCount(`${note.title} ${note.text}`) : 0;

  // Every hundred words, a little burst of light by the counter.
  useEffect(() => {
    const step = Math.floor(words / 100);
    if (milestone.current !== null && step > milestone.current && step > 0 && fx.active) {
      const r = wordsRef.current?.getBoundingClientRect();
      if (r) fx.sunburst(r.left + r.width / 2, r.top + r.height / 2);
      play("chime");
    }
    milestone.current = step;
  }, [words]);

  if (!note) return null;
  const minutes = Math.round(words / 230);

  return (
    <div
      className="note"
      ref={setNoteEl}
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
        onPointerDownCapture={(e) => {
          const el = e.currentTarget;
          titlePress.current = { mouse: e.pointerType === "mouse", selected: document.activeElement === el && el.selectionStart !== el.selectionEnd };
        }}
        onMouseDown={(e) => {
          // Don't let the right-click move the caret (or select a word) on its way to the menu.
          const p = titlePress.current;
          if ((e.button === 2 || (isMac && e.button === 0 && e.ctrlKey)) && !p?.selected) e.preventDefault();
        }}
        onContextMenu={(e) => {
          const p = titlePress.current;
          titlePress.current = null;
          if (p && (!p.mouse || p.selected)) return;
          e.preventDefault();
          const r = e.currentTarget.getBoundingClientRect();
          // From the keyboard (no pointer), it opens under the title.
          const fromKeys = e.clientX === 0 && e.clientY === 0;
          setTitleMenu({ x: fromKeys ? r.left + 8 : e.clientX, y: fromKeys ? r.bottom : e.clientY });
        }}
        className="note-title display"
        rows={1}
        value={liveTitle ?? note.title}
        placeholder="Untitled"
        aria-label="Title"
        spellCheck
        onChange={(e) => {
          const title = e.target.value.replace(/[\r\n]+/g, " ");
          if (ytitle) setLiveTitle(title);
          else updateNote(noteId, { title });
        }}
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
      <TitleFontMenu at={titleMenu} onClose={() => setTitleMenu(null)} />
      <div className="note-meta mono">
        <span>{formatDate(new Date(note.createdAt), { weekday: false })}</span>
        <span className="sep" />
        <span className="tabular" ref={wordsRef}>
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
              <span className="live-dot" /> {session ? "Live" : "Shared"}
            </span>
            {session && <Presence session={session} />}
          </>
        )}
      </div>
      <EditorContent editor={editor} className="note-body" />
      <LightCaret editor={editor} container={noteEl} />
      <InkSettle editor={editor} container={noteEl} />
      {editor && <BubbleBar editor={editor} />}
      <SlashMenu />
    </div>
  );
}

/** Right-click a title: its typeface, each one shown in itself. */
function TitleFontMenu({ at, onClose }: { at: { x: number; y: number } | null; onClose: () => void }) {
  const current = useApp((s) => s.settings.titleFont ?? "display");
  const anchor = useMemo(() => (at ? pointAnchor(at.x, at.y) : null), [at]);
  return (
    <Popover open={Boolean(at)} onClose={onClose} anchor={anchor} placement="bottom-start" offsetPx={4} role="menu">
      <Menu
        items={(Object.keys(TITLE_FONTS) as TitleFontId[]).map((id) => ({
          label: TITLE_FONTS[id].name,
          icon: (
            <span className="title-font-aa" style={{ fontFamily: TITLE_FONTS[id].stack, fontStyle: TITLE_FONTS[id].italic ? "italic" : undefined }}>
              Aa
            </span>
          ),
          checked: current === id,
          onSelect: () => {
            useApp.getState().setSettings({ titleFont: id });
            play("pop");
          },
        }))}
        onClose={onClose}
      />
    </Popover>
  );
}
