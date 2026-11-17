import type { JSONContent } from "@tiptap/core";

/**
 * What changed between two versions of a note, for the version history: the notes are laid out
 * as blocks (a paragraph, a heading, a list item, a quote, a code block, a picture, a table row),
 * the blocks lined up (unchanged ones matched, a changed one paired with what it became), and the
 * changed ones compared word by word.
 */

export type BlockKind = "p" | "h1" | "h2" | "h3" | "bullet" | "number" | "task" | "quote" | "code" | "rule" | "image" | "row";

export type Block = {
  kind: BlockKind;
  text: string;
  /** How far in it's nested (lists). */
  depth: number;
  /** A to-do's tick. */
  checked?: boolean;
  /** A numbered item's number. */
  n?: number;
  /** A table's heading row. */
  header?: boolean;
};

export type Op = "same" | "add" | "del";
export type Piece = { op: Op; text: string };
/** A block in the comparison: unchanged, added, deleted — or changed ("mod"), with what changed in it. */
export type DiffBlock = Block & { op: Op | "mod"; pieces?: Piece[]; was?: Block };

// ── a note as blocks ──────────────────────────────────────────────────────

function inline(n: JSONContent): string {
  if (n.type === "text") return n.text ?? "";
  if (n.type === "hardBreak") return "\n";
  return (n.content ?? []).map(inline).join("");
}

/** A note's blocks, in order. */
export function blocksOf(doc: JSONContent | null | undefined, text = ""): Block[] {
  if (!doc) return text.split("\n").map((line) => ({ kind: "p" as const, text: line, depth: 0 }));
  const out: Block[] = [];
  const walk = (nodes: JSONContent[] | undefined, ctx: { kind?: BlockKind; depth: number; checked?: boolean; n?: number }) => {
    let first = true;
    for (const node of nodes ?? []) {
      switch (node.type) {
        case "paragraph":
          // (in a list item, the first paragraph wears its bullet; any others follow on under it)
          out.push({ kind: ctx.kind && first ? ctx.kind : ctx.kind === "quote" ? "quote" : "p", text: inline(node), depth: ctx.depth, ...(ctx.kind === "task" && first ? { checked: ctx.checked } : {}), ...(ctx.kind === "number" && first ? { n: ctx.n } : {}) });
          if (ctx.kind !== "quote") first = false;
          break;
        case "heading": {
          const level = Math.min(3, Math.max(1, Number(node.attrs?.level) || 1));
          out.push({ kind: `h${level}` as BlockKind, text: inline(node), depth: 0 });
          break;
        }
        case "bulletList":
          for (const item of node.content ?? []) walk(item.content, { kind: "bullet", depth: ctx.depth + (ctx.kind ? 1 : 0) });
          break;
        case "orderedList": {
          let n = Number(node.attrs?.start) || 1;
          for (const item of node.content ?? []) walk(item.content, { kind: "number", depth: ctx.depth + (ctx.kind ? 1 : 0), n: n++ });
          break;
        }
        case "taskList":
          for (const item of node.content ?? []) walk(item.content, { kind: "task", depth: ctx.depth + (ctx.kind ? 1 : 0), checked: item.attrs?.checked === true });
          break;
        case "blockquote":
          walk(node.content, { kind: "quote", depth: ctx.depth });
          break;
        case "codeBlock":
          out.push({ kind: "code", text: inline(node), depth: ctx.depth });
          break;
        case "horizontalRule":
          out.push({ kind: "rule", text: "", depth: 0 });
          break;
        case "image":
          out.push({ kind: "image", text: String(node.attrs?.alt || node.attrs?.title || ""), depth: ctx.depth });
          break;
        case "table":
          for (const row of node.content ?? []) {
            const cells = (row.content ?? []).map((c) => (c.content ?? []).map(inline).join(" ").trim());
            out.push({ kind: "row", text: cells.join(" │ "), depth: 0, header: (row.content ?? []).every((c) => c.type === "tableHeader") });
          }
          break;
        default:
          if (node.content) walk(node.content, ctx);
      }
    }
  };
  walk(doc.content, { depth: 0 });
  return out;
}

// ── lining things up ──────────────────────────────────────────────────────

/**
 * The longest run of things two lists share, as a script of keep/delete/add — trimmed of the
 * same start and end first (most edits are in one place), and giving up (everything deleted, then
 * everything added) past a size where it would take too long.
 */
function align<T>(a: T[], b: T[], key: (x: T) => string, budget = 1_500_000): Op[] {
  const ka = a.map(key);
  const kb = b.map(key);
  let start = 0;
  while (start < ka.length && start < kb.length && ka[start] === kb[start]) start++;
  let endA = ka.length;
  let endB = kb.length;
  while (endA > start && endB > start && ka[endA - 1] === kb[endB - 1]) {
    endA--;
    endB--;
  }
  const ops: Op[] = new Array(start).fill("same");
  const n = endA - start;
  const m = endB - start;
  if (n * m > budget) {
    for (let i = 0; i < n; i++) ops.push("del");
    for (let j = 0; j < m; j++) ops.push("add");
  } else if (n || m) {
    // lengths of the longest common runs of the remainders (from the end)
    const w = m + 1;
    const L = new Uint32Array((n + 1) * w);
    for (let i = n - 1; i >= 0; i--) {
      for (let j = m - 1; j >= 0; j--) {
        L[i * w + j] = ka[start + i] === kb[start + j] ? L[(i + 1) * w + j + 1] + 1 : Math.max(L[(i + 1) * w + j], L[i * w + j + 1]);
      }
    }
    let i = 0;
    let j = 0;
    while (i < n || j < m) {
      if (i < n && j < m && ka[start + i] === kb[start + j]) {
        ops.push("same");
        i++;
        j++;
      } else if (j < m && (i >= n || L[i * w + j + 1] >= L[(i + 1) * w + j])) {
        ops.push("add");
        j++;
      } else {
        ops.push("del");
        i++;
      }
    }
  }
  for (let i = endA; i < ka.length; i++) ops.push("same");
  return ops;
}

