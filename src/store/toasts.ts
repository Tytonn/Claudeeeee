import { create } from "zustand";
import { uid } from "../lib/id";

export type Toast = {
  id: string;
  message: string;
  tone?: "default" | "success" | "error";
  action?: { label: string; run: () => void };
  duration?: number;
};

type ToastState = {
  toasts: Toast[];
  push(t: Omit<Toast, "id">): string;
  dismiss(id: string): void;
};

export const useToasts = create<ToastState>((set) => ({
  toasts: [],
  push(t) {
    const id = uid(8);
    set((s) => ({ toasts: [...s.toasts.slice(-2), { ...t, id }] }));
    return id;
  },
  dismiss(id) {
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
  },
}));

export function toast(message: string, opts: Omit<Toast, "id" | "message"> = {}) {
  return useToasts.getState().push({ message, ...opts });
}
