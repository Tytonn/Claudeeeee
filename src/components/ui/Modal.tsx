import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "motion/react";
import { useEscape } from "../../lib/escape";
import { spring } from "../../lib/motion";

type Props = {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  className?: string;
  label: string;
  /** "center" for dialogs, "top" for command-palette style. */
  position?: "center" | "top";
};

export function Modal({ open, onClose, children, className = "", label, position = "center" }: Props) {
  useEscape(onClose, open);
  const restore = useRef<HTMLElement | null>(null);
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) {
      restore.current = document.activeElement as HTMLElement | null;
      // Focus the first field (or the panel) once mounted.
      requestAnimationFrame(() => {
        const target = panel.current?.querySelector<HTMLElement>("[data-autofocus]");
        (target ?? panel.current)?.focus({ preventScroll: true });
      });
    } else if (restore.current) {
      const el = restore.current;
      restore.current = null;
      requestAnimationFrame(() => el.isConnected && el.focus({ preventScroll: true }));
    }
  }, [open]);

  // Basic focus trap.
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== "Tab" || !panel.current) return;
    const items = [...panel.current.querySelectorAll<HTMLElement>('button:not([disabled]), input, textarea, [tabindex]:not([tabindex="-1"])')].filter(
      (el) => el.offsetParent !== null,
    );
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          className={`overlay ${position}`}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0, transition: { duration: 0.16 } }}
          transition={{ duration: 0.2 }}
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) onClose();
          }}
        >
          <motion.div
            ref={panel}
            role="dialog"
            aria-modal="true"
            aria-label={label}
            tabIndex={-1}
            className={`modal ${className}`}
            onKeyDown={onKeyDown}
            initial={{ opacity: 0, scale: 0.965, y: position === "top" ? -10 : 10, filter: "blur(8px)" }}
            animate={{ opacity: 1, scale: 1, y: 0, filter: "blur(0px)" }}
            exit={{ opacity: 0, scale: 0.98, y: position === "top" ? -6 : 6, filter: "blur(4px)", transition: { duration: 0.14 } }}
            transition={spring}
          >
            {children}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
