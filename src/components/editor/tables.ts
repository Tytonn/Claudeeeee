import { Extension, type Editor, type JSONContent, type Range } from "@tiptap/core";
import type { Node as PMNode, ResolvedPos } from "@tiptap/pm/model";
import { Plugin, PluginKey, TextSelection, type EditorState, type Transaction } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
import { CellSelection, TableMap, addColumn, addRow, cellAround } from "@tiptap/pm/tables";

/*
 * Tables in notes: what the editor and its table tools share — making one, finding your way
 * around one (which table, which row, which column), adding to its edges, and a table pasted as
 * Markdown (from a chat, a README…) arriving as a real one.
 */

/** Where a cell sits: its table (and where that is in the note) and its row and column in the grid. */
export type CellSpot = {
  tablePos: number;
  table: PMNode;
  map: TableMap;
  cellPos: number;
  row: number;
  col: number;
};

const isCell = (node: PMNode) => {
  const role = node.type.spec.tableRole;
  return role === "cell" || role === "header_cell";
};

/** The spot of the cell that `$cell` points at (as cellAround gives it). */
export function spotAt($cell: ResolvedPos): CellSpot | null {
  const cell = $cell.nodeAfter;
  if (!cell || !isCell(cell)) return null;
  // a cell's parent is its row, and the row's parent is the table
  const depth = $cell.depth - 1;
  if (depth < 0) return null;
  const table = $cell.node(depth);
  if (table.type.spec.tableRole !== "table") return null;
  const tablePos = depth > 0 ? $cell.before(depth) : -1;
  if (tablePos < 0) return null;
  const map = TableMap.get(table);
  const rect = map.findCell($cell.pos - tablePos - 1);
  return { tablePos, table, map, cellPos: $cell.pos, row: rect.top, col: rect.left };
}

/** The spot of a table cell on the page (a <td> or <th> the editor drew). */
export function spotOfElement(view: EditorView, el: Element): CellSpot | null {
  if (!el.isConnected || !view.dom.contains(el)) return null;
  let inside: number;
  try {
    inside = view.posAtDOM(el, 0);
  } catch {
    return null;
  }
  const { doc } = view.state;
  if (inside < 0 || inside > doc.content.size) return null;
  const $cell = cellAround(doc.resolve(inside));
  return $cell ? spotAt($cell) : null;
}

/** The cell the selection is in (the moving end of a cell selection), if it's in a table. */
export function selectionSpot(state: EditorState): CellSpot | null {
  const sel = state.selection;
  const $cell = sel instanceof CellSelection ? sel.$headCell : cellAround(sel.$head);
  return $cell ? spotAt($cell) : null;
}

/** The position of the cell at a row and column (the one covering it, for a merged cell). */
export function cellPosAt(spot: Pick<CellSpot, "tablePos" | "map">, row: number, col: number): number {
  return spot.tablePos + 1 + spot.map.map[row * spot.map.width + col];
}

const rectOf = (tablePos: number, table: PMNode) => ({ map: TableMap.get(table), tableStart: tablePos + 1, table, left: 0, top: 0, right: 0, bottom: 0 });

/** Puts the caret at the start of the cell at a row and column of the table at `tablePos`. */
function caretInto(tr: Transaction, tablePos: number, row: number, col: number): Transaction {
  const table = tr.doc.nodeAt(tablePos);
  if (!table) return tr;
  const map = TableMap.get(table);
  const pos = tablePos + 1 + map.map[Math.min(row, map.height - 1) * map.width + Math.min(col, map.width - 1)];
  return tr.setSelection(TextSelection.near(tr.doc.resolve(pos + 1)));
}

/** A new row along the bottom of a table, with the caret in its first cell. */
export function appendRow(editor: Editor, tablePos: number): boolean {
  const { state, view } = editor;
  const table = state.doc.nodeAt(tablePos);
  if (!table || table.type.spec.tableRole !== "table") return false;
  const rect = rectOf(tablePos, table);
  const tr = addRow(state.tr, rect, rect.map.height);
  caretInto(tr, tablePos, rect.map.height, 0);
  view.dispatch(tr.scrollIntoView());
  view.focus();
  return true;
}

/** A new column down the right of a table, with the caret in its top cell. */
export function appendColumn(editor: Editor, tablePos: number): boolean {
  const { state, view } = editor;
  const table = state.doc.nodeAt(tablePos);
  if (!table || table.type.spec.tableRole !== "table") return false;
  const rect = rectOf(tablePos, table);
  const tr = addColumn(state.tr, rect, rect.map.width);
  caretInto(tr, tablePos, 0, rect.map.width);
  view.dispatch(tr.scrollIntoView());
  view.focus();
  return true;
}

/** Selects a whole row or column of a table (it lights up, and the commands act on all of it). */
export function selectLine(editor: Editor, spot: CellSpot, kind: "row" | "col"): void {
  const { state, view } = editor;
  const $cell = state.doc.resolve(spot.cellPos);
  const sel = kind === "row" ? CellSelection.rowSelection($cell) : CellSelection.colSelection($cell);
  view.dispatch(state.tr.setSelection(sel));
}

