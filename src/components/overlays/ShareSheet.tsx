import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Check, Copy, FileText, Hourglass, ListChecks, Lock, PenLine, Send } from "lucide-react";
import type { VirtualElement } from "@floating-ui/react-dom";
import { useApp } from "../../store/app";
import { BOARD, shareUrl, startShare, stopShare, useShareStatus, verifyShare } from "../../store/shareSync";
import { toast } from "../../store/toasts";
import { ApiError } from "../../lib/api";
import { displayTitle } from "../../lib/text";
import { play } from "../../lib/sound";
import { Popover } from "../ui/Popover";
import { Switch } from "../ui/Switch";
import { fx } from "../../fx/engine";
import { useScramble } from "../../fx/useScramble";
import { setEditable, useCollabSession } from "../../collab/manager";
import { Presence } from "../Presence";
import { PeoplePanel } from "./People";

function explain(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.code === "offline") return "You're offline — connect and try again.";
    if (err.code === "no_backend") return "Sharing runs on Netlify Functions. Deploy the site to Netlify (or run `npm run dev`) to create links.";
    if (err.status === 413) return "That's too big to share in one link.";
    return `The server said no (${err.code}). Try again in a moment.`;
  }
  return err instanceof Error ? err.message : "Something went wrong.";
}

type Props = {
  anchor: string;
  open: boolean;
  anchorEl: Element | VirtualElement | null;
  onClose: () => void;
  placement?: "bottom-end" | "bottom-start" | "left-start";
};

