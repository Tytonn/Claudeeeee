import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, MotionConfig, motion } from "motion/react";
import { EditorContent, useEditor } from "@tiptap/react";
import type { JSONContent } from "@tiptap/core";
import NumberFlow from "@number-flow/react";
import { ArrowRight, Download, Link2Off, Lock, Repeat } from "lucide-react";
import { ApiError, fetchShare } from "../lib/api";
import { open } from "../lib/crypto";
import type { SharePayload } from "../lib/types";
import { sanitizePayload } from "../lib/sanitize";
import { safeDoc } from "../components/editor/safeDoc";
import { fx } from "../fx/engine";
import { useScramble } from "../fx/useScramble";
import { countdownPhrase, describeCountdown, formatDate, formatTime, ordinal, relativeLong, splitDuration } from "../lib/dates";
import { useNow } from "../lib/hooks";
import { navigate } from "../lib/router";
import { play } from "../lib/sound";
import { spring } from "../lib/motion";
import { useApp } from "../store/app";
import { toast } from "../store/toasts";
import { buildExtensions } from "../components/editor/extensions";
import { Eclipse, Logo } from "../components/ui/Eclipse";
import { Checkbox } from "../components/ui/Checkbox";
import { Modal } from "../components/ui/Modal";
import { Toasts } from "../components/overlays/Toasts";
import { ErrorBoundary } from "../components/ErrorBoundary";

type Phase = "loading" | "ready" | "missing-key" | "not-found" | "removed" | "bad-key" | "error";

function ReadOnlyDoc({ doc }: { doc: JSONContent | null }) {
  const editor = useEditor({
    editable: false,
    extensions: buildExtensions({ editable: false }),
    content: doc ?? "",
    immediatelyRender: true,
    shouldRerenderOnTransaction: false,
    editorProps: { attributes: { class: "prose" } },
  });
  const last = useRef(JSON.stringify(doc));
  useEffect(() => {
    const next = JSON.stringify(doc);
    if (editor && next !== last.current) {
      last.current = next;
      editor.commands.setContent(doc ?? "", { emitUpdate: false });
    }
  }, [doc, editor]);
  return <EditorContent editor={editor} className="note-body" />;
}

type SharedCountdown = NonNullable<SharePayload["countdowns"]>[number];

function useSortedCountdowns(list: SharedCountdown[] | undefined, now: number) {
  return useMemo(
    () =>
      (list ?? [])
        .map((c) => ({ c, st: describeCountdown(c, new Date(now)) }))
        .sort((a, b) => {
          const r = (p: string) => (p === "today" ? 0 : p === "future" ? 1 : 2);
          return r(a.st.phase) - r(b.st.phase) || (a.st.phase === "past" ? b.st.ms - a.st.ms : a.st.ms - b.st.ms);
        }),
    [list, now],
  );
}

function HeroCountdown({ c, now }: { c: SharedCountdown; now: number }) {
  const st = describeCountdown(c, new Date(now));
  const live = st.hasTime && st.ms > 0 && st.ms < 86_400_000;
  const { h, m, s } = splitDuration(st.ms);
  return (
    <div className={`hero-cd is-${st.phase}`}>
      <Eclipse progress={st.progress} size={132} className="hero-eclipse" luminous />
      <div className="hero-value">
        {st.phase === "today" && !live ? (
          <span className="hero-today display">Today</span>
        ) : live ? (
          <span className="hero-live display tabular">
            {h > 0 && (
              <>
                <NumberFlow value={h} />
                <i>h</i>
              </>
            )}
            <NumberFlow value={m} digits={{ 1: { max: 5 } }} format={{ minimumIntegerDigits: 2 }} />
            <i>m</i>
            <NumberFlow value={s} digits={{ 1: { max: 5 } }} format={{ minimumIntegerDigits: 2 }} />
            <i>s</i>
          </span>
        ) : (
          <NumberFlow className="hero-num display" value={Math.abs(st.days)} />
        )}
      </div>
      <div className="hero-unit mono">
        {live ? "until" : st.phase === "past" ? "days ago" : st.phase === "today" ? "is the day" : st.days === 1 ? "day until" : "days until"}
      </div>
      <div className="hero-title display">{c.title}</div>
      <div className="hero-date mono">
        {formatDate(st.target, { year: "always" })}
        {c.time ? ` · ${formatTime(st.target)}` : ""}
        {c.repeat === "yearly" && st.nth ? ` · ${ordinal(st.nth)}` : ""}
      </div>
    </div>
  );
}

