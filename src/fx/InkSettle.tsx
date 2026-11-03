import { useEffect, useRef } from "react";
import type { Editor } from "@tiptap/core";
import { Plugin, PluginKey, type EditorState } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
import { useApp } from "../store/app";
import { fx } from "./engine";

/**
 * Letters settle like ink (the Ink scene only): each letter you type is there the instant you
 * type it — a touch soft and dark, as ink is the moment it touches paper — and sharpens into
 * place over about 150 ms as it soaks in.
 *
 * Nothing in the text itself is touched. Each new letter gets a fleeting copy of itself laid
 * exactly over it, on a layer of its own beside the editor: darker, a little blurred, fading
 * away. So the words never move, the layout never shifts, and the caret, selection, undo,
 * paste, spellcheck, autocorrect, IME and phone keyboards all work exactly as they always do.
 * Only typing does it: pasted text, undo, someone else's words in a shared note and notes
 * opening all appear as they are.
 */

const KEY = new PluginKey("inkSettle");
/** How long a letter takes to soak in (ms). */
const SETTLE_MS = 155;
/** At most this many letters soaking in at once (a burst of typing never piles up work). */
const MAX_GHOSTS = 28;

type Pending = { pos: number; ch: string };

export function InkSettle({ editor, container }: { editor: Editor | null; container: HTMLElement | null }) {
  const layer = useRef<HTMLDivElement>(null);
  const on = useApp((s) => s.settings.scene === "ink" && s.settings.inkSettle !== false);

  useEffect(() => {
    const el = layer.current;
    if (!editor || editor.isDestroyed || !container || !el || !on || fx.reducedMotion) return;
    let typedAt = -1;
    let raf = 0;
    let pending: Pending[] = [];
    const styles = new Map<Element, CSSStyleDeclaration>();

    const draw = () => {
      raf = 0;
      const view = editor.view;
      const items = pending;
      pending = [];
      if (editor.isDestroyed || !items.length) return;
      const box = el.getBoundingClientRect();
      styles.clear();
      for (const { pos, ch } of items) {
        try {
          // still the same letter in the same place? (anything else: let it be)
          if (pos + 1 > view.state.doc.content.size || view.state.doc.textBetween(pos, pos + 1) !== ch) continue;
          const at = view.domAtPos(pos + 1);
          const host = at.node.nodeType === Node.TEXT_NODE ? at.node.parentElement : (at.node as Element);
          if (!host) continue;
          const c = view.coordsAtPos(pos, 1);
          const h = c.bottom - c.top;
          if (!(h > 0) || h > 400) continue;
          let cs = styles.get(host);
          if (!cs) {
            cs = getComputedStyle(host);
            styles.set(host, cs);
          }
          ghost(el, ch, c.left - box.left, c.top - box.top, h, cs);
        } catch {
          /* a position that can't be drawn this moment: no matter */
        }
      }
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
          // on many phone keyboards every letter arrives inside a composition: that's typing too
          if (!typed && !view.composing) return;
          const added = insertion(prev, view.state);
          if (!added) return;
          for (let pos = added.from; pos < added.to; pos++) {
            const ch = view.state.doc.textBetween(pos, pos + 1);
            if (ch && ch.trim()) pending.push({ pos, ch });
          }
          if (pending.length && !raf) raf = requestAnimationFrame(draw);
        },
      }),
    });
    editor.registerPlugin(plugin);
    return () => {
      cancelAnimationFrame(raf);
      if (!editor.isDestroyed) editor.unregisterPlugin(KEY);
      el.replaceChildren();
    };
  }, [editor, container, on]);

  return <div ref={layer} className="ink-settle-layer" aria-hidden />;
}

/** What a change added, if it only added a letter or three (and took nothing away). */
function insertion(prev: EditorState, next: EditorState): { from: number; to: number } | null {
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
  const removed = endA - start;
  const added = endB - start;
  if (removed !== 0 || added < 1 || added > 3) return null;
  return { from: start, to: endB };
}

/** Lays a fleeting, darker, softer copy of a letter exactly over it, and lets it soak away. */
function ghost(layer: HTMLElement, ch: string, x: number, y: number, h: number, cs: CSSStyleDeclaration) {
  while (layer.childElementCount >= MAX_GHOSTS) layer.firstElementChild?.remove();
  const g = document.createElement("span");
  g.className = "ink-settle";
  g.textContent = ch;
  const s = g.style;
  s.left = `${x}px`;
  s.top = `${y}px`;
  s.height = `${h}px`;
  s.lineHeight = `${h}px`;
  s.fontFamily = cs.fontFamily;
  s.fontSize = cs.fontSize;
  s.fontWeight = cs.fontWeight;
  s.fontStyle = cs.fontStyle;
  s.fontStretch = cs.fontStretch;
  s.fontFeatureSettings = cs.fontFeatureSettings;
  s.fontVariationSettings = cs.fontVariationSettings;
  s.fontKerning = cs.fontKerning;
  s.textTransform = cs.textTransform;
  // its own colour, a good deal deeper: wet ink
  s.color = `color-mix(in oklab, ${cs.color} 45%, #07060a)`;
  layer.append(g);
  const a = g.animate(
    [
      { opacity: 0.85, filter: "blur(0.7px)", textShadow: "0 0 1.4px rgb(10 9 14 / 0.55)" },
      { opacity: 0.32, filter: "blur(0.35px)", textShadow: "0 0 0.8px rgb(10 9 14 / 0.25)", offset: 0.45 },
      { opacity: 0, filter: "blur(0px)", textShadow: "0 0 0px rgb(10 9 14 / 0)" },
    ],
    { duration: SETTLE_MS, easing: "cubic-bezier(0.25, 0.6, 0.3, 1)" },
  );
  const done = () => g.remove();
  a.onfinish = done;
  a.oncancel = done;
}
