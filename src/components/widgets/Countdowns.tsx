import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion, useAnimationControls } from "motion/react";
import NumberFlow from "@number-flow/react";
import { CalendarDays, Plus, Repeat, Trash2 } from "lucide-react";
import { useApp } from "../../store/app";
import { toast } from "../../store/toasts";
import type { Countdown } from "../../lib/types";
import { countdownPhrase, describeCountdown, formatDate, formatTime, ordinal, pad, splitDuration, toISODate, type CountdownState } from "../../lib/dates";
import { useNow } from "../../lib/hooks";
import { play } from "../../lib/sound";
import { NEW_COUNTDOWN_EVENT } from "../../lib/actions";
import { ease, spring } from "../../lib/motion";
import { Eclipse } from "../ui/Eclipse";
import { IconButton } from "../ui/IconButton";
import { Popover } from "../ui/Popover";
import { DatePicker } from "./DatePicker";

type ChronoModule = typeof import("chrono-node/en");
let chronoPromise: Promise<ChronoModule> | null = null;
const loadChrono = () => (chronoPromise ??= import("chrono-node/en"));

const YEARLY_HINT = /\b(birthday|bday|b-day|anniversary|anniv)\b/i;

export type CountdownDraft = Pick<Countdown, "title" | "date" | "time" | "repeat">;

type FormProps = {
  initial?: Countdown;
  onSubmit: (draft: CountdownDraft) => void;
  onCancel: () => void;
  onDelete?: () => void;
};

export function CountdownForm({ initial, onSubmit, onCancel, onDelete }: FormProps) {
  const [title, setTitle] = useState(initial?.title ?? "");
  const [date, setDate] = useState<string | null>(initial?.date ?? null);
  const [time, setTime] = useState<string | null>(initial?.time ?? null);
  const [repeat, setRepeat] = useState(initial?.repeat === "yearly");
  const [repeatTouched, setRepeatTouched] = useState(Boolean(initial));
  const [parsed, setParsed] = useState<{ text: string; date: string; time: string | null } | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const chip = useRef<HTMLButtonElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const shake = useAnimationControls();

  // Natural-language dates: "Tokyo trip dec 20", "mom's birthday march 3", "launch in 3 weeks at 9am".
  useEffect(() => {
    if (initial || date) return;
    let cancelled = false;
    const t = window.setTimeout(async () => {
      if (!title.trim()) {
        setParsed(null);
        return;
      }
      try {
        const chrono = await loadChrono();
        const results = chrono.casual.parse(title, new Date(), { forwardDate: true });
        const hit = results[results.length - 1];
        if (cancelled) return;
        if (hit) {
          const d = hit.start.date();
          setParsed({
            text: hit.text,
            date: toISODate(d),
            time: hit.start.isCertain("hour") ? `${pad(d.getHours())}:${pad(d.getMinutes())}` : null,
          });
        } else setParsed(null);
      } catch {
        setParsed(null);
      }
    }, 90);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
  }, [title, date, initial]);

  useEffect(() => {
    if (!repeatTouched) setRepeat(YEARLY_HINT.test(title));
  }, [title, repeatTouched]);

  useEffect(() => {
    requestAnimationFrame(() => input.current?.focus());
  }, []);

  const effDate = date ?? parsed?.date ?? null;
  const effTime = date ? time : (parsed?.time ?? time);

  const cleanTitle = () => {
    let t = title;
    if (!date && parsed) t = t.replace(parsed.text, " ");
    t = t
      .replace(/\s+(on|in|at|by|until|till|for|this|next|from)\s*$/i, "")
      .replace(/\s{2,}/g, " ")
      .replace(/[\s,–—-]+$/g, "")
      .trim();
    return t || title.trim();
  };

  const preview = effDate ? describeCountdown({ date: effDate, time: effTime, repeat: repeat ? "yearly" : null, createdAt: Date.now() }) : null;

  const submit = () => {
    const name = cleanTitle();
    if (!name || !effDate) {
      void shake.start({ x: [0, -7, 6, -4, 3, 0], transition: { duration: 0.36 } });
      if (!effDate) setPickerOpen(true);
      return;
    }
    onSubmit({ title: name, date: effDate, time: effTime ?? null, repeat: repeat ? "yearly" : null });
  };

  return (
    <motion.form
      className="cd-form"
      animate={shake}
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape" && !pickerOpen) {
          e.preventDefault();
          e.stopPropagation();
          onCancel();
        }
      }}
    >
      <input
        ref={input}
        className="cd-form-title"
        value={title}
        maxLength={80}
        placeholder={initial ? "Name" : "Tokyo trip on Dec 20…"}
        aria-label="What are you counting down to?"
        onChange={(e) => setTitle(e.target.value)}
      />
      <div className="cd-form-row">
        <button
          ref={chip}
          type="button"
          className={`cd-chip ${effDate ? "has-date" : ""} ${!date && parsed ? "is-parsed" : ""}`}
          onClick={() => setPickerOpen((v) => !v)}
        >
          <CalendarDays size={13} strokeWidth={1.8} />
          {effDate ? (
            <span>
              {formatDate(preview!.target, { year: "auto" })}
              {effTime && <> · {formatTime(preview!.target)}</>}
              <span className="cd-chip-dim"> · {countdownPhrase(preview!).toLowerCase()}</span>
            </span>
          ) : (
            <span>Pick a date</span>
          )}
        </button>
        <button
          type="button"
          className={`cd-repeat ${repeat ? "is-on" : ""}`}
          aria-pressed={repeat}
          title="Repeats every year — great for birthdays"
          onClick={() => {
            setRepeatTouched(true);
            setRepeat((v) => !v);
          }}
        >
          <Repeat size={12} strokeWidth={2} /> Yearly
        </button>
      </div>
      <div className="cd-form-actions">
        {onDelete && (
          <button type="button" className="ghost-btn sm danger" onClick={onDelete}>
            <Trash2 size={13} strokeWidth={1.8} /> Delete
          </button>
        )}
        <span className="flex" />
        <button type="button" className="ghost-btn sm" onClick={onCancel}>
          Cancel
        </button>
        <button type="submit" className="primary-btn sm">
          {initial ? "Save" : "Add"}
        </button>
      </div>

      <Popover
        open={pickerOpen}
        onClose={() => {
          setPickerOpen(false);
          requestAnimationFrame(() => input.current?.focus());
        }}
        anchor={chip.current}
        placement="bottom-start"
        className="dp-pop"
        label="Pick a date"
      >
        <DatePicker
          value={effDate}
          time={effTime ?? null}
          onChange={(iso) => {
            setDate(iso);
            if (!date && parsed?.time) setTime(parsed.time);
            setPickerOpen(false);
            requestAnimationFrame(() => input.current?.focus());
          }}
          onTimeChange={(t) => {
            if (!date && effDate) setDate(effDate);
            setTime(t);
          }}
        />
      </Popover>
    </motion.form>
  );
}

