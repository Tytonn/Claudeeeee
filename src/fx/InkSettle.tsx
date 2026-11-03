import { useEffect, useRef } from "react";
import type { Editor } from "@tiptap/core";
import { Plugin, PluginKey, type EditorState } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
import { useApp } from "../store/app";

/**
 * Letters settle like ink (the Ink scene only): each letter you type lands wet — deep blue-black,
 * a touch heavy, bleeding a little into the paper — and dries to the page's own tone in under a
 * second as it soaks in. So the last few letters behind the caret are always still drying, the
 * freshest the wettest, like writing with a fountain pen.
 *
 * Nothing in the text itself is touched. Each new letter gets a fleeting copy of itself laid
 * exactly over it, on a layer of its own beside the editor: the wet ink, fading away. So the words
 * never move, the layout never shifts, and the caret, selection, undo, paste, spellcheck,
 * autocorrect, IME and phone keyboards all work exactly as they always do. Only typing does it:
 * pasted text, undo, someone else's words in a shared note and notes opening all appear as they
 * are. (It's only ever a fade — nothing moves — so it stays with reduced motion too.)
 */

const KEY = new PluginKey("inkSettle");
/** How long a letter takes to dry (ms). */
const DRY_MS = 900;
/** At most this many letters drying at once (a burst of typing never piles up work). */
const MAX_GHOSTS = 32;
/** Wet ink: a deep blue-black, as fountain-pen ink is before it dries (the ink in the water has a hint of it too). */
const WET_INK = "#141c5a";

/** A letter typed and still drying: where it is in the note now, and its wet ink (once drawn). */
type Letter = { pos: number; ch: string; ink?: HTMLElement; at?: string };

export function InkSettle({ editor, container }: { editor: Editor | null; container: HTMLElement | null }) {
  const layer = useRef<HTMLDivElement>(null);
  const on = useApp((s) => s.settings.scene === "ink" && s.settings.inkSettle !== false);

  useEffect(() => {
    const el = layer.current;
    if (!editor || editor.isDestroyed || !container || !el || !on) return;
    let typedAt = -1;
    let raf = 0;
    /** The letters still drying, oldest first. */
    let letters: Letter[] = [];
    const styles = new Map<Element, CSSStyleDeclaration>();
    const wipe = (l: Letter) => l.ink?.remove();

    /** Draws a letter's ink, or keeps it over its letter: false if the letter isn't there now. */
    const show = (l: Letter, view: EditorView, box: DOMRect): boolean => {
      const { doc } = view.state;
      if (l.pos + 1 > doc.content.size || doc.textBetween(l.pos, l.pos + 1) !== l.ch) return false;
      const c = view.coordsAtPos(l.pos, 1);
      const h = c.bottom - c.top;
      if (!(h > 0) || h > 400) return false;
      const x = c.left - box.left;
      const y = c.top - box.top;
      // (moved only if it has to: the ink of a letter that hasn't moved is left alone)
      const at = `${x.toFixed(1)} ${y.toFixed(1)} ${h.toFixed(1)}`;
      if (l.ink) {
        if (at !== l.at) place(l.ink, x, y, h);
        l.at = at;
        return true;
      }
      l.at = at;
      const host = hostOf(view, l.pos);
      if (!host) return false;
      let cs = styles.get(host);
      if (!cs) {
        cs = getComputedStyle(host);
        styles.set(host, cs);
      }
      l.ink = ghost(el, l.ch, x, y, h, cs);
      return Boolean(l.ink);
    };

    /** Draws the letters just typed, and keeps the ink of the others over their letters (a line
     *  that wrapped, a line added above). Anything no longer there, or not the same, goes. */
    const draw = () => {
      raf = 0;
      if (editor.isDestroyed) return;
      const view = editor.view;
      const box = el.getBoundingClientRect();
      styles.clear();
      const keep: Letter[] = [];
      for (const l of letters) {
        if (l.ink && !l.ink.isConnected) continue;
        let shown = false;
        try {
          shown = show(l, view, box);
        } catch {
          /* a place that can't be drawn this moment: let it be */
        }
        if (shown) keep.push(l);
        else wipe(l);
      }
      // a burst of typing never piles up work
      while (keep.length > MAX_GHOSTS) wipe(keep.shift()!);
      letters = keep;
    };

    const plugin = new Plugin({
      key: KEY,
      props: {
        // the one sure sign of typing (paste, drop, undo and remote changes never come this way);
        // it lets the input through untouched
        handleTextInput() {
          typedAt = performance.now();
          return false;
        },
      },
      view: () => ({
        update(view: EditorView, prev: EditorState) {
          if (view.state.doc === prev.doc) return;
          const typed = typedAt > 0 && performance.now() - typedAt < 80;
          typedAt = -1;
          letters = letters.filter((l) => !l.ink || l.ink.isConnected);
          // on many phone keyboards every letter arrives inside a composition: that's typing too
          if (!letters.length && !typed && !view.composing) return;
          const ch = change(prev, view.state);
          if (!ch) return;
          // the ink still drying moves with its letters; a letter taken away (Backspace, a
          // shortcut turning "## " into a heading, undo…) takes its ink with it
          if (letters.length) {
            const by = ch.endB - ch.endA;
            letters = letters.filter((l) => {
              if (l.pos < ch.start) return true;
              if (l.pos >= ch.endA) {
                l.pos += by;
                return true;
              }
              wipe(l);
              return false;
            });
          }
          // a letter or three typed (nothing taken away): fresh ink
          const added = ch.endB - ch.start;
          if ((typed || view.composing) && ch.endA === ch.start && added >= 1 && added <= 3) {
            for (let pos = ch.start; pos < ch.endB; pos++) {
              const c = view.state.doc.textBetween(pos, pos + 1);
              if (c && c.trim()) letters.push({ pos, ch: c });
            }
          }
          if (letters.length && !raf) raf = requestAnimationFrame(draw);
        },
      }),
    });
    editor.registerPlugin(plugin);
    return () => {
      cancelAnimationFrame(raf);
      if (!editor.isDestroyed) editor.unregisterPlugin(KEY);
      letters = [];
      el.replaceChildren();
    };
  }, [editor, container, on]);

  return <div ref={layer} className="ink-settle-layer" aria-hidden />;
}

