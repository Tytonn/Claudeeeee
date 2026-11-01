import { cloneElement, isValidElement, useEffect, useRef, useState, type ReactElement, type ReactNode, type Ref } from "react";
import { createPortal } from "react-dom";
import { autoUpdate, flip, offset, shift, useFloating, type Placement } from "@floating-ui/react-dom";
import { AnimatePresence, motion } from "motion/react";
import { Kbd } from "./Kbd";

// Once one tooltip has shown, neighbours appear instantly (feels like native UI).
let lastClosedAt = 0;

type Props = {
  label: ReactNode;
  kbd?: string | string[];
  placement?: Placement;
  disabled?: boolean;
  children: ReactElement;
};

type TriggerProps = {
  ref?: Ref<HTMLElement>;
  onPointerEnter?: (e: React.PointerEvent<HTMLElement>) => void;
  onPointerLeave?: (e: React.PointerEvent<HTMLElement>) => void;
  onPointerDown?: (e: React.PointerEvent<HTMLElement>) => void;
  onFocus?: (e: React.FocusEvent<HTMLElement>) => void;
  onBlur?: (e: React.FocusEvent<HTMLElement>) => void;
};

function assignRef<T>(ref: Ref<T> | undefined, value: T) {
  if (typeof ref === "function") ref(value);
  else if (ref && typeof ref === "object") (ref as { current: T }).current = value;
}

export function Tooltip({ label, kbd, placement = "bottom", disabled, children }: Props) {
  const [open, setOpen] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  const { refs, floatingStyles, placement: side } = useFloating({
    open,
    placement,
    strategy: "fixed",
    middleware: [offset(8), flip({ padding: 8 }), shift({ padding: 8 })],
    whileElementsMounted: autoUpdate,
  });

  useEffect(() => () => window.clearTimeout(timer.current), []);
  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);

  if (!isValidElement(children)) return children;
  const child = children as ReactElement<TriggerProps>;
  const props = child.props;

  const show = () => {
    if (disabled) return;
    window.clearTimeout(timer.current);
    const warm = Date.now() - lastClosedAt < 450;
    timer.current = window.setTimeout(() => setOpen(true), warm ? 30 : 560);
  };
  const hide = () => {
    window.clearTimeout(timer.current);
    setOpen((was) => {
      if (was) lastClosedAt = Date.now();
      return false;
    });
  };

  const trigger = cloneElement(child, {
    ref: (node: HTMLElement | null) => {
      refs.setReference(node);
      assignRef(props.ref, node);
    },
    onPointerEnter: (e: React.PointerEvent<HTMLElement>) => {
      props.onPointerEnter?.(e);
      if (e.pointerType === "mouse") show();
    },
    onPointerLeave: (e: React.PointerEvent<HTMLElement>) => {
      props.onPointerLeave?.(e);
      hide();
    },
    onPointerDown: (e: React.PointerEvent<HTMLElement>) => {
      props.onPointerDown?.(e);
      hide();
    },
    onFocus: (e: React.FocusEvent<HTMLElement>) => {
      props.onFocus?.(e);
      try {
        if (e.currentTarget.matches(":focus-visible")) show();
      } catch {
        /* older browsers */
      }
    },
    onBlur: (e: React.FocusEvent<HTMLElement>) => {
      props.onBlur?.(e);
      hide();
    },
  });

  const dir = side.split("-")[0];
  const offsetY = dir === "top" ? 3 : dir === "bottom" ? -3 : 0;
  const offsetX = dir === "left" ? 3 : dir === "right" ? -3 : 0;

  return (
    <>
      {trigger}
      {createPortal(
        <AnimatePresence>
          {open && (
            <div ref={refs.setFloating} style={{ ...floatingStyles, zIndex: 1000, pointerEvents: "none" }}>
              <motion.div
                className="tooltip"
                role="tooltip"
                initial={{ opacity: 0, scale: 0.96, x: offsetX, y: offsetY }}
                animate={{ opacity: 1, scale: 1, x: 0, y: 0 }}
                exit={{ opacity: 0, scale: 0.98, transition: { duration: 0.08 } }}
                transition={{ duration: 0.14, ease: [0.2, 0.8, 0.2, 1] }}
              >
                <span>{label}</span>
                {kbd && <Kbd keys={kbd} subtle />}
              </motion.div>
            </div>
          )}
        </AnimatePresence>,
        document.body,
      )}
    </>
  );
}
