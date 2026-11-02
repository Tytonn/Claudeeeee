import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, MotionConfig, motion } from "motion/react";
import { RotateCcw, SquarePen, Trash2 } from "lucide-react";
import type { Editor } from "@tiptap/core";
import { app, useApp } from "../store/app";
import { toast } from "../store/toasts";
import { useIsMobile, useNow } from "../lib/hooks";
import { ALT, MOD, isMac } from "../lib/theme";
import { displayTitle } from "../lib/text";
import { relativeLong } from "../lib/dates";
import { flushEditor, newNote, selectAdjacent, trashNote } from "../lib/actions";
import { play } from "../lib/sound";
import { Sidebar } from "./Sidebar";
import { TopBar } from "./TopBar";
import { Rail } from "./Rail";
import { NoteEditor } from "./editor/NoteEditor";
import { ShareView } from "../share/ShareView";
import { LINK_EVENT } from "./editor/BubbleBar";
import { useSlash } from "./editor/slash";
import { CommandPalette } from "./overlays/CommandPalette";
import { SettingsModal } from "./overlays/Settings";
import { ShortcutsModal } from "./overlays/Shortcuts";
import { AccountModal } from "../account/AccountModal";
import { VaultModal } from "./overlays/Vault";
import { Toasts } from "./overlays/Toasts";
import { Eclipse } from "./ui/Eclipse";
import { ErrorBoundary } from "./ErrorBoundary";
import { fx } from "../fx/engine";
import { peekEntrance, resetEntrance } from "../fx/intent";
import { Kbd } from "./ui/Kbd";

function useGlobalShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const s = app();
      const mod = isMac ? e.metaKey : e.ctrlKey;
      const target = e.target as HTMLElement | null;
      const typing = !!target?.closest?.("input, textarea, [contenteditable='true']");
      const key = e.key.toLowerCase();

      if (mod && !e.shiftKey && !e.altKey && key === "k") {
        e.preventDefault();
        const ed = (window as unknown as { __umbraEditor?: Editor }).__umbraEditor;
        if (ed && ed.isFocused && !ed.state.selection.empty && !s.ui.palette) {
          window.dispatchEvent(new Event(LINK_EVENT));
          return;
        }
        s.setUI({ palette: !s.ui.palette });
        return;
      }
      if (e.altKey && !mod && !e.shiftKey && e.code === "KeyN") {
        e.preventDefault();
        newNote();
        return;
      }
      if (mod && !e.altKey && e.key === "\\") {
        e.preventDefault();
        s.setSettings({ sidebar: !s.settings.sidebar });
        return;
      }
      if (mod && !e.altKey && e.key === ".") {
        e.preventDefault();
        if (s.settings.todos || s.settings.countdowns) s.setSettings({ rail: !s.settings.rail });
        return;
      }
      if (mod && e.shiftKey && e.code === "KeyF") {
        e.preventDefault();
        s.setUI({ focus: !s.ui.focus });
        return;
      }
      if (mod && !e.shiftKey && e.key === ",") {
        e.preventDefault();
        s.setUI({ settings: true });
        return;
      }
      if (mod && !e.shiftKey && !e.altKey && key === "s") {
        e.preventDefault();
        flushEditor();
        toast("Saved — it always is, automatically", { tone: "success", duration: 1600 });
        return;
      }
      if (e.altKey && !mod && (e.key === "ArrowUp" || e.key === "ArrowDown") && !typing) {
        e.preventDefault();
        selectAdjacent(e.key === "ArrowUp" ? -1 : 1);
        return;
      }
      if (!typing && !mod && e.key === "?") {
        e.preventDefault();
        s.setUI({ shortcuts: true });
      }
    };
    // Esc leaves focus mode — unless something else (slash menu, a field) already used it.
    const onKeyUpEsc = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      const s = app();
      if (s.ui.focus && !useSlash.getState().open) s.setUI({ focus: false });
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("keydown", onKeyUpEsc);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keydown", onKeyUpEsc);
    };
  }, []);
}

