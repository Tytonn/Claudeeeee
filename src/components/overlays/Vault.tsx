import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useAnimationControls } from "motion/react";
import { Delete } from "lucide-react";
import { app, useApp, type VaultPrompt } from "../../store/app";
import { toast } from "../../store/toasts";
import { Modal } from "../ui/Modal";
import { Eclipse } from "../ui/Eclipse";
import { PIN_LENGTH, checkPin, clearFails, commitHide, failedPin, makeVault, readFails, revealHidden } from "../../lib/vault";
import { haptic, play } from "../../lib/sound";
import { fx } from "../../fx/engine";
import { useAccount, verifyPassword, explainAccountError } from "../../account/account";
import { spring } from "../../lib/motion";

type Step = "enter" | "current" | "new" | "confirm" | "forgot";

const firstStep = (mode: VaultPrompt["mode"]): Step => (mode === "unlock" ? "enter" : mode === "change" ? "current" : "new");

function promptFor(step: Step, mode: VaultPrompt["mode"]) {
  switch (step) {
    case "enter":
      return "Enter your PIN";
    case "current":
      return "Enter your current PIN";
    case "new":
      return mode === "setup" ? "Choose a 4-digit PIN" : "Choose a new PIN";
    case "confirm":
      return "Enter it once more";
    case "forgot":
      return "Forgot your PIN?";
  }
}

const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", "del"] as const;

