import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";

type Option<T extends string> = { value: T; label: ReactNode; title?: string };

type Props<T extends string> = {
  value: T;
  options: Option<T>[];
  onChange: (value: T) => void;
  label: string;
  size?: "sm" | "md";
};

/**
 * Changing this makes the selection pill simply appear in place rather than slide over — for
 * when the rows around it change (like switching scenes in Settings).
 */
export const SegmentedEpoch = createContext("");

type Pill = { x: number; w: number; glide: boolean };

/**
 * A row of choices, with a pill behind the chosen one that glides to the next. The pill is placed
 * within the row itself, not on the page: so when the row moves — in a popover that follows the
 * title as it grows, in a list that changes above it — the pill moves with it, and never chases
 * its old place.
 */
export function Segmented<T extends string>({ value, options, onChange, label, size = "md" }: Props<T>) {
  const epoch = useContext(SegmentedEpoch);
  const box = useRef<HTMLDivElement>(null);
  const [pill, setPill] = useState<Pill | null>(null);
  const pillRef = useRef(pill);
  pillRef.current = pill;
  const seenEpoch = useRef(epoch);

  /** Where the chosen choice sits in the row (in the row's own units, to the fraction of a pixel —
   *  even while something around it is being scaled, like a dialog opening). */
  const measure = useCallback(() => {
    const el = box.current;
    const btn = el?.querySelector<HTMLElement>(".segmented-item.is-selected");
    if (!el || !btn) return null;
    const a = el.getBoundingClientRect();
    const b = btn.getBoundingClientRect();
    const k = el.offsetWidth ? a.width / el.offsetWidth : 1;
    return { x: (b.left - a.left) / k - el.clientLeft, w: b.width / k };
  }, []);

  // A new choice: glide there (not the first time it's shown, nor when everything around changed).
  useLayoutEffect(() => {
    const at = measure();
    const fresh = seenEpoch.current !== epoch;
    seenEpoch.current = epoch;
    setPill(at && { ...at, glide: pillRef.current !== null && !fresh });
  }, [value, epoch, measure]);

  // The choices changing size (a font arriving, a label changing): keep up, without gliding.
  useEffect(() => {
    const el = box.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => {
      const at = measure();
      const cur = pillRef.current;
      if (at && (!cur || Math.abs(cur.x - at.x) > 0.5 || Math.abs(cur.w - at.w) > 0.5)) setPill({ ...at, glide: false });
    });
    ro.observe(el);
    el.querySelectorAll(".segmented-item").forEach((b) => ro.observe(b));
    return () => ro.disconnect();
  }, [measure, options.length]);

  return (
    <div className={`segmented ${size}`} role="radiogroup" aria-label={label} ref={box}>
      {pill && (
        <span
          className="segmented-pill"
          aria-hidden
          style={{ width: pill.w, transform: `translateX(${pill.x}px)`, transition: pill.glide ? undefined : "none" }}
        />
      )}
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
            <span className="segmented-label">{o.label}</span>
          </button>
        );
      })}
    </div>
  );
}
