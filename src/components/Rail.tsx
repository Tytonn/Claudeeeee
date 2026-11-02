import { useEffect, useRef, useState } from "react";
import NumberFlow from "@number-flow/react";
import { ArrowLeft, Share } from "lucide-react";
import { useApp } from "../store/app";
import { BOARD, useShareStatus } from "../store/shareSync";
import { useIsMobile, useNow } from "../lib/hooks";
import { openShare } from "../lib/actions";
import { Countdowns } from "./widgets/Countdowns";
import { Todos } from "./widgets/Todos";
import { Tooltip } from "./ui/Tooltip";
import { IconButton } from "./ui/IconButton";
import { ShareSheet } from "./overlays/ShareSheet";

/**
 * The clock with fractions of a second (Settings → Milliseconds). These change every frame, so
 * they're written straight into the page from an animation loop rather than through React —
 * and the loop rests whenever the clock is out of sight.
 */
function FineClock({ digits }: { digits: 1 | 2 | 3 }) {
  const root = useRef<HTMLSpanElement>(null);
  const hour = useRef<HTMLSpanElement>(null);
  const minute = useRef<HTMLSpanElement>(null);
  const second = useRef<HTMLSpanElement>(null);
  const frac = useRef<HTMLSpanElement>(null);
  const [period, setPeriod] = useState("");
  const [label, setLabel] = useState("");

  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const fmt = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" });
    const div = 10 ** (3 - digits);
    let raf = 0;
    let shownMinute = -1;
    let shownSecond = -1;
    let shownFrac = "";
    let visible = true;
    const tick = () => {
      raf = 0;
      if (!visible) return;
      raf = requestAnimationFrame(tick);
      const t = Date.now();
      const d = new Date(t);
      const m = Math.floor(t / 60_000);
      if (m !== shownMinute) {
        shownMinute = m;
        const parts = fmt.formatToParts(d);
        const get = (k: string) => parts.find((p) => p.type === k)?.value ?? "";
        if (hour.current) hour.current.textContent = get("hour");
        if (minute.current) minute.current.textContent = get("minute");
        setPeriod(get("dayPeriod"));
        setLabel(d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }));
      }
      const sec = d.getSeconds();
      if (sec !== shownSecond && second.current) {
        shownSecond = sec;
        second.current.textContent = String(sec).padStart(2, "0");
      }
      const f = String(Math.floor(d.getMilliseconds() / div)).padStart(digits, "0");
      if (f !== shownFrac && frac.current) {
        shownFrac = f;
        frac.current.textContent = f;
      }
    };
    const io = new IntersectionObserver(([e]) => {
      visible = e.isIntersecting;
      if (visible && !raf) tick();
    });
    io.observe(el);
    tick();
    return () => {
      io.disconnect();
      cancelAnimationFrame(raf);
      raf = 0;
    };
  }, [digits]);

  return (
    <span ref={root} className="rail-clock is-fine mono" role="timer" aria-label={label}>
      <span ref={hour} aria-hidden />
      <span className="colon" aria-hidden>
        :
      </span>
      <span ref={minute} aria-hidden />
      <span className="colon" aria-hidden>
        :
      </span>
      <span ref={second} aria-hidden />
      <span className="rail-clock-frac" aria-hidden>
        .<span ref={frac} />
      </span>
      {period && (
        <span className="rail-clock-period" aria-hidden>
          &nbsp;{period}
        </span>
      )}
    </span>
  );
}

/** A quiet clock; the seconds roll over like the countdown digits. */
function Clock() {
  const fine = useApp((s) => s.settings.clockMs === true);
  const digits = useApp((s) => s.settings.clockMsDigits);
  if (fine) return <FineClock digits={digits === 1 || digits === 2 ? digits : 3} />;
  return <CoarseClock />;
}

function CoarseClock() {
  const now = new Date(useNow(1000));
  const parts = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const period = get("dayPeriod");
  return (
    <span className="rail-clock mono" aria-label={now.toLocaleTimeString()}>
      {get("hour")}
      <span className="colon">:</span>
      {get("minute")}
      <span className="colon">:</span>
      <NumberFlow value={now.getSeconds()} format={{ minimumIntegerDigits: 2 }} digits={{ 1: { max: 5 } }} />
      {period && <span className="rail-clock-period">&nbsp;{period}</span>}
    </span>
  );
}

export function Rail() {
  const settings = useApp((s) => s.settings);
  const shareOpen = useApp((s) => s.ui.share === BOARD);
  const shared = useApp((s) => Boolean(s.shares[BOARD]));
  const status = useShareStatus((s) => s[BOARD]);
  const setUI = useApp((s) => s.setUI);
  const isMobile = useIsMobile();
  const now = useNow(60_000);
  // A stable wrapper: the button inside swaps (icon → "Live" pill) once shared,
  // and the share sheet must stay anchored through that swap.
  const shareAnchor = useRef<HTMLSpanElement>(null);
  const d = new Date(now);

  if (!settings.todos && !settings.countdowns) return <aside className="rail is-empty" aria-hidden />;

  return (
    <aside className="rail" aria-label="To-dos and countdowns">
      <div className="rail-inner">
        <header className="rail-head">
          {isMobile && (
            <IconButton label="Back" tooltip={false} onClick={() => setUI({ mobile: useApp.getState().ui.activeId ? "editor" : "list" })}>
              <ArrowLeft size={17} strokeWidth={1.7} />
            </IconButton>
          )}
          <div className="rail-date">
            <div className="rail-day display">{d.toLocaleDateString(undefined, { weekday: "long" })}</div>
            <div className="rail-full mono">
              {d.toLocaleDateString(undefined, { month: "long", day: "numeric" })}
              <span className="rail-dot" />
              <Clock />
            </div>
          </div>
          <span ref={shareAnchor} className="rail-share">
          {shared ? (
            <Tooltip label="Lists are shared — manage link">
              <button
                type="button"
                className={`pill-btn sm is-live ${shareOpen ? "is-open" : ""}`}
                onClick={() => (shareOpen ? setUI({ share: null }) : openShare(BOARD))}
              >
                <span className={`live-dot ${status === "syncing" ? "is-syncing" : ""}`} />
                <span>Live</span>
              </button>
            </Tooltip>
          ) : (
            <IconButton label="Share your lists" active={shareOpen} onClick={() => (shareOpen ? setUI({ share: null }) : openShare(BOARD))}>
              <Share size={15} strokeWidth={1.7} />
            </IconButton>
          )}
          </span>
        </header>
        {settings.countdowns && <Countdowns />}
        {settings.todos && <Todos />}
      </div>
      <ShareSheet anchor={BOARD} open={shareOpen} anchorEl={shareAnchor.current} onClose={() => setUI({ share: null })} />
    </aside>
  );
}
