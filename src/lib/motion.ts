import type { Transition } from "motion/react";

export const spring: Transition = { type: "spring", stiffness: 560, damping: 42, mass: 0.75 };
export const springSoft: Transition = { type: "spring", stiffness: 320, damping: 34, mass: 0.9 };
export const springBouncy: Transition = { type: "spring", stiffness: 600, damping: 24, mass: 0.6 };
export const ease = [0.2, 0.8, 0.2, 1] as const;
export const easeOut = [0.16, 1, 0.3, 1] as const;
export const fadeFast: Transition = { duration: 0.16, ease };

/** Shared enter/exit for floating surfaces (menus, popovers, palette). */
export const floatIn = {
  initial: { opacity: 0, scale: 0.97, y: -4, filter: "blur(4px)" },
  animate: { opacity: 1, scale: 1, y: 0, filter: "blur(0px)" },
  exit: { opacity: 0, scale: 0.98, y: -2, filter: "blur(2px)", transition: { duration: 0.12, ease } },
};
