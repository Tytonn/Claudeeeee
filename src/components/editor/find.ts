import { Extension, type Editor } from "@tiptap/core";
import { Plugin, PluginKey, type EditorState, type Transaction } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { closeHistory } from "@tiptap/pm/history";
import type { Node as PMNode } from "@tiptap/pm/model";
import { yUndoPluginKey } from "@tiptap/y-tiptap";

/**
 * Find and replace in a note: every match marked, the current one brightest; next and previous;
 * replace one, or all at once (one step to undo).
 *
 * The search goes paragraph by paragraph (any block of text: a heading, a list item, a table
 * cell, a code block), so a match never runs from one into the next. Unless you ask for an exact
 * match (Aa), capitals and accents don't matter ("cafe" finds "Café"), and neither do curly or
 * straight quotes, or a non-breaking space — the editor types those for you, so you shouldn't
 * have to.
 */

export type FindOptions = { caseSensitive: boolean; wholeWord: boolean };
/** A match (`pieces`: where it runs across formatting — half of it bold, say — the parts of it). */
export type Match = { from: number; to: number; pieces?: { from: number; to: number }[] };

/** Marking this many is plenty: past it, the count says so ("10,000+"). */
const MARK_LIMIT = 10_000;

/** The transaction meta replacements carry (so they don't count as words you wrote). */
export const REPLACE_META = "findReplace";

// ── matching ──────────────────────────────────────────────────────────────

const APOSTROPHES = "‘’‛′ʼ`";
const QUOTES = "“”„‟″";
const ASCII = /^[\x00-\x7f]*$/;
const MARKED_LETTER = /^\p{L}\p{M}+$/u;

/**
 * Text made comparable, one character for one (so a match's place in it is its place in the
 * note): the same quote whichever way it curls, an ordinary space for a non-breaking one — and,
 * when `loose`, lower case without accents.
 */
export function fold(text: string, loose: boolean): string {
  if (ASCII.test(text)) return loose ? text.toLowerCase() : text;
  let out = "";
  for (let i = 0; i < text.length; i++) {
    let c = text[i];
    if (c.charCodeAt(0) < 128) {
      out += loose ? c.toLowerCase() : c;
      continue;
    }
    if (c === " " || c === " ") c = " ";
    else if (APOSTROPHES.includes(c)) c = "'";
    else if (QUOTES.includes(c)) c = '"';
    else if (loose) {
      const bare = c.normalize("NFD");
      if (bare.length > 1 && MARKED_LETTER.test(bare)) c = bare[0];
      const low = c.toLowerCase();
      if (low.length === 1) c = low;
    }
    out += c;
  }
  return out;
}

