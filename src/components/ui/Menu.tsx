import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { motion } from "motion/react";
import { spring } from "../../lib/motion";
import { Kbd } from "./Kbd";

export type MenuItem =
  | {
      label: string;
      icon?: ReactNode;
      kbd?: string;
      hint?: string;
      danger?: boolean;
      disabled?: boolean;
      onSelect: () => void;
    }
  | "divider";

type Props = { items: MenuItem[]; onClose: () => void; autoFocus?: boolean };

export function Menu({ items, onClose, autoFocus = true }: Props) {
  const id = useId();
  const actionable = items.map((it, i) => (it !== "divider" && !it.disabled ? i : -1)).filter((i) => i >= 0);
  const [active, setActive] = useState<number>(autoFocus ? (actionable[0] ?? -1) : -1);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    ref.current?.focus({ preventScroll: true });
  }, []);

  const run = (i: number) => {
    const it = items[i];
    if (!it || it === "divider" || it.disabled) return;
    onClose();
    // Let the menu start closing before heavy actions (feels snappier).
    requestAnimationFrame(() => it.onSelect());
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
    } else if (e.key === "Tab") {
      e.preventDefault();
      onClose();
    }
  };

  return (
    <div className="menu" role="menu" tabIndex={-1} ref={ref} onKeyDown={onKeyDown} onMouseLeave={() => setActive(-1)}>
      {items.map((it, i) =>
        it === "divider" ? (
          <div key={`d${i}`} className="menu-divider" role="separator" />
        ) : (
          <button
            key={it.label}
            type="button"
            role="menuitem"
            disabled={it.disabled}
            className={`menu-item ${it.danger ? "danger" : ""}`}
            onMouseEnter={() => !it.disabled && setActive(i)}
            onClick={() => run(i)}
            tabIndex={-1}
          >
            {active === i && <motion.span layoutId={`menu-hl-${id}`} className="menu-hl" transition={{ ...spring, stiffness: 900, damping: 60 }} />}
            {it.icon && <span className="menu-icon">{it.icon}</span>}
            <span className="menu-label">{it.label}</span>
            {it.hint && <span className="menu-hint">{it.hint}</span>}
            {it.kbd && <Kbd keys={it.kbd} subtle />}
          </button>
        ),
      )}
    </div>
  );
}
