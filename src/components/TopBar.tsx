import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ArrowLeft, Check, Ellipsis, Maximize2, Minimize2, PanelLeft, PanelRight, Share } from "lucide-react";
import { useApp } from "../store/app";
import { useShareStatus } from "../store/shareSync";
import { relativeLong } from "../lib/dates";
import { useIsMobile, useNow } from "../lib/hooks";
import { MOD, SHIFT } from "../lib/theme";
import { openShare } from "../lib/actions";
import { IconButton } from "./ui/IconButton";
import { Tooltip } from "./ui/Tooltip";
import { Popover } from "./ui/Popover";
import { Menu } from "./ui/Menu";
import { noteMenuItems } from "./Sidebar";
import { ShareSheet } from "./overlays/ShareSheet";

function SaveStatus({ noteId }: { noteId: string }) {
  const savedAt = useApp((s) => s.ui.savedAt);
  const updatedAt = useApp((s) => s.notes[noteId]?.updatedAt ?? 0);
  const now = useNow(20_000);
  const [flash, setFlash] = useState(false);
  const first = useRef(true);

  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    if (!savedAt) return;
    setFlash(true);
    const t = window.setTimeout(() => setFlash(false), 1500);
    return () => window.clearTimeout(t);
  }, [savedAt]);

  return (
    <div className="save-status mono" aria-live="polite">
      <AnimatePresence mode="wait" initial={false}>
        {flash ? (
          <motion.span key="saved" className="save-saved" initial={{ opacity: 0, y: 3 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -3 }} transition={{ duration: 0.16 }}>
            <Check size={11} strokeWidth={2.4} /> Saved
          </motion.span>
        ) : (
          <motion.span key="edited" initial={{ opacity: 0, y: 3 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -3 }} transition={{ duration: 0.16 }}>
            {updatedAt ? `Edited ${relativeLong(updatedAt, now)}` : ""}
          </motion.span>
        )}
      </AnimatePresence>
    </div>
  );
}

export function TopBar() {
  const activeId = useApp((s) => s.ui.activeId);
  const view = useApp((s) => s.ui.view);
  const note = useApp((s) => (s.ui.activeId ? s.notes[s.ui.activeId] : undefined));
  const settings = useApp((s) => s.settings);
  const focus = useApp((s) => s.ui.focus);
  const shareAnchor = useApp((s) => s.ui.share);
  const shared = useApp((s) => Boolean(activeId && s.shares[activeId]));
  const status = useShareStatus((s) => (activeId ? s[activeId] : undefined));
  const setUI = useApp((s) => s.setUI);
  const setSettings = useApp((s) => s.setSettings);
  const isMobile = useIsMobile();
  const shareBtn = useRef<HTMLButtonElement>(null);
  const moreBtn = useRef<HTMLButtonElement>(null);
  const [moreOpen, setMoreOpen] = useState(false);

  const railFeature = settings.todos || settings.countdowns;
  const showNoteTools = view === "notes" && note && !note.deletedAt;

  return (
    <div className="topbar">
      <div className="topbar-left">
        {isMobile ? (
          <IconButton label="All notes" tooltip={false} onClick={() => setUI({ mobile: "list" })}>
            <ArrowLeft size={17} strokeWidth={1.7} />
          </IconButton>
        ) : (
          !focus && (
            <IconButton label={settings.sidebar ? "Hide sidebar" : "Show sidebar"} kbd={`${MOD} \\`} onClick={() => setSettings({ sidebar: !settings.sidebar })}>
              <PanelLeft size={16} strokeWidth={1.7} />
            </IconButton>
          )
        )}
      </div>

      <div className="topbar-right">
        {showNoteTools && activeId && <SaveStatus noteId={activeId} />}
        {showNoteTools && activeId && (
          <>
            <Tooltip label={shared ? "Shared — manage link" : "Share this note"}>
              <button
                ref={shareBtn}
                type="button"
                className={`pill-btn ${shared ? "is-live" : ""} ${shareAnchor === activeId ? "is-open" : ""}`}
                onClick={() => (shareAnchor === activeId ? setUI({ share: null }) : openShare(activeId))}
              >
                {shared ? <span className={`live-dot ${status === "syncing" ? "is-syncing" : ""} ${status === "error" ? "is-error" : ""}`} /> : <Share size={14} strokeWidth={1.8} />}
                <span>{shared ? "Live" : "Share"}</span>
              </button>
            </Tooltip>
            <IconButton ref={moreBtn} label="More" onClick={() => setMoreOpen((v) => !v)} active={moreOpen}>
              <Ellipsis size={17} strokeWidth={1.7} />
            </IconButton>
            <Popover open={moreOpen && !!note} onClose={() => setMoreOpen(false)} anchor={moreBtn.current} placement="bottom-end" role="menu">
              {note && <Menu items={noteMenuItems(note, { share: false })} onClose={() => setMoreOpen(false)} />}
            </Popover>
          </>
        )}
        {!isMobile && (
          <IconButton label={focus ? "Exit focus" : "Focus mode"} kbd={`${MOD} ${SHIFT} F`} onClick={() => setUI({ focus: !focus })} active={focus}>
            {focus ? <Minimize2 size={15} strokeWidth={1.7} /> : <Maximize2 size={15} strokeWidth={1.7} />}
          </IconButton>
        )}
        {railFeature && !focus && (
          <IconButton
            label={isMobile ? "To-dos & countdowns" : settings.rail ? "Hide panel" : "Show panel"}
            kbd={isMobile ? undefined : `${MOD} .`}
            onClick={() => (isMobile ? setUI({ mobile: "rail" }) : setSettings({ rail: !settings.rail }))}
          >
            <PanelRight size={16} strokeWidth={1.7} />
          </IconButton>
        )}
      </div>

      {activeId && (
        <ShareSheet anchor={activeId} open={shareAnchor === activeId} anchorEl={shareBtn.current} onClose={() => setUI({ share: null })} />
      )}
    </div>
  );
}