/** What a change did, as one stretch: from `start`, what was up to `endA` is now up to `endB`. */
function change(prev: EditorState, next: EditorState): { start: number; endA: number; endB: number } | null {
  const a = prev.doc.content;
  const b = next.doc.content;
  const start = a.findDiffStart(b);
  if (start == null) return null;
  const end = a.findDiffEnd(b);
  if (!end) return null;
  let endA = end.a;
  let endB = end.b;
  // (a run of the same letter can make the two ends overlap)
  const overlap = start - Math.min(endA, endB);
  if (overlap > 0) {
    endA += overlap;
    endB += overlap;
  }
  return { start, endA, endB };
}

/** The element a letter is written in (its <em>, <code>, <a>…), for its font and colour. */
function hostOf(view: EditorView, pos: number): Element | null {
  const at = view.domAtPos(pos + 1, -1);
  let node: Node | null = at.node;
  if (node.nodeType !== Node.TEXT_NODE) {
    // (between elements: the letter is at the end of the one before)
    let inner: Node | null = node.childNodes[at.offset - 1] ?? null;
    while (inner && inner.nodeType !== Node.TEXT_NODE && inner.lastChild) inner = inner.lastChild;
    if (inner) node = inner;
  }
  return node.nodeType === Node.TEXT_NODE ? node.parentElement : (node as Element);
}

/** Puts a letter's ink at its place (in the layer), the height of its line. */
function place(g: HTMLElement, x: number, y: number, h: number) {
  const s = g.style;
  s.left = `${x}px`;
  s.top = `${y}px`;
  s.height = `${h}px`;
  s.lineHeight = `${h}px`;
}

/**
 * Lays a fleeting copy of a letter exactly over it, in wet ink — its own colour, deepened toward
 * blue-black, heavier at the edges and bleeding softly into the paper — and lets it dry away into
 * the letter's own. (Only its opacity changes as it dries, which the browser does on its own,
 * off the page's thread: typing stays as light as ever.)
 */
function ghost(layer: HTMLElement, ch: string, x: number, y: number, h: number, cs: CSSStyleDeclaration): HTMLElement | undefined {
  const g = document.createElement("span");
  if (typeof g.animate !== "function") return undefined;
  g.className = "ink-settle";
  g.textContent = ch;
  place(g, x, y, h);
  const s = g.style;
  s.fontFamily = cs.fontFamily;
  s.fontSize = cs.fontSize;
  s.fontWeight = cs.fontWeight;
  s.fontStyle = cs.fontStyle;
  s.fontStretch = cs.fontStretch;
  s.fontFeatureSettings = cs.fontFeatureSettings;
  s.fontVariationSettings = cs.fontVariationSettings;
  s.fontKerning = cs.fontKerning;
  s.textTransform = cs.textTransform;
  // wet ink: the letter's own colour, deepened toward blue-black
  const wet = `color-mix(in oklab, ${cs.color} 30%, ${WET_INK})`;
  const ink = (strength: number) => `color-mix(in oklab, ${wet} ${strength}%, transparent)`;
  // heavier at its edges, and bled a little into the paper (in proportion to the letter, within reason)
  const size = parseFloat(cs.fontSize) || 16;
  const edge = Math.max(0.5, size * 0.04).toFixed(2);
  const bleed = Math.min(size * 0.16, 3.5).toFixed(2);
  s.color = wet;
  s.textShadow = `0 0 ${edge}px ${ink(85)}, 0 0 ${bleed}px ${ink(50)}`;
  s.opacity = "0";
  layer.append(g);
  const a = g.animate(
    [
      // it lands, wet through, and stays wet a moment
      { opacity: 1, offset: 0 },
      { opacity: 1, offset: 0.12 },
      // soaking in
      { opacity: 0.55, offset: 0.45 },
      // dry: just the letter, as it always was
      { opacity: 0, offset: 1 },
    ],
    { duration: DRY_MS, easing: "linear" },
  );
  const done = () => g.remove();
  a.onfinish = done;
  a.oncancel = done;
  return g;
}