function unitFor(st: CountdownState): string {
  if (st.phase === "past") return Math.abs(st.days) === 1 ? "day ago" : "days ago";
  return st.days === 1 ? "day" : "days";
}

function CountdownCard({ c, st, onEdit }: { c: Countdown; st: CountdownState; onEdit: (id: string, el: HTMLElement) => void }) {
  const live = st.hasTime && st.ms > 0 && st.ms < 86_400_000;
  const { h, m, s } = splitDuration(st.ms);
  const sub = [formatDate(st.target), c.time ? formatTime(st.target) : null, c.repeat === "yearly" && st.nth ? ordinal(st.nth) : null].filter(Boolean).join(" · ");

  return (
    <motion.li
      layout="position"
      className={`cd is-${st.phase} ${live ? "is-live" : ""}`}
      initial={{ opacity: 0, y: -8, scale: 0.98, filter: "blur(4px)" }}
      animate={{ opacity: 1, y: 0, scale: 1, filter: "blur(0px)" }}
      exit={{ opacity: 0, scale: 0.97, filter: "blur(4px)", transition: { duration: 0.18, ease } }}
      transition={spring}
    >
      <button
        type="button"
        className="cd-card"
        onClick={(e) => onEdit(c.id, e.currentTarget)}
        onPointerMove={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          e.currentTarget.style.setProperty("--mx", `${e.clientX - r.left}px`);
          e.currentTarget.style.setProperty("--my", `${e.clientY - r.top}px`);
        }}
        aria-label={`${c.title}, ${countdownPhrase(st)}`}
      >
        <Eclipse progress={st.progress} size={30} className="cd-eclipse" />
        <span className="cd-text">
          <span className="cd-title">
            {c.title}
            {c.repeat === "yearly" && <Repeat size={10} strokeWidth={2.2} className="cd-yearly" aria-label="Yearly" />}
          </span>
          <span className="cd-date mono">{sub}</span>
        </span>
        <span className="cd-value">
          {st.phase === "today" && !live ? (
            <span className="cd-today display">Today</span>
          ) : live ? (
            <span className="cd-live mono tabular">
              {h > 0 && (
                <>
                  <NumberFlow value={h} />
                  <i>h</i>
                </>
              )}
              <NumberFlow value={m} digits={{ 1: { max: 5 } }} format={{ minimumIntegerDigits: h > 0 ? 2 : 1 }} />
              <i>m</i>
              {h === 0 && (
                <>
                  <NumberFlow value={s} digits={{ 1: { max: 5 } }} format={{ minimumIntegerDigits: 2 }} />
                  <i>s</i>
                </>
              )}
            </span>
          ) : (
            <>
              <NumberFlow className="cd-num display" value={Math.abs(st.days)} />
              <span className="cd-unit mono">{unitFor(st)}</span>
            </>
          )}
        </span>
        <span className="cd-progress" aria-hidden>
          <span style={{ transform: `scaleX(${st.progress})` }} />
        </span>
      </button>
    </motion.li>
  );
}

