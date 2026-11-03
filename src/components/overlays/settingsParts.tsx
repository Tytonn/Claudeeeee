import type { ReactNode } from "react";

/* Settings' building blocks — shared with each scene's own rows (scenes/<id>/ui.tsx). */

export function Row({ label, desc, children, htmlFor }: { label: string; desc?: ReactNode; children: ReactNode; htmlFor?: string }) {
  return (
    <div className="set-row">
      <div className="set-row-text">
        <label className="set-row-label" htmlFor={htmlFor}>
          {label}
        </label>
        {desc && <div className="set-row-desc">{desc}</div>}
      </div>
      <div className="set-row-control">{children}</div>
    </div>
  );
}

export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="set-section">
      <h3 className="label">{title}</h3>
      <div className="set-card">{children}</div>
    </section>
  );
}

/**
 * A 0..1 slider that always slides. If any text on the page happens to be selected (a stray
 * double-click is enough), pressing on a slider and moving picks that text up and drags it
 * instead — the thumb stays put and the cursor turns into a "can't drop here". So: let go of
 * any selection the moment it's pressed, and never let it start a drag.
 */
export function Slider({ value, label, onChange }: { value: number; label: string; onChange: (v: number) => void }) {
  return (
    <input
      type="range"
      className="range wide"
      min={0}
      max={1}
      step={0.01}
      value={value}
      aria-label={label}
      style={{ "--v": `${value * 100}%` } as React.CSSProperties}
      onPointerDown={() => {
        const sel = window.getSelection();
        if (sel && sel.type === "Range") sel.removeAllRanges();
      }}
      onDragStart={(e) => e.preventDefault()}
      onChange={(e) => onChange(Number(e.target.value))}
    />
  );
}
