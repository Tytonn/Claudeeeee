import { useEffect, useRef } from "react";
import { haptic } from "./sound";

/** How long a finger has to rest on something to open its menu. */
const HOLD_MS = 460;

/** A touch screen (no hovering pointer): where a held finger stands in for a right-click. */
export const touchScreen = typeof matchMedia !== "undefined" && matchMedia("(hover: none)").matches;

/**
 * A finger held on something opens its menu: a phone's right-click (phones never send one).
 * Spread the handlers onto the element; `open` gets the point the finger is resting on. The tap
 * that ends the hold doesn't also count as a tap, and a finger that moves (to scroll) lets go.
 * Things inside marked `data-no-hold` (like their own buttons) are left to themselves.
 */
export function useLongPress(open: (x: number, y: number) => void) {
  const hold = useRef<{ id: number; x: number; y: number; timer: number; fired: boolean } | null>(null);
  const openRef = useRef(open);
  openRef.current = open;
  useEffect(() => () => window.clearTimeout(hold.current?.timer), []);
  const letGo = () => {
    const h = hold.current;
    if (!h) return;
    window.clearTimeout(h.timer);
    if (!h.fired) hold.current = null;
    // once it has opened the menu, it stays a moment longer: to swallow the tap that ends it
    else window.setTimeout(() => hold.current === h && (hold.current = null), 450);
  };
  return {
    onPointerDown: (e: React.PointerEvent) => {
      if (hold.current) window.clearTimeout(hold.current.timer);
      hold.current = null;
      if (e.pointerType === "mouse" || !e.isPrimary) return;
      if ((e.target as HTMLElement).closest?.("[data-no-hold]")) return;
      const { clientX: x, clientY: y, pointerId: id } = e;
      const h = { id, x, y, fired: false, timer: 0 };
      h.timer = window.setTimeout(() => {
        if (hold.current !== h) return;
        h.fired = true;
        haptic(12);
        openRef.current(x, y + 8);
      }, HOLD_MS);
      hold.current = h;
    },
    onPointerMove: (e: React.PointerEvent) => {
      const h = hold.current;
      if (h && !h.fired && e.pointerId === h.id && Math.hypot(e.clientX - h.x, e.clientY - h.y) > 10) letGo();
    },
    onPointerUp: letGo,
    onPointerCancel: letGo,
    onClickCapture: (e: React.MouseEvent) => {
      if (hold.current?.fired) {
        e.preventDefault();
        e.stopPropagation();
        hold.current = null;
      }
    },
    // (a phone's own long-press menu, after ours has opened)
    onContextMenuCapture: (e: React.MouseEvent) => {
      if (hold.current?.fired) {
        e.preventDefault();
        e.stopPropagation();
      }
    },
  };
}