const WORDISH = /[\p{L}\p{N}_']/u;
const wordish = (c: string | undefined) => c !== undefined && WORDISH.test(c);

/** Where `query` turns up in `text` (offsets, not overlapping), by the options. */
export function findInText(text: string, query: string, opts: FindOptions, limit = Infinity): number[] {
  if (!query) return [];
  const loose = !opts.caseSensitive;
  const q = fold(query, loose);
  const hay = fold(text, loose);
  // (a whole word: no letters running on before or after it — where the query itself starts or
  // ends with one)
  const wordStart = opts.wholeWord && wordish(q[0]);
  const wordEnd = opts.wholeWord && wordish(q[q.length - 1]);
  const out: number[] = [];
  let i = hay.indexOf(q);
  while (i !== -1 && out.length < limit) {
    if ((wordStart && wordish(hay[i - 1])) || (wordEnd && wordish(hay[i + q.length]))) {
      i = hay.indexOf(q, i + 1);
      continue;
    }
    out.push(i);
    i = hay.indexOf(q, i + q.length);
  }
  return out;
}

/** Every match in a note's body, in order. */
export function findMatches(doc: PMNode, query: string, opts: FindOptions, limit = Infinity): { matches: Match[]; capped: boolean } {
  const matches: Match[] = [];
  let capped = false;
  if (!query) return { matches, capped };
  doc.descendants((node, pos) => {
    if (capped) return false;
    if (!node.isTextblock) return true;
    // (its words, one character per position: a picture or a line break stands in as something
    // no search can match, so the positions stay true)
    let text = "";
    const starts: number[] = [];
    node.forEach((child, offset) => {
      starts.push(offset);
      text += child.isText ? (child.text ?? "") : "\ufffc".repeat(child.nodeSize);
    });
    const base = pos + 1;
    let i = 0;
    for (const at of findInText(text, query, opts, limit - matches.length + 1)) {
      if (matches.length >= limit) {
        capped = true;
        break;
      }
      const end = at + query.length;
      const m: Match = { from: base + at, to: base + end };
      // (which of the paragraph's runs of text it covers: more than one, and it's drawn in pieces)
      while (i + 1 < starts.length && starts[i + 1] <= at) i++;
      if (i + 1 < starts.length && starts[i + 1] < end) {
        m.pieces = [];
        for (let k = i; k < starts.length && starts[k] < end; k++) {
          m.pieces.push({ from: base + Math.max(at, starts[k]), to: base + Math.min(end, k + 1 < starts.length ? starts[k + 1] : end) });
        }
      }
      matches.push(m);
    }
    return false;
  });
  return { matches, capped };
}

/**
 * The replacement, in the found word's case — unless you asked for an exact match, or typed
 * capitals into the replacement yourself: replacing "train" with "bus" makes "Train" "Bus" and
 * "TRAIN" "BUS" (as a word processor does), so a sentence never starts with a small letter.
 */
export function inCaseOf(found: string, replacement: string, opts: FindOptions): string {
  if (opts.caseSensitive || !replacement || replacement !== replacement.toLowerCase()) return replacement;
  const letters = found.replace(/[^\p{L}]/gu, "");
  if (!letters) return replacement;
  if (letters.length > 1 && letters === letters.toUpperCase() && letters !== letters.toLowerCase()) return replacement.toUpperCase();
  const first = letters[0];
  if (first !== first.toLowerCase() && first === first.toUpperCase()) {
    const at = replacement.search(/\p{L}/u);
    return at < 0 ? replacement : replacement.slice(0, at) + replacement[at].toUpperCase() + replacement.slice(at + 1);
  }
  return replacement;
}

// ── the plugin ────────────────────────────────────────────────────────────

export type FindState = {
  query: string;
  opts: FindOptions;
  matches: Match[];
  /** Which match is the current one (-1: none). */
  current: number;
  /** More matches than were marked. */
  capped: boolean;
  /** Every match, marked… */
  base: DecorationSet;
  /** …and the current one, brightest. */
  deco: DecorationSet;
};

type FindMeta =
  | { set: { query: string; opts: FindOptions; from: number } }
  | { step: 1 | -1 }
  | { goto: number }
  /** (after a replacement: the next match from here on) */
  | { after: number }
  | { clear: true };

export const findKey = new PluginKey<FindState>("find");

const EMPTY_OPTS: FindOptions = { caseSensitive: false, wholeWord: false };
const empty = (): FindState => ({ query: "", opts: EMPTY_OPTS, matches: [], current: -1, capped: false, base: DecorationSet.empty, deco: DecorationSet.empty });

/** The first match at or after `pos` (back round to the first, past the last). */
function firstFrom(matches: Match[], pos: number): number {
  if (!matches.length) return -1;
  let lo = 0;
  let hi = matches.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (matches[mid].to <= pos) lo = mid + 1;
    else hi = mid;
  }
  return lo < matches.length ? lo : 0;
}

/**
 * A match's marks: one, usually — but a match running across formatting (half of it bold, say) is
 * drawn in pieces, and each piece knows if it's the first, the last or one between, so together
 * they read as one outline rather than several boxes side by side.
 */
function marksFor(m: Match, cls: string): Decoration[] {
  const pieces = m.pieces;
  if (!pieces || pieces.length < 2) return [Decoration.inline(m.from, m.to, { class: cls })];
  return pieces.map((p, i) => Decoration.inline(p.from, p.to, { class: `${cls} ${i === 0 ? "find-l" : i === pieces.length - 1 ? "find-r" : "find-m"}` }));
}

