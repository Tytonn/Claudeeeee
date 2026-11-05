import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, MotionConfig, motion } from "motion/react";
import { EditorContent, useEditor } from "@tiptap/react";
import type { JSONContent } from "@tiptap/core";
import NumberFlow from "@number-flow/react";
import { ArrowRight, Download, Link2Off, Lock, Repeat } from "lucide-react";
import { ApiError, fetchShare, joinShare } from "../lib/api";
import { ASLEEP_AFTER, AWAY_AFTER, lastInputAt, onWake } from "../lib/activity";
import { open, writeTokenFor } from "../lib/crypto";
import type { SharePayload } from "../lib/types";
import { sanitizePayload } from "../lib/sanitize";
import { titleAttrs } from "../lib/theme";
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
import { Presence } from "../components/Presence";
import { readDoc } from "../collab/convert";
import { TITLE } from "../collab/fields";
import { LiveNote, useGuestSession, useSessionVersion } from "./LiveNote";
import { useAccount } from "../account/account";
import { AccountForm } from "../account/AccountModal";

type Phase = "loading" | "ready" | "missing-key" | "not-found" | "removed" | "bad-key" | "error" | "private" | "waiting" | "kicked";

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
      noteId = s.createNote({ title: payload.note.title, doc: payload.note.doc ?? undefined, text: payload.note.text, titleStyle: payload.note.titleStyle ?? null });
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
    kicked: { title: "You don't have access anymore.", body: "The person who shared this note removed you from it. Anything you saved stays yours." },
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

/** A private link: sign in, then ask the owner to let you in (and wait for them). */
function AccessScreen({ phase, from, onSignedIn }: { phase: Phase; from?: string; onSignedIn: () => void }) {
  const user = useAccount((s) => s.user);
  const who = from || "the person who shared it";
  if (!user) {
    return (
      <motion.div className="viewer-state access" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}>
        <div className="access-card">
          <AccountForm intro={`This note is private. Sign in (or create an account in a few seconds) and ${who} can let you in.`} initialMode="up" onDone={onSignedIn} />
        </div>
      </motion.div>
    );
  }
  return (
    <motion.div className="viewer-state" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}>
      <div className="viewer-state-mark waiting">
        <Eclipse progress={0.72} size={40} className="spin-glow" />
      </div>
      <h1 className="display">{phase === "waiting" ? "Asked to join" : "Asking to join…"}</h1>
      <p>
        {phase === "waiting"
          ? `We let ${who} know you'd like in. This page opens by itself the moment they say yes.`
          : "One moment…"}
      </p>
      <p className="viewer-state-fine mono">signed in as @{user.username}</p>
    </motion.div>
  );
}

