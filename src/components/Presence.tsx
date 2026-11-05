import { useSyncExternalStore } from "react";
import { AnimatePresence, motion } from "motion/react";
import type { CollabSession, Collaborator } from "../collab/session";
import { Avatar } from "./Avatar";
import { Tooltip } from "./ui/Tooltip";

const roleLabel = (c: Collaborator) => (c.role === "owner" ? "Owner" : c.role === "edit" ? "Can edit" : c.role === "view" ? "View only" : "");

/** Their caret in the note, if they're writing: scrolled into view, with a little flash. */
function jumpTo(c: Collaborator) {
  const caret = document.querySelector<HTMLElement>(`.collab-caret[data-cid="${c.clientId}"]`);
  if (!caret) return;
  caret.scrollIntoView({ block: "center", behavior: "smooth" });
  caret.classList.remove("is-found");
  void caret.offsetWidth;
  caret.classList.add("is-found");
}

/**
 * Who else has this note open right now — like a doc's row of faces: each person's picture (or
 * initial, or a guest's figure), in their colour. Hover for who it is; click to find their cursor.
 */
export function Presence({
  session,
  max = 4,
  size = 22,
  withNames = false,
  className = "",
}: {
  session: CollabSession;
  max?: number;
  size?: number;
  withNames?: boolean;
  className?: string;
}) {
  useSyncExternalStore(session.subscribe, () => session.version);
  const others = session.collaborators().filter((c) => !c.self);
  const shown = others.length > max ? others.slice(0, max - 1) : others;
  const extra = others.length - shown.length;
  const label = others.length ? `${others.map((o) => o.name).join(", ")} ${others.length === 1 ? "is" : "are"} here` : "";
  return (
    <span className={`presence ${className}`} aria-live="polite" aria-label={label} style={{ "--s": `${size}px` } as React.CSSProperties}>
      <AnimatePresence initial={false}>
        {shown.map((c) => (
          <motion.span
            key={c.clientId}
            className="presence-person"
            initial={{ scale: 0.3, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.3, opacity: 0 }}
            transition={{ type: "spring", stiffness: 520, damping: 30 }}
          >
            <Tooltip
              label={
                <span className="presence-tip">
                  <span>{c.name}</span>
                  {roleLabel(c) && <span className="presence-tip-role">{roleLabel(c)}</span>}
                </span>
              }
            >
              <button type="button" className="presence-btn" aria-label={`${c.name}${roleLabel(c) ? `, ${roleLabel(c)}` : ""}`} onClick={() => jumpTo(c)}>
                <Avatar name={c.name} color={c.color} picture={c.avatar} guest={c.guest} size={size} />
              </button>
            </Tooltip>
          </motion.span>
        ))}
        {extra > 0 && (
          <motion.span key="more" className="presence-more mono" title={others.slice(shown.length).map((o) => o.name).join(", ")} initial={{ scale: 0.3, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.3, opacity: 0 }}>
            +{extra}
          </motion.span>
        )}
        {withNames && others.length > 0 && (
          <motion.span key="names" className="presence-names" initial={{ opacity: 0, x: -4 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }}>
            {others.length === 1 ? `${others[0].name} is here` : `${others.length} here`}
          </motion.span>
        )}
      </AnimatePresence>
    </span>
  );
}
