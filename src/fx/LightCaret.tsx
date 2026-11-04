import { useEffect, useRef } from "react";
import type { Editor } from "@tiptap/core";
import type { Transaction } from "@tiptap/pm/state";
import { isChangeOrigin } from "@tiptap/extension-collaboration";
import { fx } from "./engine";

let probe: CanvasRenderingContext2D | null = null;
function metrics(font: string, ch: string) {
  probe ??= document.createElement("canvas").getContext("2d");
  if (!probe) return { width: 0, descent: 0 };
  probe.font = font;
  const m = probe.measureText(ch);
  return { width: m.width, descent: m.fontBoundingBoxDescent ?? 0 };
}

/**
 * Letters you write land white-hot and cool to ink; letters you erase fall away as ash.
 * Drawn on the effects overlay, exactly over the real glyphs, so the text itself is untouched.
 */
function inkFor(editor: Editor, tr: Transaction, maxAdded = 4) {
  const view = editor.view;
  const fontAt = (pos: number) => {
    let el: Element = view.dom;
    try {
      const { node } = view.domAtPos(pos);
      el = (node.nodeType === Node.TEXT_NODE ? node.parentElement : (node as Element)) ?? view.dom;
    } catch {
      /* keep the editor's own font */
    }
    const cs = getComputedStyle(el);
    return `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
  };
  const maps = tr.mapping.maps;
  maps.forEach((map, i) => {
    const rest = tr.mapping.slice(i + 1);
    map.forEach((oldStart, oldEnd, newStart, newEnd) => {
      const from = rest.map(newStart, -1);
      const to = rest.map(newEnd, 1);
      const added = to - from;
      const removed = oldEnd - oldStart;
      try {
        if (added > 0 && added <= maxAdded && removed === 0) {
          for (let pos = from; pos < to; pos++) {
            const ch = tr.doc.textBetween(pos, pos + 1);
            if (!ch.trim()) continue;
            const font = fontAt(pos + 1);
            const c = view.coordsAtPos(pos, 1);
            fx.ink(ch, c.left, c.bottom - metrics(font, ch).descent, font);
          }
        } else if (removed > 0 && removed <= 3 && added === 0) {
          const text = tr.docs[i].textBetween(oldStart, oldEnd);
          if (!text.trim()) return;
          const font = fontAt(from);
          const c = view.coordsAtPos(from, -1);
          let x = c.left;
          for (const ch of text) {
            const m = metrics(font, ch);
            fx.ink(ch, x, c.bottom - m.descent, font, true);
            x += m.width;
          }
        }
      } catch {
        /* positions can be transiently unmappable mid-composition; skip the flourish */
      }
    });
  });
}

/**
 * A caret made of light: glides between positions, breathes when idle, glows hotter
 * the faster you write, and leaves a streak of light when it jumps somewhere new.
 */
export function LightCaret({ editor, container }: { editor: Editor | null; container: HTMLElement | null }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!editor || !container || !el) return;
    const dom = editor.view.dom as HTMLElement;
    let raf = 0;
    let idleTimer = 0;
    let heatTimer = 0;
    let heat = 0;
    let last: { x: number; y: number } | null = null;
    let pending: "type" | "erase" | null = null;
    /** When Enter was last pressed (a paragraph finishing, if the note gains a block from it). */
    let enterAt = -1e9;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Enter" && !e.isComposing && !e.shiftKey && !e.altKey && !e.ctrlKey && !e.metaKey) enterAt = performance.now();
    };

    const place = () => {
      raf = 0;
      if (editor.isDestroyed) return;
      const on = fx.active;
      dom.classList.toggle("has-light-caret", on);
      const sel = editor.state.selection;
      if (!on || !editor.isFocused || !sel.empty) {
        el.classList.remove("is-on");
        last = null;
        return;
      }
      let c: { left: number; top: number; bottom: number };
      try {
        c = editor.view.coordsAtPos(sel.head);
      } catch {
        return;
      }
      const box = container.getBoundingClientRect();
      const h = Math.max(14, c.bottom - c.top);
      el.style.height = `${h}px`;
      el.style.transform = `translate3d(${c.left - box.left}px, ${c.top - box.top}px, 0)`;
      el.classList.add("is-on");
      el.classList.remove("is-idle");
      window.clearTimeout(idleTimer);
      idleTimer = window.setTimeout(() => el.classList.add("is-idle"), 520);
      const at = { x: c.left, y: c.top + h / 2 };
      // Moves caused by typing (like wrapping to a new line) don't count as jumps.
      if (!pending && last && Math.hypot(at.x - last.x, at.y - last.y) > 90) fx.trail(last, at, undefined, { quiet: true, dur: 260 });
      pending = null;
      last = at;
    };
    const schedule = () => {
      // Going out never waits for the next frame (a slow one mustn't leave it lit where it was —
      // say, behind a whole table column you've just selected).
      if (!fx.active || !editor.isFocused || !editor.state.selection.empty) {
        el.classList.remove("is-on");
        last = null;
      }
      if (!raf) raf = requestAnimationFrame(place);
    };
    const onTransaction = ({ transaction }: { transaction: Transaction }) => {
      // Someone else's words arriving in a shared note: they land glowing too.
      if (transaction.docChanged && isChangeOrigin(transaction)) {
        if (fx.full && fx.hotLetters && !document.hidden) inkFor(editor, transaction, 40);
        schedule();
        return;
      }
      if (transaction.docChanged) {
        // a paragraph finished: the scene may mark it (in Ink, a drop of ink lets go into the water)
        if (performance.now() - enterAt < 150 && transaction.doc.childCount > transaction.before.childCount) {
          enterAt = -1e9;
          try {
            const c = editor.view.coordsAtPos(transaction.selection.head);
            fx.paragraph(c.left, c.top);
          } catch {
            /* (no position to give) */
          }
        }
        if (fx.full && fx.hotLetters && editor.isFocused && !editor.view.composing) inkFor(editor, transaction);
        pending = transaction.doc.content.size >= transaction.before.content.size ? "type" : "erase";
        heat = Math.min(1, heat + 0.14);
        el.style.setProperty("--heat", heat.toFixed(2));
        el.style.setProperty("--heat-w", `${Math.round(12 + heat * 56)}px`);
        window.clearTimeout(heatTimer);
        heatTimer = window.setTimeout(() => {
          heat = 0;
          el.style.setProperty("--heat", "0");
          el.style.setProperty("--heat-w", "0px");
        }, 700);
      }
      schedule();
    };

    editor.on("transaction", onTransaction);
    dom.addEventListener("keydown", onKey, true);
    editor.on("focus", schedule);
    editor.on("blur", schedule);
    editor.on("selectionUpdate", schedule);
    addEventListener("resize", schedule);
    schedule();
    return () => {
      editor.off("transaction", onTransaction);
      dom.removeEventListener("keydown", onKey, true);
      editor.off("focus", schedule);
      editor.off("blur", schedule);
      editor.off("selectionUpdate", schedule);
      removeEventListener("resize", schedule);
      cancelAnimationFrame(raf);
      window.clearTimeout(idleTimer);
      window.clearTimeout(heatTimer);
      dom.classList.remove("has-light-caret");
    };
  }, [editor, container]);

  return <div ref={ref} className="light-caret" aria-hidden />;
}