function VaultBody({ prompt, onClose }: { prompt: VaultPrompt; onClose: () => void }) {
  const vault = useApp((s) => s.vault);
  const user = useAccount((s) => s.user);
  const [step, setStep] = useState<Step>(() => firstStep(prompt.mode));
  const [pin, setPin] = useState("");
  const [status, setStatus] = useState<"idle" | "checking" | "wrong" | "open">("idle");
  const [note, setNote] = useState<string | null>(null);
  const [wait, setWait] = useState(0);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const dots = useAnimationControls();
  const mark = useRef<HTMLDivElement>(null);

  // A wait after too many wrong guesses (it survives closing and reopening).
  useEffect(() => {
    const tick = () => setWait(Math.max(0, Math.ceil((readFails().until - Date.now()) / 1000)));
    tick();
    const t = window.setInterval(tick, 500);
    return () => window.clearInterval(t);
  }, []);

  // The PIN pad's own state, kept in a ref and changed the instant something happens — so a
  // key pressed right as a step changes always lands in the new step, however slowly the
  // screen catches up. (React state above is only for drawing it.)
  const m = useRef({ step: firstStep(prompt.mode), pin: "", first: "", busy: false });
  const go = (next: Step) => {
    m.current.step = next;
    m.current.pin = "";
    setPin("");
    setStep(next);
  };

  const wrong = useCallback(
    async (message: string, then?: Step) => {
      m.current.busy = true;
      setStatus("wrong");
      setNote(message);
      haptic(30);
      play("untick");
      await dots.start({ x: [0, -14, 12, -9, 7, -4, 2, 0], transition: { duration: 0.46, ease: "easeOut" } });
      m.current.pin = "";
      setPin("");
      if (then) go(then);
      m.current.busy = false;
      setStatus("idle");
    },
    [dots],
  );

  const succeed = useCallback(() => {
    m.current.busy = true;
    setStatus("open");
    clearFails();
    play("dawn");
    haptic(12);
    // The eclipse ends: light floods back out from behind the moon.
    const r = mark.current?.getBoundingClientRect();
    if (r && fx.active) {
      const x = r.left + r.width / 2;
      const y = r.top + r.height / 2;
      if (fx.rain) fx.splash(x, y, 1.4);
      else {
        fx.sunburst(x, y);
        fx.flash(x, y, 220, { dur: 900, alpha: 0.35, color: fx.accent });
        fx.ring(x, y, 20, 160, { dur: 900, width: 1.6, alpha: 0.7 });
      }
    }
    window.setTimeout(() => {
      onClose();
      const then = prompt.then;
      const s = app();
      if (prompt.mode !== "change") s.setUnlocked(true);
      if (then && "hide" in then) commitHide(then.hide);
      else if (then && "open" in then) revealHidden();
      if (prompt.mode === "change") toast("PIN changed", { tone: "success" });
      else if (prompt.mode === "setup" && !(then && "hide" in then)) toast("PIN set. Hide notes from their ··· menu.", { tone: "success" });
    }, 640);
  }, [onClose, prompt]);

  const complete = useCallback(
    async (value: string) => {
      const step = m.current.step;
      const current = app().vault;
      if (step === "enter" || step === "current") {
        if (!current) return;
        setStatus("checking");
        const ok = await checkPin(current, value);
        if (!ok) {
          const f = failedPin();
          await wrong(f.until > Date.now() ? "Too many tries — wait a little, then try again." : "That's not it.");
          return;
        }
        clearFails();
        if (step === "enter") {
          succeed();
          return;
        }
        setNote(null);
        go("new");
        m.current.busy = false;
        setStatus("idle");
        return;
      }
      if (step === "new") {
        m.current.first = value;
        setNote(null);
        go("confirm");
        m.current.busy = false;
        return;
      }
      if (step === "confirm") {
        if (value !== m.current.first) {
          m.current.first = "";
          await wrong("Those didn't match. Choose one again.", "new");
          return;
        }
        setStatus("checking");
        app().setVault(await makeVault(value));
        succeed();
      }
    },
    [succeed, wrong],
  );

  const press = useCallback(
    (key: string) => {
      const st = m.current;
      if (st.busy || st.step === "forgot") return;
      if (key === "del") {
        st.pin = st.pin.slice(0, -1);
        setPin(st.pin);
        return;
      }
      if (!/^\d$/.test(key) || st.pin.length >= PIN_LENGTH) return;
      if ((st.step === "enter" || st.step === "current") && readFails().until > Date.now()) {
        void wrong("Too many tries — wait a little, then try again.");
        return;
      }
      setNote(null);
      st.pin += key;
      setPin(st.pin);
      play("tick");
      if (st.pin.length === PIN_LENGTH) {
        st.busy = true;
        const value = st.pin;
        window.setTimeout(() => void complete(value), 140);
      }
    },
    [complete, wrong],
  );

  // Typing works too. (Through a ref, so a key pressed the instant a step changes still goes
  // to the step you can see — even on a slow device.)
  const pressRef = useRef(press);
  pressRef.current = press;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if ((e.target as HTMLElement | null)?.closest?.("input")) return;
      if (/^\d$/.test(e.key)) {
        e.preventDefault();
        pressRef.current(e.key);
      } else if (e.key === "Backspace") {
        e.preventDefault();
        pressRef.current("del");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const resetWithPassword = async () => {
    if (!password || busy) return;
    setBusy(true);
    setNote(null);
    try {
      if (await verifyPassword(password)) {
        setPassword("");
        clearFails();
        go("new");
      } else setNote("That's not your account password.");
    } catch (err) {
      setNote(explainAccountError(err));
    } finally {
      setBusy(false);
    }
  };

  const open = status === "open";
  const locked = step === "enter" && wait > 0;

  return (
    <div className={`vault-body ${open ? "is-open" : ""} ${status === "wrong" ? "is-wrong" : ""}`}>
      <div className="vault-mark" ref={mark}>
        <Eclipse progress={open ? 0 : 1} size={64} luminous />
      </div>
      <h2 className="vault-title display">Hidden notes</h2>
      <AnimatePresence mode="wait" initial={false}>
        <motion.p
          key={step + (open ? "-open" : "")}
          className="vault-sub"
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -6 }}
          transition={{ duration: 0.18 }}
        >
          {open ? (prompt.mode === "change" ? "Done" : "Unlocked") : promptFor(step, prompt.mode)}
        </motion.p>
      </AnimatePresence>

      {step === "forgot" ? (
        <div className="vault-forgot">
          {user ? (
            <>
              <p className="vault-hint">Enter your account password (@{user.username}) to choose a new PIN.</p>
              <form
                className="vault-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  void resetWithPassword();
                }}
              >
                <input
                  className="text-input"
                  type="password"
                  autoComplete="current-password"
                  placeholder="Account password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  data-autofocus
                  autoFocus
                />
                <button type="submit" className="primary-btn" disabled={!password || busy}>
                  {busy ? <span className="spinner" /> : "Continue"}
                </button>
              </form>
            </>
          ) : (
            <p className="vault-hint">
              Without an account there's no way to reset it here. Your hidden notes are safe, though — they're included whenever you export a backup (Settings → Your data).
            </p>
          )}
          {note && <p className="vault-note">{note}</p>}
          <button type="button" className="link-btn" onClick={() => (go("enter"), setNote(null))}>
            Back to the PIN
          </button>
        </div>
      ) : (
        <>
          <motion.div className="vault-dots" animate={dots} aria-live="polite" aria-label={`${pin.length} of ${PIN_LENGTH} digits`}>
            {Array.from({ length: PIN_LENGTH }, (_, i) => (
              <motion.span
                key={i}
                className={`vault-dot ${i < pin.length || open ? "is-on" : ""}`}
                animate={open ? { x: (1.5 - i) * 21, scale: 0.6, opacity: 0 } : { x: 0, scale: i < pin.length ? [1, 1.35, 1] : 1, opacity: 1 }}
                transition={open ? { duration: 0.42, ease: [0.5, 0, 0.2, 1] } : { duration: 0.22 }}
              />
            ))}
          </motion.div>
          <div className="vault-note-slot">
            <AnimatePresence>
              {(note || locked) && (
                <motion.p className="vault-note" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                  {locked ? `Too many tries — try again in ${wait}s` : note}
                </motion.p>
              )}
            </AnimatePresence>
          </div>
          <div className="vault-pad" role="group" aria-label="PIN pad">
            {KEYS.map((k, i) =>
              k === "" ? (
                step === "enter" && vault ? (
                  <button key={i} type="button" className="vault-key is-text" onClick={() => (go("forgot"), setNote(null))}>
                    Forgot?
                  </button>
                ) : (
                  <span key={i} />
                )
              ) : (
                <motion.button
                  key={i}
                  type="button"
                  className={`vault-key ${k === "del" ? "is-del" : ""}`}
                  aria-label={k === "del" ? "Delete" : k}
                  disabled={status !== "idle" || (k === "del" && !pin)}
                  whileTap={{ scale: 0.9 }}
                  transition={spring}
                  onClick={() => press(k)}
                >
                  {k === "del" ? <Delete size={20} strokeWidth={1.6} /> : k}
                </motion.button>
              ),
            )}
          </div>
          {prompt.mode === "setup" && step === "new" && (
            <p className="vault-hint">Hidden notes stay out of your list, search and trash. To see them again, search “hidden”.</p>
          )}
        </>
      )}
    </div>
  );
}

/** The PIN pad for hidden notes. */
export function VaultModal() {
  const prompt = useApp((s) => s.ui.vault);
  const close = useCallback(() => app().setUI({ vault: null }), []);
  return (
    <Modal open={Boolean(prompt)} onClose={close} className="vault" label="Hidden notes">
      {prompt && <VaultBody key={`${prompt.mode}`} prompt={prompt} onClose={close} />}
    </Modal>
  );
}