function ImportDialog({ payload, open: isOpen, onClose }: { payload: SharePayload; open: boolean; onClose: () => void }) {
  const [note, setNote] = useState(true);
  const [todos, setTodos] = useState(true);
  const [cds, setCds] = useState(true);
  const hasNote = Boolean(payload.note);
  const hasTodos = Boolean(payload.todos?.length);
  const hasCds = Boolean(payload.countdowns?.length);

  const save = () => {
    const s = useApp.getState();
    let noteId: string | null = null;
    if (hasNote && note && payload.note) {
      noteId = s.createNote({ title: payload.note.title, doc: payload.note.doc ?? undefined, text: payload.note.text });
    }
    if (hasTodos && todos) s.importTodos(payload.todos!);
    if (hasCds && cds) s.importCountdowns(payload.countdowns!);
    if (noteId) s.selectNote(noteId);
    if ((hasTodos && todos) || (hasCds && cds)) s.setSettings({ rail: true, todos: s.settings.todos || (hasTodos && todos), countdowns: s.settings.countdowns || (hasCds && cds) });
    play("chime");
    onClose();
    navigate("/");
    toast("Saved to your umbra", { tone: "success" });
  };

  const rows: { show: boolean; label: string; sub: string; value: boolean; set: (v: boolean) => void }[] = [
    { show: hasNote, label: "The note", sub: payload.note?.title || "Untitled", value: note, set: setNote },
    { show: hasTodos, label: "To-dos", sub: `${payload.todos?.length ?? 0} added to your list`, value: todos, set: setTodos },
    { show: hasCds, label: "Countdowns", sub: `${payload.countdowns?.length ?? 0} added to yours`, value: cds, set: setCds },
  ];
  const nothing = !((hasNote && note) || (hasTodos && todos) || (hasCds && cds));

  return (
    <Modal open={isOpen} onClose={onClose} className="import" label="Save a copy">
      <div className="import-body">
        <h2 className="display">Save a copy</h2>
        <p className="import-sub">It goes into your own umbra, private to this browser. You can edit it freely — the original won't change.</p>
        <ul className="import-rows">
          {rows
            .filter((r) => r.show)
            .map((r) => (
              <li key={r.label} className="import-row" onClick={() => r.set(!r.value)}>
                <Checkbox checked={r.value} onToggle={() => r.set(!r.value)} label={r.label} size={17} />
                <span className="import-row-text">
                  <span>{r.label}</span>
                  <span className="import-row-sub">{r.sub}</span>
                </span>
              </li>
            ))}
        </ul>
        <div className="import-actions">
          <button type="button" className="ghost-btn" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="primary-btn" disabled={nothing} onClick={save}>
            <Download size={14} strokeWidth={1.8} /> Save
          </button>
        </div>
      </div>
    </Modal>
  );
}

function StateScreen({ phase }: { phase: Phase }) {
  const copy: Record<string, { title: string; body: string }> = {
    "missing-key": { title: "This link is incomplete.", body: "The secret part after the # is missing — ask your friend to copy the whole link again." },
    "not-found": { title: "Nothing here.", body: "This link doesn't exist, or the person who shared it turned it off. Ask them to send you a new one." },
    removed: { title: "This link was turned off.", body: "The person who shared it stopped sharing. Anything you saved stays yours." },
    "bad-key": { title: "Can't unlock this.", body: "The link's key doesn't match. Make sure it was copied completely." },
    error: { title: "Couldn't reach the server.", body: "Check your connection and refresh." },
  };
  const c = copy[phase];
  if (!c) return null;
  return (
    <motion.div className="viewer-state" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}>
      <div className="viewer-state-mark">{phase === "removed" || phase === "not-found" ? <Link2Off size={26} strokeWidth={1.4} /> : <Lock size={24} strokeWidth={1.4} />}</div>
      <h1 className="display">{c.title}</h1>
      <p>{c.body}</p>
      <button type="button" className="ghost-btn" onClick={() => navigate("/")}>
        Open umbra <ArrowRight size={14} strokeWidth={1.8} />
      </button>
    </motion.div>
  );
}

/** The title decodes itself out of cipher glyphs the first time it appears. */
function DecodedTitle({ text, decode }: { text: string; decode: boolean }) {
  const shown = useScramble(text, { enabled: decode, duration: 1100, delay: 250 });
  return (
    <h1 className="note-title display static" aria-label={text}>
      {shown}
    </h1>
  );
}

