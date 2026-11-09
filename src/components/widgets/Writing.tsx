import { useEffect, useRef } from "react";
import NumberFlow from "@number-flow/react";
import { Check, Flame } from "lucide-react";
import { useApp } from "../../store/app";
import { toast } from "../../store/toasts";
import { useNow } from "../../lib/hooks";
import { play } from "../../lib/sound";
import { dayKey, lastDays, streakOf, useWriting, wordsOn } from "../../lib/writing";
import { fx } from "../../fx/engine";
import { Tooltip } from "../ui/Tooltip";

/** The daily goal, as a sensible number (whatever's been saved). */
export function goalOf(goal: unknown): number {
  return typeof goal === "number" && Number.isFinite(goal) && goal >= 50 ? Math.min(100_000, Math.round(goal)) : 250;
}

const R = 23;
const LEN = 2 * Math.PI * R;

/**
 * Writing, in the side panel: the words you've written today, filling a ring toward your daily
 * goal; your streak (days in a row you've written); and the last week, a bar a day.
 */
export function Writing() {
  const goal = useApp((s) => goalOf(s.settings.writingGoal));
  const stats = useWriting();
  // (a new day starts at midnight, wherever you've left it open)
  const now = useNow(60_000);
  const today = dayKey(new Date(now));
  const words = wordsOn(stats, today);
  const streak = streakOf(stats, new Date(now));
  const week = lastDays(stats, 7, new Date(now));
  const done = words >= goal;
  const part = Math.min(1, words / goal);
  const ring = useRef<SVGSVGElement>(null);

  return (
    <section className="widget writing" aria-label="Writing">
      <header className="widget-head">
        <span className="label">Writing</span>
        <span className="flex" />
        {streak > 0 && (
          <Tooltip label={streak === 1 ? "You've written today — come back tomorrow to start a streak" : `${streak} days in a row you've written`}>
            <span className={`writing-streak ${words > 0 ? "is-today" : ""}`}>
              <Flame size={12} strokeWidth={2} />
              <span>
                <span className="tabular">{streak}</span>-day streak
              </span>
            </span>
          </Tooltip>
        )}
      </header>

      <div className={`writing-today ${done ? "is-done" : ""}`}>
        <span className="writing-ring-wrap">
          <svg ref={ring} className="writing-ring" viewBox="0 0 56 56" aria-hidden>
            <circle className="writing-ring-track" cx="28" cy="28" r={R} />
            <circle
              className="writing-ring-fill"
              cx="28"
              cy="28"
              r={R}
              strokeDasharray={LEN}
              strokeDashoffset={LEN * (1 - part)}
              transform="rotate(-90 28 28)"
              style={{ opacity: part > 0 ? 1 : 0 }}
            />
          </svg>
          <span className="writing-ring-mid" aria-hidden>
            {done ? <Check size={17} strokeWidth={2.4} /> : <span className="tabular">{Math.floor(part * 100)}%</span>}
          </span>
        </span>
        <div className="writing-words">
          <div className="writing-count display">
            <NumberFlow value={words} />
          </div>
          <div className="writing-sub">
            {done ? <>word{words === 1 ? "" : "s"} today · goal reached</> : <>of {goal.toLocaleString()} words today</>}
          </div>
        </div>
      </div>

      <div className="writing-week" role="list" aria-label="The last seven days">
        {week.map((d) => {
          const isToday = d.key === today;
          const h = d.words > 0 ? Math.max(0.12, Math.min(1, d.words / goal)) : 0;
          const label = `${d.date.toLocaleDateString(undefined, { weekday: "long" })} · ${d.words.toLocaleString()} word${d.words === 1 ? "" : "s"}`;
          return (
            <Tooltip key={d.key} label={isToday ? `Today · ${d.words.toLocaleString()} word${d.words === 1 ? "" : "s"}` : label}>
              <span role="listitem" aria-label={label} className={`writing-day ${isToday ? "is-today" : ""} ${d.words >= goal ? "is-goal" : ""}`}>
                <span className="writing-bar">
                  <span className="writing-bar-fill" style={{ height: `${h * 100}%` }} />
                </span>
                <span className="writing-day-name">{d.date.toLocaleDateString(undefined, { weekday: "narrow" })}</span>
              </span>
            </Tooltip>
          );
        })}
      </div>
    </section>
  );
}

/**
 * The moment today's goal is reached (while you're here, writing): a word to say so, a chime,
 * and — if the ring's in view — a burst of light from it. Once a day.
 */
export function useGoalCelebration() {
  const enabled = useApp((s) => s.settings.writing === true);
  useEffect(() => {
    if (!enabled) return;
    return useWriting.subscribe((s, prev) => {
      const today = dayKey();
      const goal = goalOf(useApp.getState().settings.writingGoal);
      const before = wordsOn(prev, today);
      const after = wordsOn(s, today);
      if (before >= goal || after < goal) return;
      try {
        if (localStorage.getItem(`umbra:goal:${today}`)) return;
        localStorage.setItem(`umbra:goal:${today}`, "1");
      } catch {
        /* never mind */
      }
      play("chime");
      const ring = document.querySelector(".rail .writing-ring")?.getBoundingClientRect();
      if (ring && ring.width > 0 && fx.active) fx.sunburst(ring.left + ring.width / 2, ring.top + ring.height / 2);
      const streak = streakOf(s);
      toast(`Today's goal: ${goal.toLocaleString()} words — done${streak > 1 ? ` · ${streak}-day streak` : ""}`, { tone: "success" });
    });
  }, [enabled]);
}
