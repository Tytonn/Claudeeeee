import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import { buildExtensions } from "../components/editor/extensions";
import { BubbleBar } from "../components/editor/BubbleBar";
import { SlashMenu } from "../components/editor/SlashMenu";
import { LightCaret } from "../fx/LightCaret";
import { useApp } from "../store/app";
import { writeTokenFor } from "../lib/crypto";
import { CollabSession } from "../collab/session";
import { userFor } from "../collab/manager";
import { useYText } from "../collab/useYText";
import { TITLE } from "../collab/fields";

const noop = () => () => {};

/** Re-renders whenever the session's status, permissions or collaborators change. */
export function useSessionVersion(session: CollabSession | null) {
  return useSyncExternalStore(session?.subscribe ?? noop, () => session?.version ?? 0);
}

/** Joins a shared note's live doc as a guest — with edit rights if the owner allows it. */
export function useGuestSession(id: string, keyRaw: string, enabled: boolean): CollabSession | null {
  const [session, setSession] = useState<CollabSession | null>(null);
  useEffect(() => {
    if (!enabled || !keyRaw) return;
    let s: CollabSession | null = null;
    let cancelled = false;
    void writeTokenFor(keyRaw).then((token) => {
      if (cancelled) return;
      s = new CollabSession({ shareId: id, key: keyRaw, token, owner: false, user: userFor(useApp.getState().settings, "Friend") });
      s.start();
      setSession(s);
    });
    const unsub = useApp.subscribe((st, prev) => {
      if (st.settings.name !== prev.settings.name || st.settings.accent !== prev.settings.accent) s?.setUser(userFor(st.settings, "Friend"));
    });
    return () => {
      cancelled = true;
      unsub();
      s?.stop();
      setSession(null);
    };
  }, [id, keyRaw, enabled]);
  return session;
}

/** The shared note, editable in place: title and body, with everyone's cursors. */
export function LiveNote({ session, onTitle }: { session: CollabSession; onTitle?: (title: string) => void }) {
  useSessionVersion(session);
  const canEdit = session.canWrite;
  const titleRef = useRef<HTMLTextAreaElement>(null);
  const [noteEl, setNoteEl] = useState<HTMLDivElement | null>(null);
  const ytitle = useMemo(() => session.doc.getText(TITLE), [session]);
  const [title, setTitle] = useYText(ytitle, titleRef);

  const editor = useEditor(
    {
      extensions: buildExtensions({
        onExitTop: () => {
          const el = titleRef.current;
          if (!el) return;
          el.focus();
          el.setSelectionRange(el.value.length, el.value.length);
        },
        collab: { doc: session.doc, awareness: session.awareness, user: userFor(useApp.getState().settings, "Friend") },
      }),
      editable: canEdit,
      immediatelyRender: true,
      shouldRerenderOnTransaction: false,
      editorProps: {
        attributes: { class: "prose", spellcheck: "true", "aria-label": "Note body" },
        handleClick(_view, _pos, event) {
          const link = (event.target as HTMLElement).closest("a[href]") as HTMLAnchorElement | null;
          if (link && (event.metaKey || event.ctrlKey || !canEdit)) {
            window.open(link.href, "_blank", "noopener,noreferrer");
            return true;
          }
          return false;
        },
      },
    },
    [session],
  );

  useEffect(() => {
    if (editor && editor.isEditable !== canEdit) editor.setEditable(canEdit);
  }, [editor, canEdit]);

  useEffect(() => {
    session.bind();
    return () => session.unbind();
  }, [session]);

  useEffect(() => {
    onTitle?.(title ?? "");
  }, [title, onTitle]);

  return (
    <div className="note live-note" ref={setNoteEl}>
      <textarea
        ref={titleRef}
        className="note-title display"
        rows={1}
        value={title ?? ""}
        placeholder="Untitled"
        aria-label="Title"
        readOnly={!canEdit}
        spellCheck
        onChange={(e) => setTitle(e.target.value.replace(/[\r\n]+/g, " "))}
        onKeyDown={(e) => {
          if (e.nativeEvent.isComposing || !editor) return;
          const el = e.currentTarget;
          if (e.key === "Enter" || (e.key === "ArrowDown" && el.selectionStart === el.value.length)) {
            e.preventDefault();
            editor.commands.focus("start");
            editor.view.focus();
          }
        }}
      />
      <EditorContent editor={editor} className="note-body" />
      <LightCaret editor={editor} container={noteEl} />
      {editor && canEdit && <BubbleBar editor={editor} />}
      <SlashMenu />
    </div>
  );
}
