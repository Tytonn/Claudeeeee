import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "motion/react";
import { Check, CircleAlert } from "lucide-react";
import { useToasts, type Toast } from "../../store/toasts";
import { spring } from "../../lib/motion";

function ToastItem({ t }: { t: Toast }) {
  const dismiss = useToasts((s) => s.dismiss);
  const timer = useRef<number | undefined>(undefined);
  const duration = t.duration ?? (t.action ? 6000 : 2600);

  const arm = () => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => dismiss(t.id), duration);
  };

  useEffect(() => {
    arm();
    return () => window.clearTimeout(timer.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t.id]);

  return (
    <motion.div
      layout
      className={`toast ${t.tone ?? "default"}`}
      role="status"
      initial={{ opacity: 0, y: 16, scale: 0.96, filter: "blur(6px)" }}
      animate={{ opacity: 1, y: 0, scale: 1, filter: "blur(0px)" }}
      exit={{ opacity: 0, y: 8, scale: 0.97, filter: "blur(4px)", transition: { duration: 0.16 } }}
      transition={spring}
      onPointerEnter={() => window.clearTimeout(timer.current)}
      onPointerLeave={arm}
    >
      {t.tone === "success" && <Check size={14} strokeWidth={2.2} className="toast-icon ok" />}
      {t.tone === "error" && <CircleAlert size={14} strokeWidth={2} className="toast-icon err" />}
      <span className="toast-msg">{t.message}</span>
      {t.action && (
        <button
          type="button"
          className="toast-action"
          onClick={() => {
            t.action!.run();
            dismiss(t.id);
          }}
        >
          {t.action.label}
        </button>
      )}
    </motion.div>
  );
}

export function Toasts() {
  const toasts = useToasts((s) => s.toasts);
  return createPortal(
    <div className="toasts" aria-live="polite">
      <AnimatePresence initial={false}>
        {toasts.map((t) => (
          <ToastItem key={t.id} t={t} />
        ))}
      </AnimatePresence>
    </div>,
    document.body,
  );
}
