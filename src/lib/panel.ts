import { useEffect } from "react";
import { useApp } from "../store/app";
import { useMediaQuery } from "./hooks";
import type { Settings } from "./types";

/** Whether the side panel has anything to show: your to-dos, countdowns or writing stats. */
export const hasPanel = (s: Pick<Settings, "todos" | "countdowns" | "writing">) => s.todos || s.countdowns || s.writing === true;

/**
 * The side panel (the to-dos and countdowns, on the right) and the room it needs. Below about
 * 1150px wide it would squeeze the note — the title wrapping, bullet points breaking every few
 * words — so there it tucks itself away, and its button slides it out over the note instead
 * (your own show/hide setting stays as it is, for when the window is wide again).
 */
export const PANEL_ROOM = 1150;

const roomQuery = `(min-width: ${PANEL_ROOM}px)`;
const phoneQuery = "(max-width: 820px)";

/** Whether the side panel has room beside the note (live, as the window changes). */
export const usePanelRoom = () => useMediaQuery(roomQuery);

const matches = (q: string) => typeof matchMedia !== "undefined" && matchMedia(q).matches;

/**
 * Shows or hides the side panel: on a phone it's a page of its own; in a window too narrow for
 * it, it slides out over the note (and away again); otherwise your setting.
 */
export function togglePanel() {
  const s = useApp.getState();
  if (!hasPanel(s.settings)) return;
  if (matches(phoneQuery)) s.setUI({ mobile: "rail" });
  else if (!matches(roomQuery)) s.setUI({ railPeek: !s.ui.railPeek });
  else s.setSettings({ rail: !s.settings.rail });
}

/** Brings the side panel into view, however it fits here (e.g. to add a countdown to it). */
export function showPanel() {
  const s = useApp.getState();
  s.setSettings({ rail: true });
  if (matches(phoneQuery)) s.setUI({ mobile: "rail" });
  else if (!matches(roomQuery)) s.setUI({ railPeek: true });
}

/**
 * While the side panel is slid out over the note: a tap or click anywhere else, or Escape, slides
 * it away again — and once it can't be out (the window is wide enough for it again, focus mode,
 * a phone), it's forgotten.
 */
export function usePanelPeek(peeking: boolean, wanted: boolean) {
  useEffect(() => {
    if (!peeking && wanted) useApp.getState().setUI({ railPeek: false });
  }, [peeking, wanted]);
  useEffect(() => {
    if (!peeking) return;
    const close = () => useApp.getState().setUI({ railPeek: false });
    const down = (e: PointerEvent) => {
      const t = e.target instanceof Element ? e.target : null;
      // (its own popovers and dialogs — a countdown's date, a to-do's colour — float outside it)
      if (!t || t.closest(".rail, .panel-toggle, [data-floating-layer], [role='dialog']")) return;
      close();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      // (Escape closes whatever's open over it first — a menu, a dialog, the slash menu; the caret
      // being in the note doesn't count, though the editor takes the key too)
      if (document.querySelector("[data-floating-layer] :is(.popover, .slash), [role='dialog']")) return;
      close();
    };
    document.addEventListener("pointerdown", down, true);
    window.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("pointerdown", down, true);
      window.removeEventListener("keydown", key);
    };
  }, [peeking]);
}
