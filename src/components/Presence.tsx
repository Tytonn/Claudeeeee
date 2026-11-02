import { useSyncExternalStore } from "react";
import { AnimatePresence, motion } from "motion/react";
import type { CollabSession } from "../collab/session";

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("") || "?";

/** Who else has this note open right now — a little glowing coin each, in their color. */
export function Presence({ session, max = 4, withNames = false }: { session: CollabSession; max?: number; withNames?: boolean }) {
  useSyncExternalStore(session.subscribe, () => session.version);
  const others = session.collaborators().filter((c) => !c.self);
  const label = others.length ? `${others.map((o) => o.name).join(", ")} ${others.length === 1 ? "is" : "are"} here` : "";
  return (
    <span className="presence" aria-live="polite" aria-label={label} title={label}>
      <AnimatePresence initial={false}>
        {others.slice(0, max).map((c) => (
          <motion.span
            key={c.clientId}
            className="presence-coin"
            style={{ "--c": c.color } as React.CSSProperties}
            initial={{ scale: 0.3, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.3, opacity: 0 }}
            transition={{ type: "spring", stiffness: 520, damping: 30 }}
          >
            {initials(c.name)}
          </motion.span>
        ))}
        {withNames && others.length > 0 && (
          <motion.span key="names" className="presence-names" initial={{ opacity: 0, x: -4 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }}>
            {others.length === 1 ? `${others[0].name} is here` : `${others.length} here`}
          </motion.span>
        )}
      </AnimatePresence>
    </span>
  );
}
