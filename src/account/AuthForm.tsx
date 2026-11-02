import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion, useSpring } from "motion/react";
import { Eye, EyeOff, KeyRound } from "lucide-react";
import { Eclipse } from "../components/ui/Eclipse";
import { Segmented } from "../components/ui/Segmented";
import { fx } from "../fx/engine";
import { useScramble } from "../fx/useScramble";
import { play } from "../lib/sound";
import { usernameAvailable } from "../lib/api";
import { explainAccountError, normalizeUsername, signIn, signUp, usernameProblem } from "./account";

/**
 * Signing in, as an eclipse. The moon slides across the sun as you fill the form in, the
 * corona grows with your password's strength, and when you go, the keys are forged at
 * totality — then the diamond ring breaks out and you're in.
 */

const COMMON = new Set(["password", "password1", "12345678", "123456789", "qwertyuiop", "qwerty123", "iloveyou", "11111111", "abc12345", "letmein1", "umbraumbra"]);

export function strengthOf(pw: string): { score: 0 | 1 | 2 | 3 | 4; label: string } {
  if (!pw) return { score: 0, label: "" };
  if (pw.length < 8 || COMMON.has(pw.toLowerCase())) return { score: 1, label: pw.length < 8 ? "Too short" : "Too common" };
  let pool = 0;
  if (/[a-z]/.test(pw)) pool += 26;
  if (/[A-Z]/.test(pw)) pool += 26;
  if (/\d/.test(pw)) pool += 10;
  if (/[^A-Za-z0-9]/.test(pw)) pool += 33;
  const variety = Math.min(1, new Set(pw).size / Math.max(5, pw.length * 0.55));
  const bits = pw.length * Math.log2(Math.max(pool, 2)) * variety;
  const score = bits < 36 ? 1 : bits < 52 ? 2 : bits < 72 ? 3 : 4;
  return { score: score as 1 | 2 | 3 | 4, label: ["", "Weak", "Fair", "Strong", "Stellar"][score] };
}

/** A line of cipher glyphs that never settles — keys being forged. */
function Forge({ done }: { done: boolean }) {
  const [text, setText] = useState("");
  useEffect(() => {
    if (done) return;
    const glyphs = "▖▗▘▚▞◆◇◐◑◒◓0123456789abcdef";
    const id = window.setInterval(() => {
      let out = "";
      for (let i = 0; i < 32; i++) out += i && i % 8 === 0 ? " " : glyphs[(Math.random() * glyphs.length) | 0];
      setText(out);
    }, 55);
    return () => window.clearInterval(id);
  }, [done]);
  return <div className={`auth-forge mono ${done ? "is-done" : ""}`}>{done ? "key sealed · 256-bit" : text}</div>;
}

function Check({ on }: { on: boolean }) {
  return (
    <svg viewBox="0 0 16 16" className={`auth-check ${on ? "is-on" : ""}`} aria-hidden>
      <path d="M3.6 8.6 6.6 11.4 12.4 4.8" />
    </svg>
  );
}

type Phase = "idle" | "forging" | "success";

