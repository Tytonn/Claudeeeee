import type { JSONContent } from "@tiptap/core";
import type { Note } from "./types";

type Mark = NonNullable<JSONContent["marks"]>[number];

function inline(nodes: JSONContent[] | undefined): string {
  if (!nodes) return "";
  return nodes
    .map((n) => {
      if (n.type === "hardBreak") return "  \n";
      if (n.type !== "text") return inline(n.content);
      let t = n.text ?? "";
      const marks: Mark[] = n.marks ?? [];
      const has = (type: string) => marks.find((m) => m.type === type);
      if (has("code")) {
        t = "`" + t + "`";
      } else {
        if (has("bold")) t = `**${t}**`;
        if (has("italic")) t = `*${t}*`;
        if (has("strike")) t = `~~${t}~~`;
        if (has("highlight")) t = `==${t}==`;
      }
      const link = has("link");
      if (link?.attrs?.href) t = `[${t}](${link.attrs.href})`;
      return t;
    })
    .join("");
}

function listItems(node: JSONContent, bullet: (i: number, item: JSONContent) => string, indent: string): string[] {
  const out: string[] = [];
  (node.content ?? []).forEach((item, i) => {
    const prefix = bullet(i, item);
    const pad = " ".repeat(prefix.length);
    (item.content ?? []).forEach((child, j) => {
      const lines = block(child, "");
      lines.forEach((line, k) => {
        if (j === 0 && k === 0) out.push(indent + prefix + line);
        else out.push(line ? indent + pad + line : "");
      });
    });
  });
  return out;
}

function block(node: JSONContent, indent = ""): string[] {
  switch (node.type) {
    case "paragraph":
      return [indent + inline(node.content)];
    case "heading":
      return [indent + "#".repeat(Number(node.attrs?.level ?? 1)) + " " + inline(node.content)];
    case "blockquote":
      return blocks(node.content).map((l) => `${indent}> ${l}`.trimEnd());
    case "codeBlock": {
      const code = (node.content ?? []).map((c) => c.text ?? "").join("");
      return [indent + "```" + (node.attrs?.language ?? ""), ...code.split("\n").map((l) => indent + l), indent + "```"];
    }
    case "horizontalRule":
      return [indent + "---"];
    case "image":
      // The picture itself stays in umbra (it's encrypted); the export notes where it was.
      return [indent + `[Image${node.attrs?.alt ? `: ${node.attrs.alt}` : ""}]`];
    case "bulletList":
      return listItems(node, () => "- ", indent);
    case "orderedList": {
      const start = Number(node.attrs?.start ?? 1);
      return listItems(node, (i) => `${start + i}. `, indent);
    }
    case "taskList":
      return listItems(node, (_i, item) => (item.attrs?.checked ? "- [x] " : "- [ ] "), indent);
    case "table":
      return tableLines(node).map((l) => indent + l);
    default:
      return node.content ? blocks(node.content) : [];
  }
}

/** A cell's words on one line (its own lines joined with <br>), with any | escaped. */
function cellText(cell: JSONContent): string {
  return blocks(cell.content)
    .filter((l) => l.trim())
    .join("<br>")
    .replace(/\|/g, "\\|");
}

/** A table as Markdown: its first row is the header, each column's alignment in the --- line. */
function tableLines(node: JSONContent): string[] {
  const grid: string[][] = [];
  const aligns: (string | null)[] = [];
  (node.content ?? []).forEach((row, r) => {
    const line: string[] = [];
    for (const cell of row.content ?? []) {
      const span = Math.max(1, Number(cell.attrs?.colspan ?? 1) | 0);
      if (r === 0) for (let i = 0; i < span; i++) aligns.push(typeof cell.attrs?.align === "string" ? cell.attrs.align : null);
      line.push(cellText(cell), ...Array<string>(span - 1).fill(""));
    }
    grid.push(line);
  });
  const width = Math.max(1, ...grid.map((l) => l.length));
  const row = (cells: string[]) => `| ${Array.from({ length: width }, (_, i) => cells[i] ?? "").join(" | ")} |`;
  const rule = Array.from({ length: width }, (_, i) => (aligns[i] === "center" ? ":---:" : aligns[i] === "right" ? "---:" : aligns[i] === "left" ? ":---" : "---"));
  return [row(grid[0] ?? []), row(rule), ...grid.slice(1).map(row)];
}

