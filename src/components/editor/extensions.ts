import { Extension, type AnyExtension } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import Collaboration from "@tiptap/extension-collaboration";
import CollaborationCaret from "@tiptap/extension-collaboration-caret";
import type * as Y from "yjs";
import type { Awareness } from "y-protocols/awareness";
import { BODY } from "../../collab/fields";
import { TaskList } from "@tiptap/extension-task-list";
import { TaskItem } from "@tiptap/extension-task-item";
import { CharacterCount, Placeholder } from "@tiptap/extensions";
import Highlight from "@tiptap/extension-highlight";
import Typography from "@tiptap/extension-typography";
import CodeBlockLowlight from "@tiptap/extension-code-block-lowlight";
import { createLowlight } from "lowlight";
import bash from "highlight.js/lib/languages/bash";
import c from "highlight.js/lib/languages/c";
import cpp from "highlight.js/lib/languages/cpp";
import csharp from "highlight.js/lib/languages/csharp";
import css from "highlight.js/lib/languages/css";
import diff from "highlight.js/lib/languages/diff";
import go from "highlight.js/lib/languages/go";
import java from "highlight.js/lib/languages/java";
import javascript from "highlight.js/lib/languages/javascript";
import json from "highlight.js/lib/languages/json";
import lua from "highlight.js/lib/languages/lua";
import markdown from "highlight.js/lib/languages/markdown";
import python from "highlight.js/lib/languages/python";
import rust from "highlight.js/lib/languages/rust";
import sql from "highlight.js/lib/languages/sql";
import typescript from "highlight.js/lib/languages/typescript";
import xml from "highlight.js/lib/languages/xml";
import yaml from "highlight.js/lib/languages/yaml";
import { SlashCommand } from "./slash";

// A curated set keeps the bundle lean; auto-detection picks between these.
const lowlight = createLowlight({ bash, c, cpp, csharp, css, diff, go, java, javascript, json, lua, markdown, python, rust, sql, typescript, xml, yaml });

type NavOptions = { onExitTop: () => void };

/** Arrow-up / backspace at the very top of the body jumps back into the title. */
const TitleNav = Extension.create<NavOptions>({
  name: "titleNav",
  addOptions() {
    return { onExitTop: () => {} };
  },
  addKeyboardShortcuts() {
    const inFirstTextblock = () => {
      const { selection, doc } = this.editor.state;
      if (!selection.empty || !selection.$from.parent.isTextblock) return false;
      let first = -1;
      doc.descendants((node, pos) => {
        if (first >= 0) return false;
        if (node.isTextblock) {
          first = pos;
          return false;
        }
        return true;
      });
      return selection.$from.before(selection.$from.depth) === first;
    };
    return {
      ArrowUp: () => {
        if (inFirstTextblock() && this.editor.view.endOfTextblock("up")) {
          this.options.onExitTop();
          return true;
        }
        return false;
      },
      Backspace: () => {
        const { selection, doc } = this.editor.state;
        const first = doc.firstChild;
        if (
          selection.empty &&
          first?.type.name === "paragraph" &&
          selection.$from.depth === 1 &&
          selection.$from.index(0) === 0 &&
          selection.$from.parentOffset === 0
        ) {
          this.options.onExitTop();
          return true;
        }
        return false;
      },
    };
  },
});

/** Binds an editor to a live doc that other people are editing too. */
export type CollabBinding = { doc: Y.Doc; awareness: Awareness; user: { name: string; color: string } };

/** Someone else's caret: a thin line of light in their color, with their name riding above it. */
function renderCaret(user: Record<string, unknown>): HTMLElement {
  const caret = document.createElement("span");
  caret.className = "collab-caret";
  caret.style.setProperty("--c", String(user.color ?? "#9aa"));
  const label = document.createElement("span");
  label.className = "collab-label";
  label.textContent = String(user.name ?? "Someone");
  caret.append(label);
  return caret;
}

export function buildExtensions(opts: { onExitTop?: () => void; editable?: boolean; collab?: CollabBinding } = {}): AnyExtension[] {
  const list: AnyExtension[] = [
    StarterKit.configure({
      codeBlock: false,
      // Undo/redo comes from the live doc instead (it only undoes your own changes).
      ...(opts.collab ? { undoRedo: false as const } : {}),
      heading: { levels: [1, 2, 3] },
      link: {
        openOnClick: false,
        autolink: true,
        linkOnPaste: true,
        defaultProtocol: "https",
        HTMLAttributes: { rel: "noopener noreferrer nofollow", target: "_blank" },
      },
      dropcursor: { color: "var(--accent)", width: 2 },
    }),
    TaskList,
    TaskItem.configure({ nested: true }),
    Highlight.configure({ multicolor: false }),
    Typography,
    CodeBlockLowlight.configure({ lowlight, defaultLanguage: null }),
    CharacterCount,
  ];

  if (opts.collab) {
    list.push(
      Collaboration.configure({ document: opts.collab.doc, field: BODY }),
      CollaborationCaret.configure({
        provider: { awareness: opts.collab.awareness },
        user: opts.collab.user,
        render: renderCaret,
        selectionRender: (user: Record<string, unknown>) => ({
          nodeName: "span",
          class: "collab-selection",
          style: `--c: ${String(user.color ?? "#9aa")}`,
        }),
      }),
    );
  }

  if (opts.editable !== false) {
    list.push(
      Placeholder.configure({
        showOnlyCurrent: true,
        includeChildren: false,
        placeholder: ({ node, editor }) => {
          if (node.type.name === "heading") return `Heading ${node.attrs.level}`;
          if (node.type.name === "codeBlock") return "";
          return editor.isEmpty ? "Start writing, or press / for blocks…" : "Write, or press / for blocks";
        },
      }),
      SlashCommand,
      TitleNav.configure({ onExitTop: opts.onExitTop ?? (() => {}) }),
    );
  }
  return list;
}