export function ShareSheet({ anchor, open, anchorEl, onClose, placement = "bottom-end" }: Props) {
  const record = useApp((s) => s.shares[anchor]);
  const settings = useApp((s) => s.settings);
  const note = useApp((s) => (anchor !== BOARD ? s.notes[anchor] : undefined));
  const openTodos = useApp((s) => s.todos.filter((t) => !t.done).length);
  const totalTodos = useApp((s) => s.todos.length);
  const countdowns = useApp((s) => s.countdowns.length);
  const patchShare = useApp((s) => s.patchShare);
  const setSettings = useApp((s) => s.setSettings);
  const status = useShareStatus((s) => s[anchor]);

  const isBoard = anchor === BOARD;
  const [todos, setTodos] = useState(false);
  const [cds, setCds] = useState(false);
  const [busy, setBusy] = useState<"create" | "stop" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [name, setName] = useState(settings.name);
  const [justCreated, setJustCreated] = useState(false);
  const [canEdit, setCanEdit] = useState(true);
  const session = useCollabSession(isBoard ? null : anchor);

  useEffect(() => {
    if (!open) return;
    setTodos(record ? record.includeTodos : isBoard && settings.todos);
    setCds(record ? record.includeCountdowns : isBoard && settings.countdowns);
    setError(null);
    setCopied(false);
    setName(settings.name);
    setJustCreated(false);
    setCanEdit(record ? record.editable !== false : true);
    // Make sure a live link really still works, rather than trusting what we remember.
    if (!record) return;
    let current = true;
    void verifyShare(anchor).then((ok) => {
      if (current && !ok) setError("That link doesn't work anymore. It was turned off or never saved. Create a new one below and send that instead.");
    });
    return () => {
      current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const url = record ? shareUrl(record) : "";
  const prettyUrl = record ? `${location.host}/s/${record.id}` : "";
  const shownUrl = useScramble(prettyUrl, { enabled: justCreated && fx.active, duration: 900, delay: 150 });
  const nothing = isBoard && !todos && !cds;

  const copy = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
      return true;
    } catch {
      return false;
    }
  };

  const setInclude = (which: "todos" | "cds", value: boolean) => {
    // A board link must always carry something.
    if (isBoard && !value && ((which === "todos" && !cds) || (which === "cds" && !todos))) return;
    if (which === "todos") setTodos(value);
    else setCds(value);
    if (record) patchShare(anchor, which === "todos" ? { includeTodos: value } : { includeCountdowns: value });
  };

  const toggleEdit = (value: boolean) => {
    setCanEdit(value);
    if (record) void setEditable(anchor, value);
  };

  const commitName = () => {
    if (name.trim() !== settings.name) setSettings({ name: name.trim().slice(0, 40) });
  };

  const create = async () => {
    commitName();
    setBusy("create");
    setError(null);
    try {
      const r = await startShare(anchor, { includeTodos: todos, includeCountdowns: cds, editable: canEdit });
      // Send it up: a beam of light rises from the button.
      if (fx.active && anchorEl && "getBoundingClientRect" in anchorEl) {
        const b = anchorEl.getBoundingClientRect();
        fx.beam(b.left + b.width / 2, b.top + b.height / 2);
        play("transmit");
        setJustCreated(true);
      } else play("chime");
      const ok = await copy(shareUrl(r));
      toast(ok ? "Link created and copied" : "Link created", { tone: "success" });
    } catch (err) {
      setError(explain(err));
    } finally {
      setBusy(null);
    }
  };

  const stop = async () => {
    setBusy("stop");
    setError(null);
    try {
      await stopShare(anchor);
      toast("Link turned off — it no longer opens");
    } catch (err) {
      setError(explain(err));
    } finally {
      setBusy(null);
    }
  };

  const sendNative = async () => {
    try {
      await navigator.share({ title: note ? displayTitle(note) : "My list", url });
    } catch {
      /* cancelled */
    }
  };

  return (
    <Popover open={open} onClose={onClose} anchor={anchorEl} placement={placement} className="share-pop" label="Share">
      <div className="share">
        <header className="share-head">
          <div className="share-title display">{record ? "Sharing live" : isBoard ? "Share your lists" : "Share note"}</div>
          <div className="share-sub">
            <Lock size={11} strokeWidth={2} /> End-to-end encrypted
          </div>
        </header>

        <div className="share-items">
          {!isBoard && note && (
            <div className="share-row is-fixed">
              <span className="share-row-icon">
                <FileText size={15} strokeWidth={1.7} />
              </span>
              <span className="share-row-text">
                <span className="share-row-title">{displayTitle(note)}</span>
                <span className="share-row-sub">This note</span>
              </span>
              <Check size={15} strokeWidth={2} className="share-row-check" />
            </div>
          )}
          {!isBoard && note && (
            <div className="share-row" onClick={() => toggleEdit(!canEdit)}>
              <span className="share-row-icon">
                <PenLine size={15} strokeWidth={1.7} />
              </span>
              <span className="share-row-text">
                <span className="share-row-title">Friends can edit</span>
                <span className="share-row-sub">{canEdit ? "Write together, live — you'll see each other's cursors" : "View only — they still see your edits live"}</span>
              </span>
              <span onClick={(e) => e.stopPropagation()}>
                <Switch checked={canEdit} onChange={(v) => toggleEdit(v)} label="Friends can edit" />
              </span>
            </div>
          )}
          {settings.todos && (
            <div className="share-row" onClick={() => setInclude("todos", !todos)}>
              <span className="share-row-icon">
                <ListChecks size={15} strokeWidth={1.7} />
              </span>
              <span className="share-row-text">
                <span className="share-row-title">{isBoard ? "To-do list" : "Include to-do list"}</span>
                <span className="share-row-sub">{totalTodos ? `${openTodos} open of ${totalTodos}` : "Empty for now"}</span>
              </span>
              <span onClick={(e) => e.stopPropagation()}>
                <Switch checked={todos} onChange={(v) => setInclude("todos", v)} label="Include to-do list" />
              </span>
            </div>
          )}
          {settings.countdowns && (
            <div className="share-row" onClick={() => setInclude("cds", !cds)}>
              <span className="share-row-icon">
                <Hourglass size={15} strokeWidth={1.7} />
              </span>
              <span className="share-row-text">
                <span className="share-row-title">{isBoard ? "Countdowns" : "Include countdowns"}</span>
                <span className="share-row-sub">{countdowns ? `${countdowns} counting down` : "None yet"}</span>
              </span>
              <span onClick={(e) => e.stopPropagation()}>
                <Switch checked={cds} onChange={(v) => setInclude("cds", v)} label="Include countdowns" />
              </span>
            </div>
          )}
        </div>

        <AnimatePresence mode="wait" initial={false}>
          {record ? (
            <motion.div key="live" className="share-live" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.2 }}>
              <div className="share-link">
                <span className="share-url mono" title={url}>
                  {shownUrl}
                  <span className="share-url-key">#••••</span>
                </span>
                <button type="button" className={`share-copy ${copied ? "is-copied" : ""}`} onClick={() => void copy(url)}>
                  <AnimatePresence mode="wait" initial={false}>
                    <motion.span key={copied ? "y" : "n"} initial={{ opacity: 0, scale: 0.6 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.6 }} transition={{ duration: 0.14 }}>
                      {copied ? <Check size={14} strokeWidth={2.4} /> : <Copy size={14} strokeWidth={1.8} />}
                    </motion.span>
                  </AnimatePresence>
                  {copied ? "Copied" : "Copy"}
                </button>
              </div>
              <div className={`share-state ${status ?? "idle"}`}>
                <span className={`live-dot ${status === "syncing" ? "is-syncing" : ""} ${status === "error" || session?.status === "offline" ? "is-error" : ""}`} />
                {status === "error" || session?.status === "offline"
                  ? "Can't reach the server — retrying"
                  : status === "syncing"
                    ? "Syncing your latest edits…"
                    : session && canEdit
                      ? "Live — you're writing this together"
                      : "Live — they'll see your edits as you make them"}
                {session && <Presence session={session} withNames />}
              </div>
              <PeoplePanel anchor={anchor} />
              <div className="share-actions">
                {typeof navigator.share === "function" && (
                  <button type="button" className="ghost-btn" onClick={() => void sendNative()}>
                    <Send size={13} strokeWidth={1.8} /> Send…
                  </button>
                )}
                <button type="button" className="ghost-btn danger" disabled={busy === "stop"} onClick={() => void stop()}>
                  {busy === "stop" ? "Turning off…" : "Stop sharing"}
                </button>
              </div>
            </motion.div>
          ) : (
            <motion.div key="new" className="share-new" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.2 }}>
              <label className="share-name">
                <span className="share-name-label">From</span>
                <input value={name} placeholder="Your name (optional)" maxLength={40} onChange={(e) => setName(e.target.value)} onBlur={commitName} />
              </label>
              <button type="button" className="primary-btn wide" disabled={busy === "create" || nothing} onClick={() => void create()}>
                {busy === "create" ? (
                  <>
                    <span className="spinner" /> Encrypting…
                  </>
                ) : (
                  "Create link"
                )}
              </button>
            </motion.div>
          )}
        </AnimatePresence>

        {error && <div className="share-error">{error}</div>}
        <p className="share-foot">Anyone with the link can view. The key lives inside the link itself, so the server only ever stores scrambled data.</p>
      </div>
    </Popover>
  );
}
