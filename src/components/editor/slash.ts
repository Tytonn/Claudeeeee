import { Extension, type Editor, type Range } from "@tiptap/core";
import Suggestion from "@tiptap/suggestion";
import { PluginKey } from "@tiptap/pm/state";
import { create } from "zustand";
import {
  Calendar,
  Code2,
  Heading1,
  Heading2,
  Heading3,
  ImageIcon,
  List,
  ListChecks,
  ListOrdered,
  Minus,
  Pilcrow,
  Quote,
  type LucideIcon,
} from "lucide-react";
import { fuzzyScore } from "../../lib/text";
import { pickImages } from "./image";

export type SlashItem = {
  id: string;
  title: string;
  hint: string;
  icon: LucideIcon;
  keywords: string[];
  run: (editor: Editor, range: Range) => void;
};

export const SLASH_ITEMS: SlashItem[] = [
  {
    id: "text",
    title: "Text",
    hint: "",
    icon: Pilcrow,
    keywords: ["paragraph", "plain", "body"],
    run: (e, r) => e.chain().focus().deleteRange(r).setParagraph().run(),
  },
  {
    id: "h1",
    title: "Heading 1",
    hint: "#",
    icon: Heading1,
    keywords: ["title", "big", "h1", "header"],
    run: (e, r) => e.chain().focus().deleteRange(r).setNode("heading", { level: 1 }).run(),
  },
  {
    id: "h2",
    title: "Heading 2",
    hint: "##",
    icon: Heading2,
    keywords: ["subtitle", "h2", "header", "section"],
    run: (e, r) => e.chain().focus().deleteRange(r).setNode("heading", { level: 2 }).run(),
  },
  {
    id: "h3",
    title: "Heading 3",
    hint: "###",
    icon: Heading3,
    keywords: ["h3", "small", "header"],
    run: (e, r) => e.chain().focus().deleteRange(r).setNode("heading", { level: 3 }).run(),
  },
  {
    id: "bullet",
    title: "Bulleted list",
    hint: "-",
    icon: List,
    keywords: ["ul", "unordered", "points", "list"],
    run: (e, r) => e.chain().focus().deleteRange(r).toggleBulletList().run(),
  },
  {
    id: "ordered",
    title: "Numbered list",
    hint: "1.",
    icon: ListOrdered,
    keywords: ["ol", "ordered", "numbers", "list"],
    run: (e, r) => e.chain().focus().deleteRange(r).toggleOrderedList().run(),
  },
  {
    id: "check",
    title: "Checklist",
    hint: "[]",
    icon: ListChecks,
    keywords: ["todo", "task", "checkbox", "check"],
    run: (e, r) => e.chain().focus().deleteRange(r).toggleTaskList().run(),
  },
  {
    id: "image",
    title: "Image",
    hint: "",
    icon: ImageIcon,
    keywords: ["picture", "photo", "image", "upload", "screenshot", "camera", "img"],
    run: (e, r) => {
      e.chain().focus().deleteRange(r).run();
      pickImages(e);
    },
  },
  {
    id: "quote",
    title: "Quote",
    hint: ">",
    icon: Quote,
    keywords: ["blockquote", "cite"],
    run: (e, r) => e.chain().focus().deleteRange(r).toggleBlockquote().run(),
  },
  {
    id: "code",
    title: "Code block",
    hint: "```",
    icon: Code2,
    keywords: ["snippet", "pre", "monospace"],
    run: (e, r) => e.chain().focus().deleteRange(r).toggleCodeBlock().run(),
  },
  {
    id: "divider",
    title: "Divider",
    hint: "---",
    icon: Minus,
    keywords: ["hr", "line", "separator", "rule"],
    run: (e, r) => e.chain().focus().deleteRange(r).setHorizontalRule().run(),
  },
  {
    id: "date",
    title: "Today's date",
    hint: "",
    icon: Calendar,
    keywords: ["date", "today", "now", "time", "journal"],
    run: (e, r) =>
      e
        .chain()
        .focus()
        .deleteRange(r)
        .insertContent(new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric" }) + " ")
        .run(),
  },
];

export function filterSlash(query: string): SlashItem[] {
  const q = query.trim();
  if (!q) return SLASH_ITEMS;
  return SLASH_ITEMS.map((item) => ({
    item,
    score: Math.max(fuzzyScore(item.title, q) * 1.2, ...item.keywords.map((k) => fuzzyScore(k, q)), item.hint === q ? 200 : 0),
  }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((x) => x.item);
}

type SlashState = {
  open: boolean;
  items: SlashItem[];
  index: number;
  rect: DOMRect | null;
  query: string;
  select: ((item: SlashItem) => void) | null;
};

export const useSlash = create<SlashState>(() => ({ open: false, items: [], index: 0, rect: null, query: "", select: null }));

export const SlashCommand = Extension.create({
  name: "slashCommand",
  addProseMirrorPlugins() {
    return [
      Suggestion<SlashItem, SlashItem>({
        editor: this.editor,
        pluginKey: new PluginKey("slashCommand"),
        char: "/",
        allowSpaces: false,
        startOfLine: false,
        allow: ({ state, range }) => {
          const $from = state.doc.resolve(range.from);
          return !$from.parent.type.spec.code;
        },
        items: ({ query }) => filterSlash(query),
        command: ({ editor, range, props }) => props.run(editor, range),
        render: () => ({
          onStart: (props) => {
            useSlash.setState({
              open: true,
              items: props.items,
              index: 0,
              rect: props.clientRect?.() ?? null,
              query: props.query,
              select: (item) => props.command(item),
            });
          },
          onUpdate: (props) => {
            useSlash.setState((s) => ({
              items: props.items,
              index: props.query !== s.query ? 0 : Math.min(s.index, Math.max(0, props.items.length - 1)),
              rect: props.clientRect?.() ?? s.rect,
              query: props.query,
              select: (item) => props.command(item),
            }));
          },
          onKeyDown: ({ event }) => {
            const s = useSlash.getState();
            if (!s.open) return false;
            const n = s.items.length;
            if (event.key === "ArrowDown") {
              if (n) useSlash.setState({ index: (s.index + 1) % n });
              return true;
            }
            if (event.key === "ArrowUp") {
              if (n) useSlash.setState({ index: (s.index - 1 + n) % n });
              return true;
            }
            if (event.key === "Enter" || event.key === "Tab") {
              const item = s.items[s.index];
              if (item && s.select) {
                s.select(item);
                return true;
              }
              return false;
            }
            return false;
          },
          onExit: () => {
            useSlash.setState({ open: false, select: null });
          },
        }),
      }),
    ];
  },
});