const order = (a: CountdownState, b: CountdownState) => {
  const rank = (s: CountdownState) => (s.phase === "today" ? 0 : s.phase === "future" ? 1 : 2);
  return rank(a) - rank(b) || (a.phase === "past" ? b.ms - a.ms : a.ms - b.ms);
};

export function Countdowns() {
  const countdowns = useApp((s) => s.countdowns);
  const addCountdown = useApp((s) => s.addCountdown);
  const updateCountdown = useApp((s) => s.updateCountdown);
  const needsSeconds = countdowns.some((c) => {
    const st = describeCountdown(c);
    return st.hasTime && st.ms > 0 && st.ms < 86_400_000;
  });
  const now = useNow(needsSeconds ? 1000 : 30_000);
  const items = useMemo(
    () =>
      countdowns
        .map((c) => ({ c, st: describeCountdown(c, new Date(now)) }))
        .sort((a, b) => order(a.st, b.st)),
    [countdowns, now],
  );
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<{ id: string; el: HTMLElement } | null>(null);
  const editItem = editing ? countdowns.find((c) => c.id === editing.id) : undefined;

  useEffect(() => {
    const open = () => setAdding(true);
    window.addEventListener(NEW_COUNTDOWN_EVENT, open);
    return () => window.removeEventListener(NEW_COUNTDOWN_EVENT, open);
  }, []);

  const remove = (id: string) => {
    const removed = useApp.getState().removeCountdown(id);
    setEditing(null);
    if (!removed) return;
    play("drop");
    toast(`Removed “${removed.item.title}”`, {
      action: { label: "Undo", run: () => useApp.getState().restoreCountdown(removed.item, removed.index) },
    });
  };

  return (
    <section className="widget countdowns" aria-label="Countdowns">
      <header className="widget-head">
        <span className="label">Countdowns</span>
        <span className="flex" />
        <IconButton size="sm" label="New countdown" onClick={() => setAdding((v) => !v)} active={adding}>
          <Plus size={15} strokeWidth={1.8} className={`plus ${adding ? "is-x" : ""}`} />
        </IconButton>
      </header>

      <AnimatePresence initial={false}>
        {adding && (
          <motion.div
            key="form"
            className="cd-form-wrap"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.3, ease }}
          >
            <CountdownForm
              onCancel={() => setAdding(false)}
              onSubmit={(d) => {
                addCountdown(d);
                setAdding(false);
                play("pop");
              }}
            />
          </motion.div>
        )}
      </AnimatePresence>

      <ul className="cd-list">
        <AnimatePresence initial={false} mode="popLayout">
          {items.map(({ c, st }) => (
            <CountdownCard key={c.id} c={c} st={st} onEdit={(id, el) => setEditing({ id, el })} />
          ))}
        </AnimatePresence>
      </ul>

      {!items.length && !adding && (
        <button type="button" className="widget-empty cd-empty" onClick={() => setAdding(true)}>
          <Eclipse progress={0.35} size={22} />
          <span>Count down to a trip, a birthday, anything.</span>
        </button>
      )}

      <Popover open={!!editItem} onClose={() => setEditing(null)} anchor={editing?.el ?? null} placement="left-start" className="cd-edit-pop" label="Edit countdown">
        {editItem && (
          <CountdownForm
            key={editItem.id}
            initial={editItem}
            onCancel={() => setEditing(null)}
            onDelete={() => remove(editItem.id)}
            onSubmit={(d) => {
              updateCountdown(editItem.id, d);
              setEditing(null);
            }}
          />
        )}
      </Popover>
    </section>
  );
}
