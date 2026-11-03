import { createContext, useContext, useId, type ReactNode } from "react";
import { motion } from "motion/react";
import { spring } from "../../lib/motion";

type Option<T extends string> = { value: T; label: ReactNode; title?: string };

type Props<T extends string> = {
  value: T;
  options: Option<T>[];
  onChange: (value: T) => void;
  label: string;
  size?: "sm" | "md";
};

/**
 * Changing this gives the selection pill a new identity (a fresh element, not just a new name),
 * so it simply appears in place rather than sliding over — for when the rows around it move
 * (like switching scenes in Settings).
 */
export const SegmentedEpoch = createContext("");

export function Segmented<T extends string>({ value, options, onChange, label, size = "md" }: Props<T>) {
  const id = useId();
  const epoch = useContext(SegmentedEpoch);
  return (
    <div className={`segmented ${size}`} role="radiogroup" aria-label={label}>
      {options.map((o) => {
        const selected = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={selected}
            title={o.title}
            className={`segmented-item ${selected ? "is-selected" : ""}`}
            onClick={() => onChange(o.value)}
          >
            {selected && <motion.span key={epoch} layoutId={`seg-${id}-${epoch}`} className="segmented-pill" transition={spring} />}
            <span className="segmented-label">{o.label}</span>
          </button>
        );
      })}
    </div>
  );
}