/**
 * Makes a table (three columns, a header row and two more), with the caret in its first cell.
 * (There's always a line after it to carry on writing: the editor keeps one at the end of a note.)
 */
export function insertTable(editor: Editor, range?: Range): void {
  const chain = editor.chain().focus();
  if (range) chain.deleteRange(range);
  chain.insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run();
}

// ── A table pasted as Markdown ──────────────────────────────────────────────

const SEPARATOR = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;

/** The cells of a Markdown table row (pipes inside code or escaped with \ stay text). */
function splitRow(line: string): string[] {
  let s = line.trim();
  if (s.startsWith("|")) s = s.slice(1);
  if (s.endsWith("|") && !s.endsWith("\\|")) s = s.slice(0, -1);
  const cells: string[] = [];
  let cur = "";
  let code = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === "\\" && s[i + 1] === "|") {
      cur += "|";
      i++;
    } else if (ch === "`") {
      code = !code;
      cur += ch;
    } else if (ch === "|" && !code) {
      cells.push(cur.trim());
      cur = "";
    } else cur += ch;
  }
  cells.push(cur.trim());
  return cells;
}

type Mark = { type: string; attrs?: Record<string, unknown> };

/** A little Markdown, inline: **bold**, *italic*, `code`, ~~struck~~ and [links](…). */
export function inlineMarkdown(text: string): JSONContent[] {
  const out: JSONContent[] = [];
  const re = /(`[^`]+`)|(\*\*[^*]+\*\*|__[^_]+__)|(~~[^~]+~~)|(\*[^*\s][^*]*\*|_[^_\s][^_]*_)|(\[[^\]]+\]\((?:https?:\/\/|mailto:)[^)\s]+\))/g;
  let last = 0;
  const push = (t: string, marks?: Mark[]) => {
    if (!t) return;
    out.push(marks?.length ? { type: "text", text: t, marks } : { type: "text", text: t });
  };
  for (let m = re.exec(text); m; m = re.exec(text)) {
    push(text.slice(last, m.index));
    const tok = m[0];
    if (m[1]) push(tok.slice(1, -1), [{ type: "code" }]);
    else if (m[2]) push(tok.slice(2, -2), [{ type: "bold" }]);
    else if (m[3]) push(tok.slice(2, -2), [{ type: "strike" }]);
    else if (m[4]) push(tok.slice(1, -1), [{ type: "italic" }]);
    else if (m[5]) {
      const close = tok.indexOf("](");
      push(tok.slice(1, close), [{ type: "link", attrs: { href: tok.slice(close + 2, -1) } }]);
    }
    last = m.index + tok.length;
  }
  push(text.slice(last));
  return out;
}

/** A Markdown table (a header row, its --- line, then rows) as a table for the editor; else null. */
export function markdownTable(text: string): JSONContent | null {
  const lines = text.replace(/\r\n?/g, "\n").trim().split("\n");
  if (lines.length < 2 || !lines[0].includes("|") || !SEPARATOR.test(lines[1])) return null;
  const rest = lines.slice(2).filter((l) => l.trim());
  // every row has to look like one: anything else means it isn't (just) a table
  if (rest.some((l) => !l.includes("|"))) return null;
  const header = splitRow(lines[0]);
  const aligns = splitRow(lines[1]).map((s) => {
    const left = s.startsWith(":");
    const right = s.endsWith(":");
    return left && right ? "center" : right ? "right" : left ? "left" : null;
  });
  if (aligns.length !== header.length) return null;
  const width = header.length;
  const cell = (type: string, text: string, col: number): JSONContent => {
    const content = inlineMarkdown(text.replace(/<br\s*\/?>/gi, " "));
    return {
      type,
      attrs: aligns[col] ? { align: aligns[col] } : {},
      content: [content.length ? { type: "paragraph", content } : { type: "paragraph" }],
    };
  };
  const row = (cells: string[], type: string): JSONContent => ({
    type: "tableRow",
    content: Array.from({ length: width }, (_, i) => cell(type, cells[i] ?? "", i)),
  });
  return { type: "table", content: [row(header, "tableHeader"), ...rest.map((l) => row(splitRow(l), "tableCell"))] };
}

/** Pasting a Markdown table makes a table (an HTML table, from a page or a spreadsheet, already does). */
export const TableMarkdownPaste = Extension.create({
  name: "tableMarkdownPaste",
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey("tableMarkdownPaste"),
        props: {
          handlePaste(view, event) {
            const data = event.clipboardData;
            const text = data?.getData("text/plain");
            if (!text || !text.includes("|")) return false;
            if (/<table[\s>]/i.test(data?.getData("text/html") ?? "")) return false;
            const { $from } = view.state.selection;
            if ($from.parent.type.spec.code) return false;
            // (a table inside a table isn't something anyone means)
            for (let d = $from.depth; d > 0; d--) if ($from.node(d).type.spec.tableRole === "table") return false;
            const json = markdownTable(text);
            if (!json) return false;
            let node: PMNode;
            try {
              node = view.state.schema.nodeFromJSON(json);
              node.check();
            } catch {
              return false;
            }
            view.dispatch(view.state.tr.replaceSelectionWith(node).scrollIntoView());
            return true;
          },
        },
      }),
    ];
  },
});