function withCurrent(st: Omit<FindState, "deco">, doc: PMNode): FindState {
  const m = st.matches[st.current];
  const deco = m ? st.base.add(doc, marksFor(m, "find-current")) : st.base;
  return { ...st, deco };
}

function search(doc: PMNode, query: string, opts: FindOptions, current: (matches: Match[]) => number): FindState {
  const { matches, capped } = findMatches(doc, query, opts, MARK_LIMIT);
  const base = DecorationSet.create(
    doc,
    matches.flatMap((m) => marksFor(m, "find-match")),
  );
  return withCurrent({ query, opts, matches, capped, base, current: current(matches) }, doc);
}

const FindPlugin = new Plugin<FindState>({
  key: findKey,
  state: {
    init: empty,
    apply(tr: Transaction, value: FindState, _old: EditorState, state: EditorState): FindState {
      const meta = tr.getMeta(findKey) as FindMeta | undefined;
      if (meta && "clear" in meta) return empty();
      if (meta && "set" in meta) {
        const { query, opts, from } = meta.set;
        if (!query) return { ...empty(), opts };
        return search(state.doc, query, opts, (ms) => firstFrom(ms, from));
      }
      if (!value.query) return value;
      let next = value;
      if (tr.docChanged) {
        // (the note changed — typing, a friend's edits, a replacement: look again, keeping to the
        // same place)
        const was = value.matches[value.current];
        const at = was ? tr.mapping.map(was.from, -1) : 0;
        next = search(state.doc, value.query, value.opts, (ms) => firstFrom(ms, was ? at : state.selection.from));
      }
      if (meta && "after" in meta) return withCurrent({ ...next, current: firstFrom(next.matches, meta.after) }, state.doc);
      if (meta && "goto" in meta && next.matches.length) return withCurrent({ ...next, current: Math.max(0, Math.min(next.matches.length - 1, meta.goto)) }, state.doc);
      if (meta && "step" in meta && next.matches.length) {
        const n = next.matches.length;
        const from = next.current < 0 ? (meta.step > 0 ? -1 : 0) : next.current;
        return withCurrent({ ...next, current: (from + meta.step + n) % n }, state.doc);
      }
      return next;
    },
  },
  props: {
    decorations(state) {
      return findKey.getState(state)?.deco ?? DecorationSet.empty;
    },
  },
});

/** Find and replace's marks in an editor (every editor has it; only the open note's is used). */
export const Find = Extension.create({
  name: "find",
  addProseMirrorPlugins() {
    return [FindPlugin];
  },
});

// ── driving it ────────────────────────────────────────────────────────────

const usable = (editor: Editor | null | undefined): editor is Editor => Boolean(editor && !editor.isDestroyed && findKey.getState(editor.state));

export function findState(editor: Editor | null | undefined): FindState | null {
  return usable(editor) ? (findKey.getState(editor.state) ?? null) : null;
}

/** Looks for `query` (from `from`, the caret's place when you started: the first match after it is the current one). */
export function setFind(editor: Editor | null | undefined, query: string, opts: FindOptions, from?: number) {
  if (!usable(editor)) return;
  const st = findKey.getState(editor.state);
  if (st && st.query === query && st.opts.caseSensitive === opts.caseSensitive && st.opts.wholeWord === opts.wholeWord) return;
  editor.view.dispatch(editor.state.tr.setMeta(findKey, { set: { query, opts, from: from ?? editor.state.selection.from } } satisfies FindMeta).setMeta("addToHistory", false));
}

export function clearFind(editor: Editor | null | undefined) {
  if (!usable(editor) || !findKey.getState(editor.state)?.query) return;
  editor.view.dispatch(editor.state.tr.setMeta(findKey, { clear: true } satisfies FindMeta).setMeta("addToHistory", false));
}

