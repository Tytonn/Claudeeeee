import type { JSONContent } from "@tiptap/core";
import type { Countdown, Note, Todo } from "../lib/types";
import { uid } from "../lib/id";
import { docToText } from "../lib/text";
import { ALT, MOD } from "../lib/theme";
import { toISODate } from "../lib/dates";

type Inline = string | JSONContent;

const t = (text: string, ...marks: string[]): JSONContent => ({
  type: "text",
  text,
  ...(marks.length ? { marks: marks.map((type) => ({ type })) } : {}),
});
const kids = (parts: Inline[]): JSONContent[] => parts.map((p) => (typeof p === "string" ? t(p) : p));
const p = (...parts: Inline[]): JSONContent => ({ type: "paragraph", content: kids(parts) });
const h = (level: number, text: string): JSONContent => ({ type: "heading", attrs: { level }, content: [t(text)] });
const ul = (...items: Inline[][]): JSONContent => ({
  type: "bulletList",
  content: items.map((parts) => ({ type: "listItem", content: [p(...parts)] })),
});
const tasks = (...items: [boolean, string][]): JSONContent => ({
  type: "taskList",
  content: items.map(([checked, text]) => ({ type: "taskItem", attrs: { checked }, content: [p(text)] })),
});
const quote = (...parts: Inline[]): JSONContent => ({ type: "blockquote", content: [p(...parts)] });
const k = (text: string) => t(text, "code");
const b = (text: string) => t(text, "bold");

/** The tutorial to-dos every new device starts with, and its countdown. */
export const SEED_TODOS: readonly string[] = ["Check this one off", "Drag the handle to reorder", "Click a to-do to edit it"];
export const SEED_COUNTDOWN = "New Year";

/** A tutorial to-do just as it came (never checked off, edited or coloured). */
export function untouchedSeedTodo(t: Todo): boolean {
  return SEED_TODOS.includes(t.text) && !t.done && !t.color && Math.abs(t.updatedAt - t.createdAt) < 5_000;
}

/** The New Year countdown just as it came. */
export function untouchedSeedCountdown(c: Countdown): boolean {
  return c.title === SEED_COUNTDOWN && c.repeat === "yearly" && Math.abs(c.updatedAt - c.createdAt) < 5_000;
}

export function seedData(): { notes: Note[]; todos: Todo[]; countdowns: Countdown[] } {
  const now = Date.now();

  const doc: JSONContent = {
    type: "doc",
    content: [
      p("A quiet place to think. Everything you write saves instantly, right here in your browser."),
      h(2, "The basics"),
      ul(
        ["Type ", k("/"), " for headings, lists, checklists, quotes and code."],
        ["Select any text to format it — or just write Markdown like ", k("#"), ", ", k("-"), ", ", k("[]"), " and ", k(">"), "."],
        ["Press ", k(`${MOD} K`), " to search notes and run any command."],
        ["Press ", k(`${ALT} N`), " for a new note. Empty notes clean themselves up."],
      ),
      h(2, "Sharing"),
      p(
        "Hit ",
        b("Share"),
        " to send a live link to a friend — with your to-dos and countdowns too, if you want. Links are end-to-end encrypted: the key lives inside the link itself, so not even the server can read them. When you edit, they see it.",
      ),
      h(2, "Widgets"),
      p("Your to-do list and countdowns live in the panel on the right. Just want to write? Switch them off in Settings."),
      tasks([true, "Open umbra"], [false, "Write something worth keeping"]),
      quote(t("Start where you are. Use what you have. Do what you can.", "italic")),
    ],
  };

  const welcome: Note = {
    id: uid(),
    title: "Welcome to umbra",
    doc,
    text: docToText(doc),
    createdAt: now,
    updatedAt: now,
    pinned: false,
  };

  const todos: Todo[] = SEED_TODOS.map((text, i) => ({ id: uid(), text, done: false, createdAt: now + i, updatedAt: now + i }));

  const nextYear = new Date().getFullYear() + 1;
  const countdowns: Countdown[] = [
    {
      id: uid(),
      title: SEED_COUNTDOWN,
      date: toISODate(new Date(nextYear, 0, 1)),
      time: null,
      repeat: "yearly",
      createdAt: now,
      updatedAt: now,
    },
  ];

  return { notes: [welcome], todos, countdowns };
}
