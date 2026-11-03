import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Eclipse } from "../components/ui/Eclipse";
import { fx } from "./engine";

const KEY = "umbra:intro";

/** Plays once per browser session, only with full effects on. */
export function shouldPlayIntro(): boolean {
  try {
    if (!fx.full || sessionStorage.getItem(KEY)) return false;
    sessionStorage.setItem(KEY, "1");
    // Under the solar eclipse the real sky plays the intro, so the page stays out of sight
    // from the very first frame until it's done.
    if (fx.solar) document.documentElement.classList.add("intro-solar");
    return true;
  } catch {
    return false;
  }
}

const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

type Kind = "eclipse" | "rain" | "solar";
const LENGTH: Record<Kind, number> = { eclipse: 2650, rain: 2900, solar: 3400 };
/** Where the moon comes from in the solar intro (down and to the right, so the sun breaks out up and to the left). */
const FROM = { x: 0.82, y: 0.57 };

/**
 * A total eclipse, in about two and a half seconds: the sun rises out of the dark,
 * the moon slides across, the corona bursts out at totality, a diamond ring flashes —
 * and the light spills outward to become the app.
 *
 * In the rain it's a window instead: the dark lifts onto rain-streaked glass, the name is
 * written into the fog with a fingertip, a few drips run off it — and lightning, as it clears.
 *
 * Under the solar eclipse the sky itself plays it, in the middle of the screen: a strange,
 * dimming daylight and a blinding crescent; the moon creeps over it; Baily's beads, the diamond
 * ring — totality, the corona blooming out, the stars appearing. Then the sun drifts off to its
 * place in the sky as the page comes up.
 */
export function Intro({ onDone }: { onDone: () => void }) {
  const [kind] = useState<Kind>(() => (fx.rain ? "rain" : fx.solar ? "solar" : "eclipse"));
  const [progress, setProgress] = useState(0);
  const [stage, setStage] = useState<"rise" | "total" | "out">("rise");
  const [spot] = useState(() => {
    const m = Math.min(innerWidth, innerHeight);
    return { x: innerWidth / 2, y: innerHeight * 0.4, r: Math.max(40, Math.min(140, m * 0.105 * fx.sunScale)) };
  });
  const done = useRef(false);
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;

  // Before the first paint: the sun in place, the moon well off it, the sky still dark.
  useLayoutEffect(() => {
    if (kind !== "solar") return;
    document.documentElement.classList.add("intro-solar");
    fx.holdSun(spot, { fromBlack: true });
    fx.setApproach({ x: FROM.x * 0.82, y: FROM.y * 0.82 });
  }, [kind, spot]);

  useEffect(() => {
    const root = document.documentElement;
    root.classList.add("intro-on");
    let raf = 0;
    const t0 = performance.now();
    // Dev only: slow the whole thing down to look at it (pair with a slowed CSS animation rate).
    const rate = import.meta.env.DEV ? ((window as { __introRate?: number }).__introRate ?? 1) : 1;
    let flared = false;
    const finish = () => {
      if (done.current) return;
      done.current = true;
      setStage("out");
      root.classList.remove("intro-on");
      if (kind === "rain") {
        window.setTimeout(() => fx.diamondRing(), 140 / rate);
        window.setTimeout(() => onDoneRef.current(), 900 / rate);
        return;
      }
      if (kind === "solar") {
        // Totality holds; the sun drifts off to its place in the sky as the page comes up.
        fx.setApproach(null);
        fx.holdSun(null);
        root.classList.remove("intro-solar");
        root.classList.add("intro-solar-out");
        window.setTimeout(() => root.classList.remove("intro-solar-out"), 1500);
        window.setTimeout(() => onDoneRef.current(), 900 / rate);
        return;
      }
      fx.flareUp(1);
      window.setTimeout(() => fx.diamondRing(), 260);
      window.setTimeout(() => onDoneRef.current(), 900);
    };
    const tick = (now: number) => {
      const t = (now - t0) * rate;
      if (kind === "eclipse") {
        const p = ease(Math.min(1, Math.max(0, (t - 420) / 1150)));
        setProgress(p);
        if (p >= 1) setStage((s) => (s === "rise" ? "total" : s));
      } else if (kind === "solar") {
        // The moon closes in, slower and slower: the crescent thins, the light drains away, the
        // beads glitter along its edge, the diamond ring flashes — and then it's covered.
        const d = Math.max(0, 0.82 * Math.exp(-Math.max(0, t - 150) / 430) - 0.008);
        fx.setApproach({ x: FROM.x * d, y: FROM.y * d });
        if (!flared && d < 0.05) {
          flared = true;
          fx.lensFlare();
        }
        if (d <= 0) setStage((s) => (s === "rise" ? "total" : s));
      }
      if (t > LENGTH[kind]) finish();
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
      root.classList.remove("intro-on");
      if (kind === "solar" && !done.current) {
        fx.setApproach(null);
        fx.holdSun(null);
        root.classList.remove("intro-solar");
      }
    };
  }, [kind]);

  if (kind === "rain") {
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
      </div>
    );
  }

  if (kind === "solar") {
    return (
      <div className={`intro solar is-${stage}`} style={{ "--word-top": `${spot.y + spot.r * 2.9}px` } as React.CSSProperties} aria-hidden>
        <div className="intro-stage">
          <div className="intro-word display">
            {"umbra".split("").map((ch, i) => (
              <span key={i} style={{ animationDelay: `${1.95 + i * 0.08}s` }}>
                {ch}
              </span>
            ))}
          </div>
          <div className="intro-tag mono">a quiet place to write</div>
        </div>
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
    </div>
  );
}
