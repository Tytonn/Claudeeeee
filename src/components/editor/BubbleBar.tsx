import { useEffect, useRef, useState } from "react";
import type { Editor } from "@tiptap/core";
import { useEditorState } from "@tiptap/react";
import { BubbleMenu } from "@tiptap/react/menus";
import { CellSelection } from "@tiptap/pm/tables";
import { motion } from "motion/react";
import { Bold, Check, Code, Highlighter, Italic, Link2, Strikethrough, Unlink } from "lucide-react";
import { MOD, SHIFT } from "../../lib/theme";
import { Tooltip } from "../ui/Tooltip";

export const LINK_EVENT = "umbra:link";

function normalizeUrl(raw: string): string | null {
  const v = raw.trim();
  if (!v) return null;
  if (/^(https?:|mailto:|tel:)/i.test(v)) return v;
  if (/^[\w.-]+\.[a-z]{2,}(\/.*)?$/i.test(v) || v.startsWith("www.")) return `https://${v}`;
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) return `mailto:${v}`;
  return null;
}

export function BubbleBar({ editor }: { editor: Editor }) {
  const [shown, setShown] = useState(false);
  const [linkMode, setLinkMode] = useState(false);
  const [href, setHref] = useState("");
  const input = useRef<HTMLInputElement>(null);

  const state = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      bold: e.isActive("bold"),
      italic: e.isActive("italic"),
      strike: e.isActive("strike"),
      code: e.isActive("code"),
      highlight: e.isActive("highlight"),
      link: e.isActive("link"),
      href: (e.getAttributes("link").href as string | undefined) ?? "",
    }),
  });

  useEffect(() => {
    if (!shown) setLinkMode(false);
  }, [shown]);

  useEffect(() => {
    if (linkMode) requestAnimationFrame(() => input.current?.focus());
  }, [linkMode]);

  // Ctrl/⌘ K while text is selected opens link editing (dispatched by the global shortcut handler).
  useEffect(() => {
    const onLink = () => {
      if (editor.state.selection.empty) return;
      setHref((editor.getAttributes("link").href as string | undefined) ?? "");
      setLinkMode(true);
    };
    window.addEventListener(LINK_EVENT, onLink);
    return () => window.removeEventListener(LINK_EVENT, onLink);
  }, [editor]);

  const applyLink = () => {
    const url = normalizeUrl(href);
    const chain = editor.chain().focus().extendMarkRange("link");
    if (url) chain.setLink({ href: url }).run();
    else chain.unsetLink().run();
    setLinkMode(false);
  };

  const buttons = [
    { key: "bold", icon: Bold, label: "Bold", kbd: `${MOD} B`, active: state.bold, run: () => editor.chain().focus().toggleBold().run() },
    { key: "italic", icon: Italic, label: "Italic", kbd: `${MOD} I`, active: state.italic, run: () => editor.chain().focus().toggleItalic().run() },
    { key: "strike", icon: Strikethrough, label: "Strikethrough", kbd: `${MOD} ${SHIFT} S`, active: state.strike, run: () => editor.chain().focus().toggleStrike().run() },
    { key: "code", icon: Code, label: "Inline code", kbd: `${MOD} E`, active: state.code, run: () => editor.chain().focus().toggleCode().run() },
    { key: "highlight", icon: Highlighter, label: "Highlight", kbd: `${MOD} ${SHIFT} H`, active: state.highlight, run: () => editor.chain().focus().toggleHighlight().run() },
  ];

  return (
    <BubbleMenu
      editor={editor}
      className="bubble-anchor"
      options={{
        placement: "top",
        offset: 10,
        flip: { padding: 12 },
        shift: { padding: 12 },
        onShow: () => setShown(true),
        onHide: () => setShown(false),
      }}
      shouldShow={({ editor: e, from, to }) => {
        if (from === to || !e.isEditable) return false;
        if (e.isActive("codeBlock")) return false;
        // Whole cells selected (a table's row or column): the table's own menu is the one that
        // matters, and the shortcuts (⌘B…) still format every selected cell.
        if (e.state.selection instanceof CellSelection) return false;
        const text = e.state.doc.textBetween(from, to, " ");
        return text.trim().length > 0;
      }}
    >
      <motion.div
        className="bubble"
        initial={false}
        animate={shown ? { opacity: 1, scale: 1, y: 0, filter: "blur(0px)" } : { opacity: 0, scale: 0.96, y: 4, filter: "blur(3px)" }}
        transition={{ type: "spring", stiffness: 600, damping: 38, mass: 0.6 }}
        onMouseDown={(e) => {
          if ((e.target as HTMLElement).tagName !== "INPUT") e.preventDefault();
        }}
      >
        {linkMode ? (
          <form
            className="bubble-link"
            onSubmit={(e) => {
              e.preventDefault();
              applyLink();
            }}
          >
            <Link2 size={14} strokeWidth={1.8} className="bubble-link-icon" />
            <input
              ref={input}
              value={href}
              onChange={(e) => setHref(e.target.value)}
              placeholder="Paste or type a link…"
              spellCheck={false}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  e.preventDefault();
                  e.stopPropagation();
                  setLinkMode(false);
                  editor.commands.focus();
                }
              }}
            />
            <button type="submit" className="bubble-btn" aria-label="Apply link">
              <Check size={14} strokeWidth={2} />
            </button>
            {state.link && (
              <button
                type="button"
                className="bubble-btn"
                aria-label="Remove link"
                onClick={() => {
                  editor.chain().focus().extendMarkRange("link").unsetLink().run();
                  setLinkMode(false);
                }}
              >
                <Unlink size={14} strokeWidth={1.8} />
              </button>
            )}
          </form>
        ) : (
          <>
            {buttons.map((b) => (
              <Tooltip key={b.key} label={b.label} kbd={b.kbd} placement="top">
                <button type="button" className={`bubble-btn ${b.active ? "is-on" : ""}`} aria-label={b.label} aria-pressed={b.active} onClick={b.run}>
                  <b.icon size={15} strokeWidth={b.active ? 2.2 : 1.8} />
                </button>
              </Tooltip>
            ))}
            <span className="bubble-sep" />
            <Tooltip label={state.link ? "Edit link" : "Link"} kbd={`${MOD} K`} placement="top">
              <button
                type="button"
                className={`bubble-btn ${state.link ? "is-on" : ""}`}
                aria-label="Link"
                onClick={() => {
                  setHref(state.href);
                  setLinkMode(true);
                }}
              >
                <Link2 size={15} strokeWidth={state.link ? 2.2 : 1.8} />
              </button>
            </Tooltip>
          </>
        )}
      </motion.div>
    </BubbleMenu>
  );
}
