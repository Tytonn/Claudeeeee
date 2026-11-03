import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Check, ChevronLeft, ChevronRight } from "lucide-react";
import { spring } from "../../lib/motion";
import { useEscape } from "../../lib/escape";
import { Kbd } from "./Kbd";

export type MenuItem =
  | {
      label: string;
      icon?: ReactNode;
      kbd?: string;
      hint?: string;
      danger?: boolean;
      /** Set in the accent colour, to stand out (like danger, but friendly). */
      accent?: boolean;
      disabled?: boolean;
      /** Shows a check mark (the current choice in a list). */
      checked?: boolean;
      /** Opens a list of its own in place of this one (with a way back). */
      submenu?: MenuItem[];
      /** Run right away, inside the tap itself (needed to open a file picker on phones). */
      immediate?: boolean;
      onSelect?: () => void;
    }
  | "divider";

type Props = { items: MenuItem[]; onClose: () => void; autoFocus?: boolean };

type Level = { title: string; items: MenuItem[] };

export function Menu({ items, onClose, autoFocus = true }: Props) {
  const id = useId();
  // A stack: the menu itself, then any submenu opened from it.
  const [stack, setStack] = useState<Level[]>([{ title: "", items }]);
  const [dir, setDir] = useState(1);
  const level = stack[stack.length - 1];
  const list = level.items;
  const actionable = list.map((it, i) => (it !== "divider" && !it.disabled ? i : -1)).filter((i) => i >= 0);
  const [active, setActive] = useState<number>(autoFocus ? (actionable[0] ?? -1) : -1);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    ref.current?.focus({ preventScroll: true });
  }, []);

  // Keep the top level current if the items change while it's open.
  useEffect(() => {
    setStack((s) => (s.length === 1 ? [{ title: "", items }] : s));
  }, [items]);

  const open = (it: Exclude<MenuItem, "divider">) => {
    setDir(1);
    setStack((s) => [...s, { title: it.label, items: it.submenu ?? [] }]);
    const first = (it.submenu ?? []).findIndex((x) => x !== "divider" && !x.disabled);
    setActive(first);
  };

  const back = () => {
    if (stack.length < 2) return;
    setDir(-1);
    setStack((s) => s.slice(0, -1));
    setActive(-1);
  };
  // Inside a submenu, Escape steps back out before it closes anything.
  useEscape(back, stack.length > 1);

  const run = (i: number) => {
    const it = list[i];
    if (!it || it === "divider" || it.disabled) return;
    if (it.submenu) {
      open(it);
      return;
    }
    if (it.immediate) {
      it.onSelect?.();
      onClose();
      return;
    }
    onClose();
    // Let the menu start closing before heavy actions (feels snappier).
    requestAnimationFrame(() => it.onSelect?.());
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    const pos = actionable.indexOf(active);
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive(actionable[(pos + 1) % actionable.length]);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive(actionable[(pos - 1 + actionable.length) % actionable.length]);
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      run(active);
    } else if (e.key === "ArrowRight") {
      const it = list[active];
      if (it && it !== "divider" && it.submenu) {
        e.preventDefault();
        open(it);
      }
    } else if (e.key === "ArrowLeft" || (e.key === "Backspace" && stack.length > 1)) {
      if (stack.length > 1) {
        e.preventDefault();
        back();
      }
    } else if (e.key === "Tab") {
      e.preventDefault();
      onClose();
    }
  };

  return (
    <div className="menu" role="menu" tabIndex={-1} ref={ref} onKeyDown={onKeyDown} onMouseLeave={() => setActive(-1)}>
      <AnimatePresence initial={false} mode="popLayout" custom={dir}>
        <motion.div
          key={stack.length}
          className="menu-level"
          custom={dir}
          initial={{ opacity: 0, x: dir * 18 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: dir * -18, transition: { duration: 0.12 } }}
          transition={{ ...spring, stiffness: 700, damping: 50 }}
        >
          {stack.length > 1 && (
            <>
              <button type="button" className="menu-back" onClick={back} tabIndex={-1}>
                <ChevronLeft size={14} strokeWidth={2} />
                <span>{level.title}</span>
              </button>
              <div className="menu-divider" role="separator" />
            </>
          )}
          {list.map((it, i) =>
            it === "divider" ? (
              <div key={`d${i}`} className="menu-divider" role="separator" />
            ) : (
              <button
                key={`${it.label}-${i}`}
                type="button"
                role={it.checked !== undefined ? "menuitemradio" : "menuitem"}
                aria-checked={it.checked}
                aria-haspopup={it.submenu ? "menu" : undefined}
                disabled={it.disabled}
                className={`menu-item ${it.danger ? "danger" : it.accent ? "accent" : ""}`}
                onMouseEnter={() => !it.disabled && setActive(i)}
                onClick={() => run(i)}
                tabIndex={-1}
              >
                {active === i && <motion.span layoutId={`menu-hl-${id}`} className="menu-hl" transition={{ ...spring, stiffness: 900, damping: 60 }} />}
                {it.icon && <span className="menu-icon">{it.icon}</span>}
                <span className="menu-label">{it.label}</span>
                {it.hint && <span className="menu-hint">{it.hint}</span>}
                {it.kbd && <Kbd keys={it.kbd} subtle />}
                {it.checked && (
                  <span className="menu-check">
                    <Check size={14} strokeWidth={2} />
                  </span>
                )}
                {it.submenu && (
                  <span className="menu-more">
                    <ChevronRight size={14} strokeWidth={1.8} />
                  </span>
                )}
              </button>
            ),
          )}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