function blocks(nodes: JSONContent[] | undefined): string[] {
  const out: string[] = [];
  (nodes ?? []).forEach((n, i) => {
    if (i > 0) out.push("");
    out.push(...block(n));
  });
  return out;
}

export function docToMarkdown(doc: JSONContent | null | undefined, title?: string): string {
  const body = blocks(doc?.content).join("\n").replace(/\n{3,}/g, "\n\n").trim();
  return title?.trim() ? `# ${title.trim()}\n\n${body}\n` : `${body}\n`;
}

/** Plain-text projection (one line per block), mirrors editor.getText() closely enough for search. */
export function docToText(doc: JSONContent | null | undefined): string {
  const out: string[] = [];
  const walk = (n: JSONContent): string => {
    if (n.type === "text") return n.text ?? "";
    if (n.type === "hardBreak") return "\n";
    return (n.content ?? []).map(walk).join("");
  };
  const visit = (n: JSONContent) => {
    if (["paragraph", "heading", "codeBlock"].includes(n.type ?? "")) out.push(walk(n));
    else (n.content ?? []).forEach(visit);
  };
  if (doc) visit(doc);
  return out.join("\n");
}

export function wordCount(text: string): number {
  const m = text.match(/[\p{L}\p{N}][\p{L}\p{N}'’_-]*/gu);
  return m ? m.length : 0;
}

export function displayTitle(note: Pick<Note, "title" | "text">): string {
  const t = String(note.title ?? "").trim();
  if (t) return t;
  const first = String(note.text ?? "").split("\n").find((l) => l.trim());
  return first ? first.trim().slice(0, 80) : "Untitled";
}

export function isBlank(note: Pick<Note, "title" | "text"> & { doc?: JSONContent | null }): boolean {
  return !String(note.title ?? "").trim() && !String(note.text ?? "").trim() && !hasMedia(note.doc);
}

/** Whether a document holds anything besides text (a picture). */
function hasMedia(doc: JSONContent | null | undefined): boolean {
  if (!doc) return false;
  if (doc.type === "image") return true;
  return (doc.content ?? []).some(hasMedia);
}

export function snippet(text: string, query: string, radius = 48): string {
  const flat = text.replace(/\s+/g, " ").trim();
  if (!query) return flat.slice(0, radius * 2);
  const i = flat.toLowerCase().indexOf(query.toLowerCase());
  if (i < 0) return flat.slice(0, radius * 2);
  const start = Math.max(0, i - radius);
  return (start > 0 ? "…" : "") + flat.slice(start, i + query.length + radius) + (i + query.length + radius < flat.length ? "…" : "");
}

export function slugify(s: string): string {
  return (
    s
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^\p{L}\p{N}]+/gu, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "note"
  );
}

/** Small, forgiving fuzzy scorer: contiguous + word-start matches rank highest. */
export function fuzzyScore(haystack: string, needle: string): number {
  if (!needle) return 1;
  const h = haystack.toLowerCase();
  const n = needle.toLowerCase().trim();
  if (!n) return 1;
  const idx = h.indexOf(n);
  if (idx >= 0) {
    const wordStart = idx === 0 || /[\s\-_/.,]/.test(h[idx - 1]);
    return 100 + (wordStart ? 40 : 0) - Math.min(idx, 30) + (h.length === n.length ? 50 : 0);
  }
  let score = 0;
  let hi = 0;
  let streak = 0;
  for (const ch of n) {
    if (ch === " ") continue;
    const found = h.indexOf(ch, hi);
    if (found < 0) return 0;
    streak = found === hi ? streak + 1 : 0;
    score += 1 + streak * 2 + (found === 0 || /[\s\-_/.]/.test(h[found - 1]) ? 3 : 0);
    hi = found + 1;
  }
  return score;
}
