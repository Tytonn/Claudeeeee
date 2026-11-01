import { useEffect, useRef } from "react";

/** A stack so that Escape only closes the top-most layer (menu → popover → modal). */
const stack: { id: number; fn: () => void }[] = [];
let counter = 0;

if (typeof window !== "undefined") {
  window.addEventListener(
    "keydown",
    (e) => {
      if (e.key !== "Escape" || !stack.length || e.defaultPrevented) return;
      const top = stack[stack.length - 1];
      e.preventDefault();
      e.stopPropagation();
      top.fn();
    },
    true,
  );
}

export function useEscape(handler: () => void, active = true) {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    if (!active) return;
    const id = ++counter;
    stack.push({ id, fn: () => ref.current() });
    return () => {
      const i = stack.findIndex((s) => s.id === id);
      if (i >= 0) stack.splice(i, 1);
    };
  }, [active]);
}

export const escapeLayers = () => stack.length;
