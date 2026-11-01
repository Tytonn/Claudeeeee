import { useEffect, useState } from "react";

const GLYPHS = "▖▗▘▚▞▟◆◇◐◑◒◓◢◣◤◥01#%*+=<>/";

function scrambleAt(text: string, p: number): string {
  const n = text.length;
  const front = Math.floor(p * (n + 8)) - 8;
  let out = "";
  for (let i = 0; i < n; i++) {
    const ch = text[i];
    if (ch === " " || i < front) out += ch;
    else out += GLYPHS[(Math.random() * GLYPHS.length) | 0];
  }
  return out;
}

/** Text that decodes itself out of cipher glyphs, left to right. */
export function useScramble(text: string, { duration = 800, delay = 0, enabled = true } = {}): string {
  const [out, setOut] = useState(() => (enabled ? scrambleAt(text, 0) : text));
  useEffect(() => {
    if (!enabled) {
      setOut(text);
      return;
    }
    let raf = 0;
    let last = 0;
    const t0 = performance.now() + delay;
    const tick = (now: number) => {
      const p = Math.min(1, Math.max(0, (now - t0) / duration));
      if (now - last > 45 || p >= 1) {
        setOut(scrambleAt(text, p));
        last = now;
      }
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [text, enabled, duration, delay]);
  return out;
}
