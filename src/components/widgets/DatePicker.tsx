import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ChevronLeft, ChevronRight, Clock, X } from "lucide-react";
import { dayDiff, fromISODate, toISODate } from "../../lib/dates";

type Props = {
  value: string | null;
  time: string | null;
  onChange: (iso: string) => void;
  onTimeChange: (time: string | null) => void;
};

const firstOfMonth = (d: Date) => new Date(d.getFullYear(), d.getMonth(), 1);
const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);

function monthGrid(view: Date): Date[] {
  const start = addDays(view, -view.getDay());
  return Array.from({ length: 42 }, (_, i) => addDays(start, i));
}

export function DatePicker({ value, time, onChange, onTimeChange }: Props) {
  const selected = value ? fromISODate(value) : null;
  const [view, setView] = useState(() => firstOfMonth(selected ?? new Date()));
  const [dir, setDir] = useState(0);
  const [cursor, setCursor] = useState<Date>(() => selected ?? new Date());
  const [showTime, setShowTime] = useState(Boolean(time));
  const grid = useRef<HTMLDivElement>(null);
  const today = new Date();
  const days = useMemo(() => monthGrid(view), [view]);
  const weekdays = useMemo(() => {
    const base = new Date(2023, 0, 1); // a Sunday
    return Array.from({ length: 7 }, (_, i) => addDays(base, i).toLocaleDateString(undefined, { weekday: "narrow" }));
  }, []);

  useEffect(() => {
    if (value) {
      const d = fromISODate(value);
      setCursor(d);
      if (d.getMonth() !== view.getMonth() || d.getFullYear() !== view.getFullYear()) {
        setDir(d > view ? 1 : -1);
        setView(firstOfMonth(d));
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const go = (delta: number) => {
    setDir(delta);
    setView((v) => new Date(v.getFullYear(), v.getMonth() + delta, 1));
  };

  const moveCursor = (next: Date) => {
    setCursor(next);
    if (next.getMonth() !== view.getMonth() || next.getFullYear() !== view.getFullYear()) {
      setDir(next > view ? 1 : -1);
      setView(firstOfMonth(next));
    }
    requestAnimationFrame(() => grid.current?.querySelector<HTMLButtonElement>(`[data-date="${toISODate(next)}"]`)?.focus());
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    const map: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
    if (e.key in map) {
      e.preventDefault();
      moveCursor(addDays(cursor, map[e.key]));
    } else if (e.key === "PageUp" || e.key === "PageDown") {
      e.preventDefault();
      const d = e.key === "PageUp" ? -1 : 1;
      moveCursor(new Date(cursor.getFullYear(), cursor.getMonth() + d, Math.min(cursor.getDate(), 28)));
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onChange(toISODate(cursor));
    }
  };

  const title = view.toLocaleDateString(undefined, { month: "long", year: "numeric" });
  const variants = {
    enter: (d: number) => ({ x: d * 28, opacity: 0, filter: "blur(2px)" }),
    center: { x: 0, opacity: 1, filter: "blur(0px)" },
    exit: (d: number) => ({ x: d * -28, opacity: 0, filter: "blur(2px)" }),
  };

  return (
    <div className="dp">
      <div className="dp-head">
        <button type="button" className="dp-nav" aria-label="Previous month" onClick={() => go(-1)}>
          <ChevronLeft size={15} strokeWidth={1.8} />
        </button>
        <div className="dp-title-wrap">
          <AnimatePresence mode="popLayout" custom={dir} initial={false}>
            <motion.div key={title} className="dp-title" custom={dir} variants={variants} initial="enter" animate="center" exit="exit" transition={{ duration: 0.22, ease: [0.2, 0.8, 0.2, 1] }}>
              {title}
            </motion.div>
          </AnimatePresence>
        </div>
        <button type="button" className="dp-nav" aria-label="Next month" onClick={() => go(1)}>
          <ChevronRight size={15} strokeWidth={1.8} />
        </button>
      </div>
      <div className="dp-week" aria-hidden>
        {weekdays.map((w, i) => (
          <span key={i}>{w}</span>
        ))}
      </div>
      <div className="dp-grid-wrap" onKeyDown={onKeyDown}>
        <AnimatePresence mode="popLayout" custom={dir} initial={false}>
          <motion.div
            key={view.toISOString()}
            ref={grid}
            className="dp-grid"
            role="grid"
            custom={dir}
            variants={variants}
            initial="enter"
            animate="center"
            exit="exit"
            transition={{ duration: 0.24, ease: [0.2, 0.8, 0.2, 1] }}
          >
            {days.map((d) => {
              const iso = toISODate(d);
              const outside = d.getMonth() !== view.getMonth();
              const isToday = dayDiff(d, today) === 0;
              const isSel = selected ? dayDiff(d, selected) === 0 : false;
              const isPast = dayDiff(today, d) < 0;
              const isCursor = dayDiff(d, cursor) === 0;
              return (
                <button
                  key={iso}
                  type="button"
                  data-date={iso}
                  tabIndex={isCursor ? 0 : -1}
                  className={`dp-day ${outside ? "is-outside" : ""} ${isToday ? "is-today" : ""} ${isSel ? "is-selected" : ""} ${isPast ? "is-past" : ""}`}
                  aria-pressed={isSel}
                  aria-label={d.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric" })}
                  onClick={() => {
                    setCursor(d);
                    onChange(iso);
                  }}
                >
                  {isSel && <motion.span layoutId="dp-sel" className="dp-sel" transition={{ type: "spring", stiffness: 600, damping: 40 }} />}
                  <span className="dp-num">{d.getDate()}</span>
                </button>
              );
            })}
          </motion.div>
        </AnimatePresence>
      </div>
      <div className="dp-foot">
        <button
          type="button"
          className="ghost-btn sm"
          onClick={() => {
            const t = new Date();
            setDir(t > view ? 1 : -1);
            setView(firstOfMonth(t));
            setCursor(t);
          }}
        >
          Today
        </button>
        {showTime ? (
          <span className="dp-time">
            <Clock size={13} strokeWidth={1.8} />
            <input type="time" value={time ?? ""} onChange={(e) => onTimeChange(e.target.value || null)} aria-label="Time" />
            <button
              type="button"
              className="dp-time-clear"
              aria-label="Remove time"
              onClick={() => {
                onTimeChange(null);
                setShowTime(false);
              }}
            >
              <X size={12} strokeWidth={2} />
            </button>
          </span>
        ) : (
          <button
            type="button"
            className="ghost-btn sm"
            onClick={() => {
              setShowTime(true);
              if (!time) onTimeChange("09:00");
            }}
          >
            <Clock size={13} strokeWidth={1.8} /> Add time
          </button>
        )}
      </div>
    </div>
  );
}
