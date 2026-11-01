import { useEffect, useId, useMemo, useRef } from "react";
import { createPortal } from "react-dom";
import { autoUpdate, flip, offset, shift, useFloating } from "@floating-ui/react-dom";
import { AnimatePresence, motion } from "motion/react";
import { useSlash } from "./slash";
import { floatIn, spring } from "../../lib/motion";

export function SlashMenu() {
  const { open, items, index, rect, select } = useSlash();
  const id = useId();
  const list = useRef<HTMLDivElement>(null);
  const reference = useMemo(() => (rect ? { getBoundingClientRect: () => rect } : null), [rect]);
  const { refs, floatingStyles } = useFloating({
    open,
    placement: "bottom-start",
    strategy: "fixed",
    elements: { reference },
    middleware: [offset({ mainAxis: 10, crossAxis: -6 }), flip({ padding: 16 }), shift({ padding: 12 })],
    whileElementsMounted: autoUpdate,
  });

  useEffect(() => {
    const el = list.current?.querySelector<HTMLElement>(`[data-index="${index}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [index]);

  return createPortal(
    <AnimatePresence>
      {open && (
        <div ref={refs.setFloating} style={{ ...floatingStyles, zIndex: 800 }} data-floating-layer>
          <motion.div className="slash" {...floatIn} transition={spring} style={{ transformOrigin: "top left" }}>
            <div className="slash-head label">Blocks</div>
            <div className="slash-list" ref={list}>
              {items.length ? (
                items.map((item, i) => {
                  const Icon = item.icon;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      data-index={i}
                      className={`slash-item ${i === index ? "is-active" : ""}`}
                      onMouseEnter={() => useSlash.setState({ index: i })}
                      onMouseDown={(e) => {
                        e.preventDefault();
                        select?.(item);
                      }}
                    >
                      {i === index && <motion.span layoutId={`slash-hl-${id}`} className="slash-hl" transition={{ ...spring, stiffness: 900, damping: 60 }} />}
                      <span className="slash-icon">
                        <Icon size={15} strokeWidth={1.6} />
                      </span>
                      <span className="slash-title">{item.title}</span>
                      {item.hint && <span className="slash-hint">{item.hint}</span>}
                    </button>
                  );
                })
              ) : (
                <div className="slash-empty">No matching blocks</div>
              )}
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