export function ShareView({ id, keyRaw }: { id: string; keyRaw: string }) {
  const [phase, setPhase] = useState<Phase>(keyRaw ? "loading" : "missing-key");
  const [payload, setPayload] = useState<SharePayload | null>(null);
  const [updatedAt, setUpdatedAt] = useState(0);
  const [pulse, setPulse] = useState(0);
  const [importOpen, setImportOpen] = useState(false);
  const [visible, setVisible] = useState(document.visibilityState === "visible");
  const ownAnchor = useApp((s) => Object.values(s.shares).find((r) => r.id === id)?.anchor ?? null);
  const now = useNow(1000);
  const loaded = useRef(false);
  const [firstReveal] = useState(() => fx.active);
  const titleRef = useRef<HTMLElement>(null);

  // A vast moon hangs above the page; its corona arcs across the top of the sky.
  useEffect(() => {
    fx.setMoon(() => {
      const r = Math.max(innerWidth * 0.46, 380);
      return { x: innerWidth / 2, y: -r * 0.64, r };
    });
    return () => fx.setMoon(null);
  }, []);

  useEffect(() => {
    if (!keyRaw) return;
    let stopped = false;
    let timer = 0;
    let interval = 4000;
    let etag: string | null = null;

    const schedule = () => {
      window.clearTimeout(timer);
      if (!stopped && document.visibilityState === "visible") timer = window.setTimeout(load, interval);
    };

    const load = async () => {
      let res: Awaited<ReturnType<typeof fetchShare>>;
      try {
        res = await fetchShare(id, etag);
      } catch (err) {
        // Only the share function's own "not_found" means the link is gone (not a host 404 page).
        if (err instanceof ApiError && err.code === "not_found") {
          setPhase(loaded.current ? "removed" : "not-found");
          stopped = true;
          return;
        }
        if (!loaded.current) setPhase("error");
        interval = Math.min(30_000, interval * 2);
        schedule();
        return;
      }
      if (res) {
        try {
          const data = sanitizePayload(await open<unknown>(keyRaw, res.share));
          if (!data) throw new Error("empty_payload");
          if (data.note) data.note.doc = safeDoc(data.note.doc, data.note.text);
          etag = res.etag;
          setPayload(data);
          setUpdatedAt(res.share.updatedAt);
          if (loaded.current) {
            // A live edit arrives: the light stirs.
            setPulse((p) => p + 1);
            fx.flareUp(0.7);
            const r = titleRef.current?.getBoundingClientRect();
            if (r) fx.shockwave(r.left + r.width / 2, r.top + 20, 0.6, 1300);
          } else {
            // Decrypted: the diamond ring.
            window.setTimeout(() => fx.diamondRing(), 200);
          }
          loaded.current = true;
          setPhase("ready");
          interval = 4000;
        } catch {
          if (!loaded.current) {
            setPhase("bad-key");
            stopped = true;
            return;
          }
        }
      } else {
        interval = Math.min(30_000, Math.round(interval * 1.35));
      }
      schedule();
    };

    const onVisibility = () => {
      const isVisible = document.visibilityState === "visible";
      setVisible(isVisible);
      window.clearTimeout(timer);
      if (isVisible && !stopped) {
        interval = 4000;
        void load();
      }
    };

    void load();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      stopped = true;
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [id, keyRaw]);

  useEffect(() => {
    const t = payload?.note?.title?.trim();
    document.title = t ? `${t} · umbra` : payload ? "Shared with you · umbra" : "umbra";
    return () => {
      document.title = "umbra";
    };
  }, [payload]);

  const cds = useSortedCountdowns(payload?.countdowns, now);
  const todos = payload?.todos ?? [];
  const openTodos = todos.filter((t) => !t.done);
  const doneTodos = todos.filter((t) => t.done);
  const heroOnly = payload && !payload.note && cds.length > 0;

  return (
    <MotionConfig reducedMotion="user">
      <div className="viewer">
        <div className="viewer-glow" aria-hidden />
        <header className="viewer-bar">
          <button type="button" className="brand" onClick={() => navigate("/")}>
            <Logo size={20} />
            <span className="wordmark display">umbra</span>
          </button>
          <span className="flex" />
          {phase === "ready" && (
            <>
              <span className={`viewer-live mono ${visible ? "" : "is-paused"}`} title="Updates appear here automatically">
                <span className="live-dot" /> {visible ? "Live" : "Paused"}
              </span>
              {ownAnchor ? (
                <button
                  type="button"
                  className="primary-btn sm"
                  onClick={() => {
                    if (ownAnchor !== "board") useApp.getState().selectNote(ownAnchor);
                    navigate("/");
                  }}
                >
                  Open original
                </button>
              ) : (
                <button type="button" className="primary-btn sm" onClick={() => setImportOpen(true)}>
                  Save a copy
                </button>
              )}
            </>
          )}
        </header>

        <main className="viewer-main">
          <AnimatePresence mode="wait">
            {phase === "loading" && (
              <motion.div key="loading" className="viewer-loading" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                <Eclipse progress={0.92} size={44} className="spin-glow" />
                <span className="mono">Decrypting…</span>
              </motion.div>
            )}
            {phase !== "loading" && phase !== "ready" && <StateScreen key="state" phase={phase} />}
            {phase === "ready" && payload && (
              <motion.div
                key="ready"
                className="viewer-content"
                initial={{ opacity: 0, y: 14, filter: "blur(8px)" }}
                animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
                transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
              >
                <div className="viewer-from mono">
                  <span>{payload.from ? `From ${payload.from}` : "Shared with you"}</span>
                  <span className="sep" />
                  <AnimatePresence mode="wait" initial={false}>
                    <motion.span key={pulse} initial={{ opacity: 0, y: 3 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -3 }} className={pulse ? "just-updated" : ""}>
                      updated {relativeLong(updatedAt, now)}
                    </motion.span>
                  </AnimatePresence>
                  <span className="sep" />
                  <span className="viewer-lock">
                    <Lock size={10} strokeWidth={2.2} /> encrypted
                  </span>
                </div>

                {heroOnly && <HeroCountdown c={cds[0].c} now={now} />}

                {payload.note && (
                  <article className={`viewer-note ${firstReveal ? "decrypt" : ""}`} ref={titleRef}>
                    {pulse > 0 && (
                      <motion.div key={pulse} className="viewer-pulse" aria-hidden initial={{ opacity: 1 }} animate={{ opacity: 0 }} transition={{ duration: 1.6, ease: "easeOut" }} />
                    )}
                    <div className="decrypt-body">
                      <DecodedTitle text={payload.note.title || "Untitled"} decode={firstReveal} />
                      <ErrorBoundary fallback={<div className="doc-error">This note's formatting couldn't be displayed.</div>}>
                        <ReadOnlyDoc doc={payload.note.doc} />
                      </ErrorBoundary>
                    </div>
                    {firstReveal && <div className="decrypt-scan" aria-hidden />}
                  </article>
                )}

                {cds.length > (heroOnly ? 1 : 0) && (
                  <section className="viewer-section">
                    <h2 className="label">{heroOnly ? "Also counting down" : "Countdowns"}</h2>
                    <ul className="viewer-cds">
                      {cds.slice(heroOnly ? 1 : 0).map(({ c, st }, i) => (
                        <motion.li
                          key={`${c.title}-${c.date}-${i}`}
                          className={`viewer-cd is-${st.phase}`}
                          initial={{ opacity: 0, y: 8 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ ...spring, delay: 0.05 * i }}
                        >
                          <Eclipse progress={st.progress} size={34} />
                          <div className="viewer-cd-text">
                            <div className="viewer-cd-title">
                              {c.title}
                              {c.repeat === "yearly" && <Repeat size={10} strokeWidth={2.2} className="cd-yearly" />}
                            </div>
                            <div className="viewer-cd-date mono">{formatDate(st.target)}</div>
                          </div>
                          <div className="viewer-cd-value">
                            {st.phase === "today" ? (
                              <span className="cd-today display">Today</span>
                            ) : (
                              <>
                                <NumberFlow className="cd-num display" value={Math.abs(st.days)} />
                                <span className="cd-unit mono">{st.phase === "past" ? "ago" : st.days === 1 ? "day" : "days"}</span>
                              </>
                            )}
                          </div>
                          <span className="sr-only">{countdownPhrase(st)}</span>
                        </motion.li>
                      ))}
                    </ul>
                  </section>
                )}

                {todos.length > 0 && (
                  <section className="viewer-section">
                    <h2 className="label">
                      To-do <span className="viewer-count">{openTodos.length ? `${openTodos.length} open` : "all done"}</span>
                    </h2>
                    <ul className="viewer-todos">
                      {[...openTodos, ...doneTodos].map((t, i) => (
                        <motion.li
                          key={`${t.text}-${i}`}
                          layout="position"
                          className={`viewer-todo ${t.done ? "is-done" : ""}`}
                          initial={{ opacity: 0, x: -6 }}
                          animate={{ opacity: 1, x: 0 }}
                          transition={{ ...spring, delay: 0.03 * i }}
                        >
                          <span className={`check static ${t.done ? "is-checked" : ""}`} aria-hidden>
                            <span className="check-fill" style={{ transform: `scale(${t.done ? 1 : 0.4})`, opacity: t.done ? 1 : 0 }} />
                            {t.done && (
                              <svg viewBox="0 0 16 16" className="check-mark">
                                <path d="M4.4 8.6 7 11.1 11.8 5.5" />
                              </svg>
                            )}
                          </span>
                          <span>{t.text}</span>
                          {t.done && <span className="sr-only">(done)</span>}
                        </motion.li>
                      ))}
                    </ul>
                  </section>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </main>

        <footer className="viewer-foot">
          <button type="button" className="link-btn" onClick={() => navigate("/")}>
            Made with <span className="display">umbra</span> — start writing your own <ArrowRight size={12} strokeWidth={1.8} />
          </button>
        </footer>

        {payload && <ImportDialog payload={payload} open={importOpen} onClose={() => setImportOpen(false)} />}
        <Toasts />
      </div>
    </MotionConfig>
  );
}
