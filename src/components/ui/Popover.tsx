import { useEffect, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { autoUpdate, flip, offset, shift, size, useFloating, type Placement, type VirtualElement } from "@floating-ui/react-dom";
import { AnimatePresence, motion } from "motion/react";
import { useEscape } from "../../lib/escape";
import { floatIn, spring } from "../../lib/motion";

type Props = {
  open: boolean;
  onClose: () => void;
  anchor: Element | VirtualElement | null;
  placement?: Placement;
  children: ReactNode;
  className?: string;
  offsetPx?: number;
  label?: string;
  role?: string;
};

export function Popover({ open, onClose, anchor, placement = "bottom-end", children, className = "", offsetPx = 8, label, role = "dialog" }: Props) {
  const { refs, floatingStyles, placement: side } = useFloating({
    open,
    placement,
    strategy: "fixed",
    elements: { reference: anchor },
    middleware: [
      offset(offsetPx),
      flip({ padding: 12 }),
      shift({ padding: 12 }),
      size({
        padding: 12,
        apply({ availableHeight, elements }) {
          elements.floating.style.maxHeight = `${Math.max(180, availableHeight)}px`;
        },
      }),
    ],
    whileElementsMounted: autoUpdate,
  });

  useEscape(onClose, open);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const target = e.target as Node;
      const floating = refs.floating.current;
      if (floating?.contains(target)) return;
      if (anchor && "contains" in anchor && (anchor as Element).contains(target)) return;
      // Clicks inside other floating layers (nested menus, tooltips) shouldn't close us.
      if ((target as Element).closest?.("[data-floating-layer]") && !floating?.contains(target)) {
        const layer = (target as Element).closest("[data-floating-layer]");
        if (layer && layer !== floating) return;
      }
      onClose();
    };
    window.addEventListener("pointerdown", onDown, true);
    return () => window.removeEventListener("pointerdown", onDown, true);
  }, [open, anchor, onClose, refs.floating]);

  const origin = side.startsWith("top") ? "bottom" : "top";
  const xOrigin = side.endsWith("end") ? "right" : side.endsWith("start") ? "left" : "center";

  return createPortal(
    <AnimatePresence>
      {open && (
        <div ref={refs.setFloating} style={{ ...floatingStyles, zIndex: 900 }} data-floating-layer>
          <motion.div
            role={role}
            aria-label={label}
            className={`popover ${className}`}
            style={{ transformOrigin: `${origin} ${xOrigin}` }}
            {...floatIn}
            transition={spring}
          >
            {children}
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  );
}

export function pointAnchor(x: number, y: number): VirtualElement {
  return {
    getBoundingClientRect: () => ({ x, y, left: x, top: y, right: x, bottom: y, width: 0, height: 0, toJSON: () => ({}) }) as DOMRect,
  };
}
