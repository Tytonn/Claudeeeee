import { useMemo, useState, type CSSProperties } from "react";
import { motion } from "motion/react";
import { easeOut } from "../../lib/motion";
import { fx } from "../../fx/engine";

function Burst({ count = 9 }: { count?: number }) {
  const parts = useMemo(
    () =>
      Array.from({ length: count }, (_, i) => {
        const angle = (i / count) * Math.PI * 2 + (Math.random() - 0.5) * 0.6;
        const dist = 13 + Math.random() * 9;
        return {
          x: Math.cos(angle) * dist,
          y: Math.sin(angle) * dist,
          size: 2 + Math.random() * 2.2,
          delay: Math.random() * 0.05,
        };
      }),
    [count],
  );
  return (
    <span className="burst" aria-hidden>
      <span className="burst-ring" />
      {parts.map((p, i) => (
        <span
          key={i}
          className="burst-dot"
          style={{ "--x": `${p.x}px`, "--y": `${p.y}px`, "--s": `${p.size}px`, animationDelay: `${p.delay}s` } as CSSProperties}
        />
      ))}
    </span>
  );
}

type Props = {
  checked: boolean;
  onToggle: () => void;
  label?: string;
  size?: number;
};

export function Checkbox({ checked, onToggle, label, size = 18 }: Props) {
  const [burst, setBurst] = useState(0);
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={label ? `Complete “${label}”` : "Complete"}
      className={`check ${checked ? "is-checked" : ""}`}
      style={{ width: size, height: size }}
      onClick={(e) => {
        e.stopPropagation();
        if (!checked) {
          if (fx.active) {
            const r = e.currentTarget.getBoundingClientRect();
            fx.sunburst(r.left + r.width / 2, r.top + r.height / 2);
          } else setBurst((b) => b + 1);
        }
        onToggle();
      }}
    >
      <motion.span
        className="check-fill"
        initial={false}
        animate={{ scale: checked ? 1 : 0.4, opacity: checked ? 1 : 0 }}
        transition={checked ? { type: "spring", stiffness: 700, damping: 22, mass: 0.6 } : { duration: 0.14 }}
      />
      <svg viewBox="0 0 16 16" className="check-mark" aria-hidden>
        <motion.path
          d="M4.4 8.6 7 11.1 11.8 5.5"
          initial={false}
          animate={{ pathLength: checked ? 1 : 0, opacity: checked ? 1 : 0 }}
          transition={{ duration: checked ? 0.26 : 0.1, delay: checked ? 0.07 : 0, ease: easeOut }}
        />
      </svg>
      {burst > 0 && <Burst key={burst} />}
    </button>
  );
}