/**
 * While you write, the chrome dims (if enabled) and the sky holds its breath;
 * both come back the moment the mouse moves.
 */
function useTypingFade(enabled: boolean) {
  useEffect(() => {
    const root = document.documentElement;
    if (!enabled) delete root.dataset.typing;
    let x = -1;
    let y = -1;
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (!t?.closest?.(".note")) return;
      if (e.key.length === 1 || e.key === "Backspace" || e.key === "Enter") {
        fx.setCalm(true);
        if (enabled) root.dataset.typing = "1";
      }
    };
    const onMove = (e: PointerEvent) => {
      if (x >= 0 && Math.abs(e.clientX - x) + Math.abs(e.clientY - y) > 6) {
        delete root.dataset.typing;
        fx.setCalm(false);
      }
      x = e.clientX;
      y = e.clientY;
    };
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("pointermove", onMove, { passive: true });
    return () => {
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("pointermove", onMove);
      delete root.dataset.typing;
    };
  }, [enabled]);
}

function EmptyState() {
  return (
    <motion.div className="empty" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}>
      <div className="empty-mark">
        <Eclipse progress={1} size={88} />
      </div>
      <h2 className="empty-title display">A quiet page.</h2>
      <p className="empty-sub">Nothing open. Start something new, or pick a note.</p>
      <button type="button" className="primary-btn" onClick={() => newNote()}>
        <SquarePen size={14} strokeWidth={1.8} /> New note
      </button>
      <div className="empty-hints mono">
        <span>
          <Kbd keys={`${ALT} N`} subtle /> new
        </span>
        <span>
          <Kbd keys={`${MOD} K`} subtle /> search
        </span>
      </div>
    </motion.div>
  );
}

function TrashView() {
  const notes = useApp((s) => s.notes);
  const unlocked = useApp((s) => s.ui.unlocked);
  const restore = useApp((s) => s.restoreNote);
  const destroy = useApp((s) => s.destroyNote);
  const empty = useApp((s) => s.emptyTrash);
  const now = useNow(60_000);
  // Hidden notes stay out of the trash too, unless they're unlocked.
  const trashed = useMemo(
    () => Object.values(notes).filter((n) => n.deletedAt && (unlocked || !n.hidden)).sort((a, b) => (b.deletedAt ?? 0) - (a.deletedAt ?? 0)),
    [notes, unlocked],
  );
  const [confirm, setConfirm] = useState(false);

  return (
    <motion.div className="trash" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}>
      <header className="trash-head">
        <div>
          <h1 className="display">Trash</h1>
          <p className="trash-sub">Notes here are deleted for good after 30 days.</p>
        </div>
        {trashed.length > 0 && (
          <button
            type="button"
            className={`ghost-btn danger ${confirm ? "is-armed" : ""}`}
            onClick={() => {
              if (!confirm) {
                setConfirm(true);
                window.setTimeout(() => setConfirm(false), 3000);
                return;
              }
              empty();
              play("drop");
              setConfirm(false);
              toast("Trash emptied");
            }}
          >
            <Trash2 size={14} strokeWidth={1.8} /> {confirm ? "Click again to empty" : "Empty trash"}
          </button>
        )}
      </header>
      {trashed.length === 0 ? (
        <div className="trash-empty">Nothing in the trash.</div>
      ) : (
        <ul className="trash-list">
          <AnimatePresence initial={false}>
            {trashed.map((n) => (
              <motion.li key={n.id} layout className="trash-item" exit={{ opacity: 0, x: 10, transition: { duration: 0.16 } }}>
                <div className="trash-text">
                  <div className="trash-title">{displayTitle(n)}</div>
                  <div className="trash-meta mono">deleted {relativeLong(n.deletedAt ?? now, now)}</div>
                </div>
                <button
                  type="button"
                  className="ghost-btn sm"
                  onClick={() => {
                    restore(n.id);
                    toast("Restored", { tone: "success" });
                  }}
                >
                  <RotateCcw size={13} strokeWidth={1.8} /> Restore
                </button>
                <button
                  type="button"
                  className="ghost-btn sm danger"
                  onClick={() => {
                    destroy(n.id);
                    play("drop");
                  }}
                >
                  Delete forever
                </button>
              </motion.li>
            ))}
          </AnimatePresence>
        </ul>
      )}
    </motion.div>
  );
}