export function ShareView({ id, keyRaw, embedded = false }: { id: string; keyRaw: string; embedded?: boolean }) {
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
  // A co-editable note: join its live doc (and edit it, if the owner allows).
  const live = phase === "ready" && payload?.note?.collab === true;
  const session = useGuestSession(id, keyRaw, live);
  useSessionVersion(session);
  const [liveTitle, setLiveTitle] = useState("");
  const sessionStatus = session?.status;
  const user = useAccount((s) => s.user);
  const [reload, setReload] = useState(0);
  const [role, setRole] = useState<"edit" | "view" | "pending" | null>(null);
  useEffect(() => {
    if (sessionStatus === "gone") setPhase("removed");
    if (sessionStatus === "denied") setPhase(session?.denied === "removed" ? "kicked" : session?.denied === "pending" ? "waiting" : "private");
  }, [sessionStatus, session]);

  // Signed in? Tell the owner who you are (you show up on their list), and find out what you may do.
  const joinedFor = useRef<string | null>(null);
  useEffect(() => {
    if (!user || !keyRaw || ownAnchor) return;
    if (phase !== "ready" && phase !== "private" && phase !== "waiting") return;
    let stopped = false;
    let timer = 0;
    const ask = async () => {
      try {
        const res = await joinShare(id, await writeTokenFor(keyRaw), user.username);
        if (stopped) return;
        joinedFor.current = `${user.uid}:${id}`;
        setRole(res.role);
        if (res.role === "pending") {
          setPhase("waiting");
          timer = window.setTimeout(ask, 4000);
        } else if (phase !== "ready") {
          // Let in: load it for real.
          setPhase("loading");
          setReload((n) => n + 1);
        }
      } catch (err) {
        if (stopped) return;
        if (err instanceof ApiError && err.code === "removed") setPhase("kicked");
        else if (phase !== "ready") timer = window.setTimeout(ask, 6000);
      }
    };
    if (phase !== "ready" || joinedFor.current !== `${user.uid}:${id}`) void ask();
    return () => {
      stopped = true;
      window.clearTimeout(timer);
    };
  }, [user, phase, id, keyRaw, ownAnchor]);

  // A live note's title, once its doc has arrived — straight from the doc (null: not here yet).
  const docTitle = live && session?.synced ? session.doc.getText(TITLE).toString() : null;

  // Keep it in your "Shared with you" list (synced to your account, if you have one).
  useEffect(() => {
    if (phase !== "ready" || !payload || ownAnchor || !keyRaw) return;
    // (a live note's title only arrives with its doc, a moment after the link opens: until then the
    // list keeps the title it has, rather than saying "Untitled" for a second)
    if (live && docTitle === null) return;
    const title = (live ? docTitle : payload.note?.title) || (payload.note ? "Untitled" : "To-dos & countdowns");
    const s = useApp.getState();
    const prev = s.shared[id];
    const now = Date.now();
    const nextRole = role === "edit" || role === "view" ? role : (prev?.role ?? null);
    if (prev && prev.title === title && prev.from === (payload.from ?? "") && prev.role === nextRole && now - prev.openedAt < 60_000) return;
    s.putShared({ id, key: keyRaw, title, from: payload.from ?? "", role: nextRole, addedAt: prev?.addedAt ?? now, openedAt: now });
  }, [phase, payload, live, docTitle, ownAnchor, id, keyRaw, role]);

  // A vast moon hangs above the page; its corona arcs across the top of the sky.
  useEffect(() => {
    if (embedded) return;
    fx.setMoon(() => {
      const r = Math.max(innerWidth * 0.46, 380);
      return { x: innerWidth / 2, y: -r * 0.64, r };
    });
    return () => fx.setMoon(null);
  }, [embedded]);

  // (a live note keeps itself current; the link around it only carries any lists and the title's look)
  const liveRef = useRef(false);
  liveRef.current = live;
  useEffect(() => {
    if (!keyRaw) return;
    let stopped = false;
    let parked = false;
    let timer = 0;
    const fastest = () => (liveRef.current ? 30_000 : 4_000);
    const slowest = () => (liveRef.current ? 120_000 : 30_000);
    let interval = 4000;
    let etag: string | null = null;
    let lastRev = -1;

    const schedule = () => {
      window.clearTimeout(timer);
      if (stopped || document.visibilityState !== "visible") return;
      const quiet = Date.now() - lastInputAt();
      // Nobody at the keyboard for half an hour: stop asking until someone's back.
      if (quiet > AWAY_AFTER) {
        parked = true;
        return;
      }
      timer = window.setTimeout(load, quiet > ASLEEP_AFTER ? slowest() : interval);
    };
    const unwake = onWake(() => {
      if (!parked || stopped) return;
      parked = false;
      interval = fastest();
      void load();
    });

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
        // A private link, or the owner removed you.
        if (err instanceof ApiError && (err.code === "restricted" || err.code === "pending" || err.code === "removed")) {
          setPhase(err.code === "removed" ? "kicked" : err.code === "pending" ? "waiting" : "private");
          stopped = true;
          return;
        }
        if (!loaded.current) setPhase("error");
        interval = Math.min(slowest(), interval * 2);
        schedule();
        return;
      }
      if (res && res.share.rev === lastRev) {
        // Same version as before (some CDNs weaken the ETag, so this can come back as a
        // full response): nothing changed — no light show, and keep easing off.
        etag = res.etag;
        res = null;
      }
      if (res) {
        try {
          const data = sanitizePayload(await open<unknown>(keyRaw, res.share));
          if (!data) throw new Error("empty_payload");
          if (data.note) data.note.doc = safeDoc(data.note.doc, data.note.text);
          etag = res.etag;
          lastRev = res.share.rev;
          liveRef.current = data.note?.collab === true;
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
          interval = fastest();
        } catch {
          if (!loaded.current) {
            setPhase("bad-key");
            stopped = true;
            return;
          }
        }
      } else {
        interval = Math.min(slowest(), Math.max(fastest(), Math.round(interval * 1.35)));
      }
      schedule();
    };

    const onVisibility = () => {
      const isVisible = document.visibilityState === "visible";
      setVisible(isVisible);
      window.clearTimeout(timer);
      if (isVisible && !stopped) {
        parked = false;
        interval = fastest();
        void load();
      }
    };

    void load();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      stopped = true;
      unwake();
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [id, keyRaw, reload]);

  useEffect(() => {
    const t = (live ? liveTitle : payload?.note?.title)?.trim();
    document.title = t ? `${t} · umbra` : payload ? "Shared with you · umbra" : "umbra";
    return () => {
      document.title = "umbra";
    };
  }, [payload, live, liveTitle]);

  const cds = useSortedCountdowns(payload?.countdowns, now);
  const todos = payload?.todos ?? [];
  const openTodos = todos.filter((t) => !t.done);
  const doneTodos = todos.filter((t) => t.done);
  const heroOnly = payload && !payload.note && cds.length > 0;

  return (
    <MotionConfig reducedMotion="user">
      <div className={`viewer ${embedded ? "is-embedded" : ""}`}>
        {!embedded && <div className="viewer-glow" aria-hidden />}
        <header className="viewer-bar">
          {embedded ? (
            <span className="viewer-embed-from mono">{payload?.from ? `Shared by ${payload.from}` : "Shared with you"}</span>
          ) : (
            <button type="button" className="brand" onClick={() => navigate("/")}>
              <Logo size={20} />
              <span className="wordmark display">umbra</span>
            </button>
          )}
          <span className="flex" />
          {phase === "ready" && (
            <>
              {session && <Presence session={session} size={26} withNames />}
              {session?.synced && !session.canWrite && <span className="viewer-chip mono">View only</span>}
              <span className={`viewer-live mono ${visible ? "" : "is-paused"} ${session?.status === "offline" ? "is-offline" : ""}`} title="Updates appear here automatically">
                <span className="live-dot" /> {!visible ? "Paused" : session?.status === "offline" ? "Reconnecting" : session?.canWrite ? "Live · editing" : "Live"}
              </span>
              {embedded && (
                <button type="button" className="ghost-btn sm" onClick={() => navigate(`/s/${id}#${keyRaw}`)} title="Open the full page (with any lists)">
                  Full page
                </button>
              )}
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
            {(phase === "private" || phase === "waiting") && <AccessScreen key="access" phase={phase} from={payload?.from} onSignedIn={() => {}} />}
            {phase !== "loading" && phase !== "ready" && phase !== "private" && phase !== "waiting" && <StateScreen key="state" phase={phase} />}
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

                {payload.note && live && (
                  <article className={`viewer-note ${firstReveal ? "decrypt" : ""}`} ref={titleRef} {...titleAttrs(payload.note.titleStyle)}>
                    <div className="decrypt-body">
                      {session?.synced ? (
                        <ErrorBoundary fallback={<div className="doc-error">This note couldn't be displayed.</div>}>
                          <LiveNote session={session} onTitle={setLiveTitle} />
                        </ErrorBoundary>
                      ) : session?.status === "missing" ? (
                        <div className="viewer-waiting mono">This note isn't live yet — ask them to open umbra for a moment, then refresh.</div>
                      ) : (
                        <div className="viewer-waiting mono">
                          <span className="spinner" /> Joining…
                        </div>
                      )}
                    </div>
                    {firstReveal && <div className="decrypt-scan" aria-hidden />}
                  </article>
                )}

                {payload.note && !live && (
                  <article className={`viewer-note ${firstReveal ? "decrypt" : ""}`} ref={titleRef} {...titleAttrs(payload.note.titleStyle)}>
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

        {!embedded && (
          <footer className="viewer-foot">
            <button type="button" className="link-btn" onClick={() => navigate("/")}>
              Made with <span className="display">umbra</span> — start writing your own <ArrowRight size={12} strokeWidth={1.8} />
            </button>
          </footer>
        )}

        {payload && (
          <ImportDialog
            payload={importOpen && live && session?.synced ? { ...payload, note: { ...readDoc(session.doc), updatedAt: Date.now() } } : payload}
            open={importOpen}
            onClose={() => setImportOpen(false)}
          />
        )}
        {!embedded && <Toasts />}
      </div>
    </MotionConfig>
  );
}
