import { useEffect, useRef, useState } from "react";
import { Eclipse } from "../components/ui/Eclipse";
import { fx } from "./engine";

const KEY = "umbra:intro";

/** Plays once per browser session, only with full effects on. */
export function shouldPlayIntro(): boolean {
  try {
    if (!fx.full || sessionStorage.getItem(KEY)) return false;
    sessionStorage.setItem(KEY, "1");
    return true;
  } catch {
    return false;
  }
}

const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

/**
 * A total eclipse, in about two and a half seconds: the sun rises out of the dark,
 * the moon slides across, the corona bursts out at totality, a diamond ring flashes —
 * and the light spills outward to become the app.
 *
 * In the rain it's a window instead: the dark lifts onto rain-streaked glass, the name is
 * written into the fog with a fingertip, a few drips run off it — and lightning, as it clears.
 */
export function Intro({ onDone }: { onDone: () => void }) {
  const [rain] = useState(() => fx.rain);
  const [progress, setProgress] = useState(0);
  const [stage, setStage] = useState<"rise" | "total" | "out">("rise");
  const done = useRef(false);
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;

  useEffect(() => {
    document.documentElement.classList.add("intro-on");
    let raf = 0;
    const t0 = performance.now();
    // Dev only: slow the whole thing down to look at it (pair with a slowed CSS animation rate).
    const rate = import.meta.env.DEV ? ((window as { __introRate?: number }).__introRate ?? 1) : 1;
    const finish = () => {
      if (done.current) return;
      done.current = true;
      setStage("out");
      document.documentElement.classList.remove("intro-on");
      if (rain) {
        window.setTimeout(() => fx.diamondRing(), 140 / rate);
        window.setTimeout(() => onDoneRef.current(), 900 / rate);
        return;
      }
      fx.flareUp(1);
      window.setTimeout(() => fx.diamondRing(), 260);
      window.setTimeout(() => onDoneRef.current(), 900);
    };
    const tick = (now: number) => {
      const t = (now - t0) * rate;
      if (!rain) {
        const p = ease(Math.min(1, Math.max(0, (t - 420) / 1150)));
        setProgress(p);
        if (p >= 1) setStage((s) => (s === "rise" ? "total" : s));
      }
      if (t > (rain ? 2900 : 2650)) finish();
      else raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    const skip = () => finish();
    addEventListener("keydown", skip);
    addEventListener("pointerdown", skip);
    return () => {
      cancelAnimationFrame(raf);
      removeEventListener("keydown", skip);
      removeEventListener("pointerdown", skip);
      document.documentElement.classList.remove("intro-on");
    };
  }, [rain]);

  if (rain) {
    return (
      <div className={`intro rain is-${stage}`} aria-hidden>
        <div className="intro-stage">
          <div className="intro-written">
            <div className="intro-word display">umbra</div>
            <span className="intro-drip" style={{ left: "16%", animationDelay: "1.55s" }} />
            <span className="intro-drip" style={{ left: "55%", animationDelay: "1.85s" }} />
            <span className="intro-drip" style={{ left: "86%", animationDelay: "1.7s" }} />
          </div>
          <div className="intro-tag mono">a quiet place to write</div>
        </div>
        <div className="intro-skip mono">press any key</div>
      </div>
    );
  }

  return (
    <div className={`intro is-${stage}`} aria-hidden>
      <div className="intro-stage">
        <div className="intro-corona" />
        <div className="intro-corona second" />
        <div className="intro-sun">
          <Eclipse progress={progress} size={200} animated={false} luminous />
        </div>
        <div className="intro-diamond" />
        <div className="intro-word display">
          {"umbra".split("").map((ch, i) => (
            <span key={i} style={{ animationDelay: `${1.45 + i * 0.07}s` }}>
              {ch}
            </span>
          ))}
        </div>
        <div className="intro-tag mono">a quiet place to write</div>
      </div>
      <div className="intro-skip mono">press any key</div>
    </div>
  );
}