export function Workspace() {
  const settings = useApp((s) => s.settings);
  const activeId = useApp((s) => s.ui.activeId);
  const view = useApp((s) => s.ui.view);
  const focus = useApp((s) => s.ui.focus);
  const openShared = useApp((s) => (s.ui.openShared ? (s.shared[s.ui.openShared] ?? null) : null));
  const mobilePane = useApp((s) => s.ui.mobile);
  const isMobile = useIsMobile();
  const [scroller, setScroller] = useState<HTMLDivElement | null>(null);
  const panelRef = useRef<HTMLElement>(null);

  // The editor panel is the moon; the corona pours out from behind it.
  useEffect(() => {
    fx.setPanel(panelRef.current);
    return () => fx.setPanel(null);
  }, []);

  // How this note arrives: a dawn for new notes, a focus pull when switching.
  const entrance = useMemo(() => peekEntrance(), [activeId]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => resetEntrance(), [activeId]);

  useGlobalShortcuts();
  useTypingFade(settings.fadeWhileTyping && !isMobile);

  // The browser tab follows the open note.
  const tabTitle = useApp((s) => {
    const n = s.ui.activeId ? s.notes[s.ui.activeId] : undefined;
    return s.ui.view === "trash" ? "Trash" : n && !n.deletedAt ? displayTitle(n) : "";
  });
  useEffect(() => {
    document.title = tabTitle ? `${tabTitle} · umbra` : "umbra";
  }, [tabTitle]);

  const railFeature = settings.todos || settings.countdowns;
  const showSidebar = !isMobile && settings.sidebar && !focus;
  const showRail = !isMobile && railFeature && settings.rail && !focus;

  return (
    <MotionConfig reducedMotion="user">
      <div
        className={`app ${showSidebar ? "has-sidebar" : ""} ${showRail ? "has-rail" : ""} ${focus ? "is-focus" : ""} ${isMobile ? "is-mobile" : ""}`}
        data-pane={isMobile ? mobilePane : undefined}
      >
        <Sidebar />
        <main className="canvas" ref={panelRef} data-light>
          <div className="canvas-glow" aria-hidden />
          <TopBar />
          <div className="canvas-scroll" ref={setScroller}>
            {view === "trash" ? (
              <TrashView />
            ) : openShared ? (
              // A note someone shared with you, right here in your editor (live, if they let you edit).
              <div key={`shared-${openShared.id}`} className="note-wrap enter-focus">
                <ShareView embedded id={openShared.id} keyRaw={openShared.key} />
              </div>
            ) : activeId ? (
              // Keyed (no exit animation): the next note mounts instantly — so the caret is
              // ready at once — and arrives with its entrance (dawn / focus pull / plain).
              <div key={activeId} className={`note-wrap enter-${entrance}`}>
                <ErrorBoundary
                  fallback={
                    <div className="note-broken">
                      <h2 className="display">This note couldn't be opened.</h2>
                      <p>Something in it isn't readable. Your other notes are fine.</p>
                      <button type="button" className="ghost-btn" onClick={() => trashNote(activeId)}>
                        <Trash2 size={14} strokeWidth={1.8} /> Move it to trash
                      </button>
                    </div>
                  }
                >
                  <NoteEditor noteId={activeId} scroller={scroller} />
                </ErrorBoundary>
              </div>
            ) : (
              <EmptyState />
            )}
          </div>
        </main>
        <Rail />
        <CommandPalette />
        <SettingsModal />
        <ShortcutsModal />
        <AccountModal />
        <VaultModal />
        <Toasts />
      </div>
    </MotionConfig>
  );
}
