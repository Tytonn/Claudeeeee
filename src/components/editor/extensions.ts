import { Extension, type AnyExtension } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
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

export function buildExtensions(opts: { onExitTop?: () => void; editable?: boolean } = {}): AnyExtension[] {
  const list: AnyExtension[] = [
    StarterKit.configure({
      codeBlock: false,
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