/** The next (1) or previous (-1) match becomes the current one. */
export function stepFind(editor: Editor | null | undefined, step: 1 | -1) {
  if (!usable(editor)) return;
  editor.view.dispatch(editor.state.tr.setMeta(findKey, { step } satisfies FindMeta).setMeta("addToHistory", false));
}

/** (each replacement its own step to undo — not merged with what you typed just before) */
function ownUndoStep(editor: Editor, tr: Transaction) {
  closeHistory(tr);
  yUndoPluginKey.getState(editor.state)?.undoManager?.stopCapturing();
}

/** Replaces the current match, and moves on to the next. False if there's none. */
export function replaceCurrent(editor: Editor | null | undefined, text: string): boolean {
  if (!usable(editor) || !editor.isEditable) return false;
  const st = findKey.getState(editor.state);
  const m = st?.matches[st.current];
  if (!st || !m) return false;
  const put = inCaseOf(editor.state.doc.textBetween(m.from, m.to), text, st.opts);
  const tr = editor.state.tr.insertText(put, m.from, m.to);
  tr.setMeta(findKey, { after: m.from + put.length } satisfies FindMeta).setMeta(REPLACE_META, true);
  ownUndoStep(editor, tr);
  editor.view.dispatch(tr);
  return true;
}

/** Replaces every match (all of them, not just those marked) as one step to undo. How many it replaced. */
export function replaceAll(editor: Editor | null | undefined, text: string): number {
  if (!usable(editor) || !editor.isEditable) return 0;
  const st = findKey.getState(editor.state);
  if (!st?.query) return 0;
  const { matches } = findMatches(editor.state.doc, st.query, st.opts);
  if (!matches.length) return 0;
  const tr = editor.state.tr;
  // (from the end back, so each one's place is still true when it's reached)
  for (let i = matches.length - 1; i >= 0; i--) {
    const { from, to } = matches[i];
    tr.insertText(inCaseOf(tr.doc.textBetween(from, to), text, st.opts), from, to);
  }
  tr.setMeta(REPLACE_META, true);
  ownUndoStep(editor, tr);
  editor.view.dispatch(tr);
  return matches.length;
}

/** Selects the current match in the note (on the way out of find, so you land on it). */
export function selectCurrent(editor: Editor | null | undefined): boolean {
  const st = findState(editor);
  const m = st?.matches[st.current];
  if (!editor || !m) return false;
  editor.chain().setTextSelection({ from: m.from, to: m.to }).focus(undefined, { scrollIntoView: false }).run();
  return true;
}

/**
 * Brings the current match into view, if it isn't comfortably in view already: nearby, with a
 * glide; far off, straight there. `clearTop`: how much of the top of the view is covered.
 */
export function revealCurrent(editor: Editor | null | undefined, clearTop = 120) {
  if (!usable(editor)) return;
  const el = editor.view.dom.querySelector<HTMLElement>(".find-current");
  if (!el) return;
  // a wide table scrolls sideways on its own
  const wide = el.closest<HTMLElement>(".tableWrapper");
  if (wide) {
    const w = wide.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    if (r.left < w.left + 16 || r.right > w.right - 16) wide.scrollLeft += r.left - w.left - w.width / 3;
  }
  const scroller = el.closest<HTMLElement>(".canvas-scroll") ?? (document.scrollingElement as HTMLElement | null);
  if (!scroller) return;
  const s = scroller.getBoundingClientRect();
  const r = el.getBoundingClientRect();
  // (what's really on screen: above the keyboard, on a phone)
  const vv = window.visualViewport;
  const bottom = Math.min(s.bottom, vv ? vv.offsetTop + vv.height : s.bottom) - 48;
  const top = s.top + clearTop;
  if (r.top >= top && r.bottom <= bottom) return;
  const target = scroller.scrollTop + r.top - (top + Math.max(0, (bottom - top) * 0.3));
  const far = Math.abs(target - scroller.scrollTop) > (bottom - top) * 2;
  scroller.scrollTo({ top: Math.max(0, target), behavior: far ? "auto" : "smooth" });
}
