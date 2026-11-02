import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import type * as Y from "yjs";

const LOCAL = "umbra-local-text";

/**
 * Binds a plain <textarea>/<input> to a Y.Text, so a title can be co-edited: your typing
 * becomes minimal Yjs edits, and someone else's edits flow in without your caret jumping.
 * Returns [value, setValue] — or [null, noop] when there's no Y.Text.
 */
export function useYText(ytext: Y.Text | null, ref: RefObject<HTMLTextAreaElement | HTMLInputElement | null>): [string | null, (next: string) => void] {
  const [value, setValue] = useState<string | null>(() => ytext?.toString() ?? null);
  const selection = useRef<[number, number] | null>(null);

  useEffect(() => {
    if (!ytext) {
      setValue(null);
      return;
    }
    setValue(ytext.toString());
    const onChange = (event: Y.YTextEvent, tr: Y.Transaction) => {
      const el = ref.current;
      if (tr.origin !== LOCAL && el && document.activeElement === el) {
        // Carry the caret through someone else's edit.
        let a = el.selectionStart ?? 0;
        let b = el.selectionEnd ?? 0;
        let pos = 0;
        for (const op of event.delta) {
          if (op.retain) pos += op.retain;
          else if (typeof op.insert === "string") {
            const len = op.insert.length;
            if (pos <= a) a += len;
            if (pos <= b) b += len;
            pos += len;
          } else if (op.delete) {
            const end = pos + op.delete;
            a = a >= end ? a - op.delete : Math.min(a, pos);
            b = b >= end ? b - op.delete : Math.min(b, pos);
          }
        }
        selection.current = [a, b];
      }
      setValue(ytext.toString());
    };
    ytext.observe(onChange);
    return () => ytext.unobserve(onChange);
  }, [ytext, ref]);

  useLayoutEffect(() => {
    const sel = selection.current;
    if (sel && ref.current) {
      selection.current = null;
      ref.current.setSelectionRange(sel[0], sel[1]);
    }
  });

  const set = useCallback(
    (next: string) => {
      if (!ytext?.doc) return;
      const cur = ytext.toString();
      if (cur === next) return;
      let start = 0;
      while (start < cur.length && start < next.length && cur[start] === next[start]) start++;
      let endCur = cur.length;
      let endNext = next.length;
      while (endCur > start && endNext > start && cur[endCur - 1] === next[endNext - 1]) {
        endCur--;
        endNext--;
      }
      ytext.doc.transact(() => {
        if (endCur > start) ytext.delete(start, endCur - start);
        if (endNext > start) ytext.insert(start, next.slice(start, endNext));
      }, LOCAL);
    },
    [ytext],
  );

  return [value, set];
}