export function AuthForm({ onDone, intro, initialMode = "in" }: { onDone?: () => void; intro?: string; initialMode?: "in" | "up" }) {
  const [mode, setMode] = useState<"in" | "up">(initialMode);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [show, setShow] = useState(false);
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [shake, setShake] = useState(0);
  const [available, setAvailable] = useState<boolean | null>(null);
  const hero = useRef<HTMLDivElement>(null);
  const lastScore = useRef(0);

  const uname = normalizeUsername(username);
  const unameOk = !usernameProblem(uname);
  const strength = useMemo(() => strengthOf(password), [password]);
  const confirmOk = mode === "up" && confirm.length > 0 && confirm === password;
  const ready =
    mode === "up" ? unameOk && available !== false && password.length >= 8 && confirmOk : unameOk && password.length > 0;

  // Is that username free? (Asked lazily while you type a new one.)
  useEffect(() => {
    if (mode !== "up" || !unameOk) {
      setAvailable(null);
      return;
    }
    let live = true;
    setAvailable(null);
    const t = window.setTimeout(() => {
      usernameAvailable(uname).then(
        (ok) => live && setAvailable(ok),
        () => live && setAvailable(null),
      );
    }, 380);
    return () => {
      live = false;
      window.clearTimeout(t);
    };
  }, [uname, unameOk, mode]);

  // How far across the sun the moon has come.
  const target =
    phase !== "idle"
      ? 1
      : mode === "up"
        ? 0.1 + (unameOk && available !== false ? 0.22 : 0) + (strength.score / 4) * 0.46 + (confirmOk ? 0.2 : 0)
        : 0.12 + (unameOk ? 0.3 : 0) + Math.min(1, password.length / 8) * 0.48;
  const spring = useSpring(target, { stiffness: 90, damping: 18 });
  const [progress, setProgress] = useState(target);
  useEffect(() => spring.on("change", setProgress), [spring]);
  useEffect(() => spring.set(error && phase === "idle" ? Math.max(0.05, target - 0.18) : target), [spring, target, error, phase]);

  // A little flourish each time the password gets a level stronger.
  useEffect(() => {
    if (mode === "up" && strength.score > lastScore.current && strength.score >= 3) {
      const meter = document.querySelector<HTMLElement>(".auth-meter");
      const r = meter?.getBoundingClientRect();
      if (r && fx.active) fx.sunburst(r.left + (r.width * strength.score) / 4 - 10, r.top + r.height / 2);
      play("tick");
    }
    lastScore.current = strength.score;
  }, [strength.score, mode]);

  const celebrate = () => {
    const r = hero.current?.getBoundingClientRect();
    play("dawn");
    if (!r || !fx.active) return;
    const x = r.left + r.width / 2;
    const y = r.top + r.height / 2;
    const rim = { x: x + r.width * 0.3, y: y - r.height * 0.3 };
    fx.flareUp(1);
    fx.flash(rim.x, rim.y, 140, { dur: 600, alpha: 0.95 });
    fx.flash(x, y, Math.max(innerWidth, innerHeight) * 0.5, { dur: 1000, alpha: 0.28, color: fx.accent });
    fx.ring(x, y, r.width * 0.4, r.width * 2.6, { dur: 900, width: 2 });
    fx.ring(x, y, r.width * 0.4, r.width * 4.2, { dur: 1300, delay: 120, alpha: 0.5 });
    fx.shockwave(x, y, 1.1, 1500);
    fx.sunburst(rim.x, rim.y);
    fx.burst(x, y, { count: 80, speed: 420, size: 2, life: 1.2, sparks: 0.7 });
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (phase !== "idle") return;
    setError(null);
    if (mode === "up") {
      const problem = usernameProblem(uname);
      if (problem) return fail(problem);
      if (available === false) return fail("That username is taken.");
      if (password.length < 8) return fail("Use at least 8 characters for your password.");
      if (password !== confirm) return fail("The passwords don't match.");
    }
    setPhase("forging");
    play("eclipse");
    const started = Date.now();
    try {
      if (mode === "up") await signUp(uname, password);
      else await signIn(uname, password);
      // Let totality hold for a beat, even on a fast machine.
      await new Promise((r) => setTimeout(r, Math.max(0, 900 - (Date.now() - started))));
      setPhase("success");
      celebrate();
      const hold = import.meta.env.DEV ? Number((window as unknown as { __authHold?: number }).__authHold ?? 1500) : 1500;
      window.setTimeout(() => onDone?.(), hold);
    } catch (err) {
      setPhase("idle");
      fail(explainAccountError(err));
    }
  };

  const fail = (msg: string) => {
    setError(msg);
    setShake((n) => n + 1);
    play("drop");
  };

  const title = phase === "success" ? (mode === "up" ? `Welcome, @${uname}` : `Welcome back, @${uname}`) : phase === "forging" ? (mode === "up" ? "Forging your keys" : "Unlocking") : mode === "up" ? "Create your account" : "Welcome back";
  const shownTitle = useScramble(title, { duration: 520, enabled: fx.active });

  return (
    <form className={`auth phase-${phase} mode-${mode}`} onSubmit={submit} noValidate style={{ "--power": strength.score / 4 } as React.CSSProperties}>
      <div className="auth-hero" ref={hero} aria-hidden>
        <div className="auth-corona" />
        <div className="auth-corona rays" />
        <Eclipse progress={progress} size={112} animated={false} luminous />
        <div className="auth-diamond" />
      </div>

      <h2 className="auth-title display" aria-live="polite">
        {shownTitle}
      </h2>
      <AnimatePresence mode="wait" initial={false}>
        {phase === "idle" ? (
          <motion.div key="intro" className="auth-sub" initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }}>
            {intro ?? (mode === "up" ? "One account, every device. Your notes stay encrypted the whole way." : "Your notes are waiting on the other side.")}
          </motion.div>
        ) : (
          <motion.div key="forge" initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
            <Forge done={phase === "success"} />
          </motion.div>
        )}
      </AnimatePresence>

      <motion.div
        className="auth-fields"
        key={shake}
        animate={shake ? { x: [0, -10, 9, -6, 5, -2, 0] } : undefined}
        transition={{ duration: 0.45 }}
      >
        <Segmented<"in" | "up">
          label="Sign in or create an account"
          value={mode}
          options={[
            { value: "in", label: "Sign in" },
            { value: "up", label: "Create account" },
          ]}
          onChange={(m) => {
            setMode(m);
            setError(null);
          }}
        />

        <label className={`auth-field ${unameOk ? "is-ok" : ""}`}>
          <span className="auth-label">Username</span>
          <span className="auth-input">
            <span className="auth-at">@</span>
            <input
              data-autofocus
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              value={username}
              maxLength={24}
              disabled={phase !== "idle"}
              onChange={(e) => setUsername(e.target.value.replace(/\s/g, ""))}
              placeholder="yourname"
            />
            <Check on={mode === "up" ? unameOk && available === true : unameOk} />
          </span>
          <AnimatePresence initial={false}>
            {mode === "up" && unameOk && available !== null && (
              <motion.span key={String(available)} className={`auth-hint ${available ? "is-good" : "is-bad"}`} initial={{ opacity: 0, y: -3 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
                {available ? `@${uname} is yours` : `@${uname} is taken`}
              </motion.span>
            )}
          </AnimatePresence>
        </label>

        <label className="auth-field">
          <span className="auth-label">Password</span>
          <span className="auth-input">
            <input
              type={show ? "text" : "password"}
              autoComplete={mode === "up" ? "new-password" : "current-password"}
              value={password}
              disabled={phase !== "idle"}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={mode === "up" ? "8+ characters" : ""}
            />
            <button type="button" className="auth-eye" onClick={() => setShow((v) => !v)} aria-label={show ? "Hide password" : "Show password"} tabIndex={-1}>
              {show ? <EyeOff size={14} strokeWidth={1.8} /> : <Eye size={14} strokeWidth={1.8} />}
            </button>
          </span>
          {mode === "up" && (
            <span className={`auth-meter s${strength.score}`} aria-label={strength.label ? `Strength: ${strength.label}` : undefined}>
              {[1, 2, 3, 4].map((i) => (
                <span key={i} className={`auth-seg ${strength.score >= i ? "is-lit" : ""}`} />
              ))}
              <span className="auth-meter-label mono">{strength.label}</span>
            </span>
          )}
        </label>

        <AnimatePresence initial={false}>
          {mode === "up" && (
            <motion.label
              key="confirm"
              className={`auth-field ${confirmOk ? "is-ok" : ""}`}
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.28, ease: [0.2, 0.8, 0.2, 1] }}
            >
              <span className="auth-label">Password again</span>
              <span className="auth-input">
                <input type={show ? "text" : "password"} autoComplete="new-password" value={confirm} disabled={phase !== "idle"} onChange={(e) => setConfirm(e.target.value)} />
                <Check on={confirmOk} />
              </span>
            </motion.label>
          )}
        </AnimatePresence>

        <AnimatePresence>
          {error && (
            <motion.div key={error} className="auth-error" initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
              {error}
            </motion.div>
          )}
        </AnimatePresence>

        <button type="submit" className={`auth-go ${ready ? "is-ready" : ""}`} disabled={phase !== "idle" || !ready}>
          <span className="auth-go-label">
            {phase === "forging" ? (mode === "up" ? "Forging your keys…" : "Unlocking…") : phase === "success" ? "You're in" : mode === "up" ? "Create account" : "Sign in"}
          </span>
        </button>

        <p className="auth-fine">
          <KeyRound size={11} strokeWidth={2} />
          <span>
            End-to-end encrypted with your password — the server never sees it or your notes. That also means a forgotten password can't be reset, so keep it
            safe.
          </span>
        </p>
      </motion.div>
    </form>
  );
}