const TOKEN = /[\p{L}\p{N}'’_]+|\s+|[^\s\p{L}\p{N}'’_]/gu;

/** What changed in a piece of text, word by word (tidied, so it reads as phrases rather than confetti). */
export function diffText(before: string, after: string): Piece[] {
  if (before === after) return before ? [{ op: "same", text: before }] : [];
  const a = before.match(TOKEN) ?? [];
  const b = after.match(TOKEN) ?? [];
  const ops = align(a, b, (t) => t);
  const pieces: Piece[] = [];
  let i = 0;
  let j = 0;
  for (const op of ops) {
    const text = op === "add" ? b[j++] : op === "del" ? a[i++] : (j++, a[i++]);
    const last = pieces[pieces.length - 1];
    if (last && last.op === op) last.text += text;
    else pieces.push({ op, text });
  }
  return tidy(pieces);
}

/**
 * A space (or a lone punctuation mark) kept between two changes joins them, and within each run of
 * changes the words taken away come first, then the ones put in: "~~the quick~~ a slow" rather
 * than "~~the~~ a ~~quick~~ slow".
 */
function tidy(pieces: Piece[]): Piece[] {
  const out: Piece[] = [];
  let run: { del: string; add: string } | null = null;
  const flush = () => {
    if (!run) return;
    if (run.del) out.push({ op: "del", text: run.del });
    if (run.add) out.push({ op: "add", text: run.add });
    run = null;
  };
  for (let k = 0; k < pieces.length; k++) {
    const p = pieces[k];
    if (p.op === "same") {
      const next = pieces[k + 1];
      const small = /^\s+$/.test(p.text) || (p.text.length === 1 && !/[\p{L}\p{N}]/u.test(p.text));
      if (run && small && next && next.op !== "same") {
        // (a space between two changes: part of both)
        run.del += p.text;
        run.add += p.text;
        continue;
      }
      flush();
      out.push({ ...p });
    } else {
      run ??= { del: "", add: "" };
      run[p.op] += p.text;
    }
  }
  flush();
  return out;
}

const words = (t: string) => t.toLowerCase().match(/[\p{L}\p{N}'’_]+/gu) ?? [];

/** How alike two pieces of text are, 0..1 (by the words they share). */
function likeness(a: string, b: string): number {
  const wa = words(a);
  const wb = words(b);
  if (!wa.length && !wb.length) return 1;
  if (!wa.length || !wb.length) return 0;
  const counts = new Map<string, number>();
  for (const w of wa) counts.set(w, (counts.get(w) ?? 0) + 1);
  let shared = 0;
  for (const w of wb) {
    const c = counts.get(w) ?? 0;
    if (c > 0) {
      shared++;
      counts.set(w, c - 1);
    }
  }
  return (2 * shared) / (wa.length + wb.length);
}

const keyOf = (b: Block) => `${b.kind}\u0000${b.depth}\u0000${b.checked ? 1 : 0}\u0000${b.text}`;
const textual = (k: BlockKind) => k !== "rule" && k !== "image";

/** The blocks of the newer version, with what changed since the older one (deleted blocks where they were). */
export function diffBlocks(older: Block[], newer: Block[]): DiffBlock[] {
  const ops = align(older, newer, keyOf, 1_000_000);
  const out: DiffBlock[] = [];
  let i = 0;
  let j = 0;
  let dels: Block[] = [];
  let adds: Block[] = [];
  const settle = () => {
    // pair what was taken away with what was put in its place, where they're alike: a changed block
    let a = 0;
    let b = 0;
    if (dels.length * adds.length <= 40_000) {
      while (a < dels.length && b < adds.length) {
        const d = dels[a];
        const n = adds[b];
        if (textual(d.kind) && textual(n.kind) && likeness(d.text, n.text) >= 0.4) {
          out.push({ ...n, op: "mod", was: d, pieces: diffText(d.text, n.text) });
          a++;
          b++;
        } else if (adds.slice(b + 1).some((x) => textual(x.kind) && likeness(d.text, x.text) >= 0.4)) {
          // (what was taken away turns up a little further on: this one's new)
          out.push({ ...n, op: "add" });
          b++;
        } else {
          out.push({ ...d, op: "del" });
          a++;
        }
      }
    }
    while (a < dels.length) out.push({ ...dels[a++], op: "del" });
    while (b < adds.length) out.push({ ...adds[b++], op: "add" });
    dels = [];
    adds = [];
  };
  for (const op of ops) {
    if (op === "same") {
      settle();
      out.push({ ...newer[j], op: "same" });
      i++;
      j++;
    } else if (op === "del") dels.push(older[i++]);
    else adds.push(newer[j++]);
  }
  settle();
  return out;
}

/** How many words came and went between two versions (for the list: "+120 · −40"). */
export function churn(older: Block[], newer: Block[]): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (const b of diffBlocks(older, newer)) {
    if (b.op === "add") added += words(b.text).length;
    else if (b.op === "del") removed += words(b.text).length;
    else if (b.op === "mod") {
      for (const p of b.pieces ?? []) {
        if (p.op === "add") added += words(p.text).length;
        else if (p.op === "del") removed += words(p.text).length;
      }
    }
  }
  return { added, removed };
}
