import { useMemo, useState } from "react";
import { AnimatePresence, LayoutGroup, motion } from "motion/react";
import { CalendarCheck2, Copy, Download, ExternalLink, FileText, Keyboard, Link2, Pin, PinOff, Plus, Search, Settings2, SquarePen, Trash2, Users, X } from "lucide-react";
import { sortedNotes, useApp } from "../store/app";
import type { Note } from "../lib/types";
import { displayTitle } from "../lib/text";
import { noteGroup, shortStamp } from "../lib/dates";
import { useNow } from "../lib/hooks";
import { ALT, MOD } from "../lib/theme";
import { spring } from "../lib/motion";
import { copyMarkdown, downloadMarkdown, duplicateNote, flushEditor, newNote, openSearch, openShare, togglePin, trashNote } from "../lib/actions";
import { Logo } from "./ui/Eclipse";
import { IconButton } from "./ui/IconButton";
import { Kbd } from "./ui/Kbd";
import { Menu, type MenuItem } from "./ui/Menu";
import { Popover, pointAnchor } from "./ui/Popover";
import { fx } from "../fx/engine";
import { AccountButton } from "../account/AccountModal";
import { navigate } from "../lib/router";
import { toast } from "../store/toasts";

export function noteMenuItems(note: Note, opts: { share?: boolean } = {}): MenuItem[] {
  return [
    { label: note.pinned ? "Unpin" : "Pin to top", icon: note.pinned ? <PinOff size={15} /> : <Pin size={15} />, onSelect: () => togglePin(note.id) },
    ...(opts.share !== false ? [{ label: "Share…", icon: <Link2 size={15} />, onSelect: () => openShare(note.id) } as MenuItem] : []),
    { label: "Duplicate", icon: <Copy size={15} />, onSelect: () => duplicateNote(note.id) },
    "divider",
    { label: "Copy as Markdown", icon: <FileText size={15} />, onSelect: () => void copyMarkdown(note.id) },
    { label: "Download .md", icon: <Download size={15} />, onSelect: () => downloadMarkdown(note.id) },
    "divider",
    { label: "Move to trash", icon: <Trash2 size={15} />, danger: true, onSelect: () => trashNote(note.id) },
  ];
}

type Group = { label: string; notes: Note[] };

function groupNotes(list: Note[]): Group[] {
  const groups: Group[] = [];
  const pinned = list.filter((n) => n.pinned);
  if (pinned.length) groups.push({ label: "Pinned", notes: pinned });
  const now = new Date();
  for (const n of list) {
    if (n.pinned) continue;
    const label = noteGroup(n.updatedAt, now);
    const last = groups[groups.length - 1];
    if (last && last.label === label) last.notes.push(n);
    else groups.push({ label, notes: [n] });
  }
  return groups;
}

/** Notes other people shared with you — so you can always get back to them. */
function SharedSection() {
  const shared = useApp((s) => s.shared);
  const openShared = useApp((s) => s.ui.openShared);
  const view = useApp((s) => s.ui.view);
  const setUI = useApp((s) => s.setUI);
  const [menu, setMenu] = useState<{ id: string; x: number; y: number } | null>(null);
  const list = useMemo(() => Object.values(shared).sort((a, b) => b.openedAt - a.openedAt), [shared]);
  const menuAnchor = useMemo(() => (menu ? pointAnchor(menu.x, menu.y) : null), [menu]);
  if (!list.length) return null;
  const menuLink = menu ? shared[menu.id] : null;
  return (
    <section className="sb-group sb-shared">
      <div className="sb-label label">
        <Users size={11} strokeWidth={2} /> Shared with you
      </div>
      {list.map((l) => {
        const active = view === "notes" && openShared === l.id;
        return (
          <motion.button
            key={l.id}
            layout="position"
            transition={spring}
            type="button"
            className={`sb-item sb-shared-item ${active ? "is-active" : ""}`}
            aria-current={active ? "page" : undefined}
            onClick={() => {
              flushEditor();
              setUI({ openShared: l.id, view: "notes", mobile: "editor" });
            }}
            onContextMenu={(e) => {
              e.preventDefault();
              setMenu({ id: l.id, x: e.clientX, y: e.clientY });
            }}
          >
            {active && <motion.span layoutId="sb-active" className="sb-item-bg" transition={spring} />}
            <span className="sb-item-title">{l.title || "Untitled"}</span>
            <span className="sb-item-from mono">{l.from ? l.from.split(/\s+/)[0] : ""}</span>
          </motion.button>
        );
      })}
      <Popover open={Boolean(menu && menuLink)} onClose={() => setMenu(null)} anchor={menuAnchor} placement="bottom-start" role="menu">
        {menuLink && (
          <Menu
            items={[
              { label: "Open full page", icon: <ExternalLink size={15} />, onSelect: () => navigate(`/s/${menuLink.id}#${menuLink.key}`) },
              {
                label: "Copy link",
                icon: <Link2 size={15} />,
                onSelect: () => void navigator.clipboard.writeText(`${location.origin}/s/${menuLink.id}#${menuLink.key}`).then(() => toast("Link copied", { tone: "success" })),
              },
              "divider",
              { label: "Remove from list", icon: <X size={15} />, danger: true, onSelect: () => useApp.getState().dropShared(menuLink.id) },
            ]}
            onClose={() => setMenu(null)}
          />
        )}
      </Popover>
    </section>
  );
}

export function Sidebar() {
  const notes = useApp((s) => s.notes);
  const activeId = useApp((s) => s.ui.activeId);
  const view = useApp((s) => s.ui.view);
  const openShared = useApp((s) => s.ui.openShared);
  const shares = useApp((s) => s.shares);
  const setUI = useApp((s) => s.setUI);
  const selectNote = useApp((s) => s.selectNote);
  const railFeature = useApp((s) => s.settings.todos || s.settings.countdowns);
  const now = useNow(60_000);
  const [menu, setMenu] = useState<{ id: string; x: number; y: number } | null>(null);

  const list = useMemo(() => sortedNotes(notes), [notes]);
  const groups = useMemo(() => groupNotes(list), [list]);
  const trashCount = useMemo(() => Object.values(notes).filter((n) => n.deletedAt).length, [notes]);
  const menuNote = menu ? notes[menu.id] : null;
  const menuAnchor = useMemo(() => (menu ? pointAnchor(menu.x, menu.y) : null), [menu]);

  return (
    <aside className="sidebar" aria-label="Notes">
      <div className="sidebar-inner">
        <header className="sb-head">
          <div className="brand">
            <Logo size={20} />
            <span className="wordmark display">umbra</span>
          </div>
          <div className="sb-head-actions">
            <IconButton label="Search" tooltip={false} className="sb-mobile-only" onClick={openSearch}>
              <Search size={17} strokeWidth={1.8} />
            </IconButton>
            <IconButton label="New note" kbd={`${ALT} N`} onClick={() => newNote()} data-magnetic>
              <SquarePen size={16} strokeWidth={1.7} />
            </IconButton>
          </div>
        </header>

        <button type="button" className="sb-search" data-light onClick={() => setUI({ palette: true })}>
          <Search size={14} strokeWidth={1.8} />
          <span>Search</span>
          <Kbd keys={`${MOD} K`} subtle />
        </button>

        <nav className="sb-list" aria-label="All notes">
          {list.length === 0 && (
            <div className="sb-empty">
              <p className="display">No notes yet</p>
              <button type="button" className="link-btn" onClick={() => newNote()}>
                Write your first one
              </button>
            </div>
          )}
          <LayoutGroup id="sidebar">
            <SharedSection />
            {groups.map((g) => (
              <section key={g.label} className="sb-group">
                <motion.div layout="position" transition={spring} className="sb-label label">
                  {g.label}
                </motion.div>
                <AnimatePresence initial={false}>
                  {g.notes.map((n) => {
                    const active = view === "notes" && n.id === activeId && !openShared;
                    return (
                      <motion.button
                        key={n.id}
                        layout="position"
                        transition={spring}
                        initial={{ opacity: 0, x: -6 }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0, x: -6, transition: { duration: 0.14 } }}
                        type="button"
                        data-note-id={n.id}
                        className={`sb-item ${active ? "is-active" : ""} ${menu?.id === n.id ? "is-menu" : ""}`}
                        aria-current={active ? "page" : undefined}
                        onClick={(e) => {
                          flushEditor();
                          // A streak of light carries the note across into the editor.
                          if (fx.full && n.id !== activeId && !e.currentTarget.closest(".is-mobile")) {
                            const r = e.currentTarget.getBoundingClientRect();
                            const p = fx.panelRect;
                            fx.trail({ x: r.right - 10, y: r.top + r.height / 2 }, { x: p.x + Math.min(150, p.w * 0.16), y: p.y + 150 }, undefined, { quiet: true, dur: 440 });
                          }
                          selectNote(n.id);
                          if (view !== "notes") setUI({ view: "notes" });
                        }}
                        onContextMenu={(e) => {
                          e.preventDefault();
                          setMenu({ id: n.id, x: e.clientX, y: e.clientY });
                        }}
                      >
                        {active && <motion.span layoutId="sb-active" className="sb-item-bg" transition={spring} />}
                        <span className={`sb-item-title ${!n.title.trim() && !n.text.trim() ? "is-untitled" : ""}`}>{displayTitle(n)}</span>
                        {shares[n.id] && <span className="live-dot sm" aria-label="Shared" />}
                        <span className="sb-item-time mono">{shortStamp(n.updatedAt, now)}</span>
                      </motion.button>
                    );
                  })}
                </AnimatePresence>
              </section>
            ))}
          </LayoutGroup>
        </nav>

        <footer className="sb-foot">
          <div className="sb-foot-left">
          <button
            type="button"
            className={`sb-foot-btn ${view === "trash" ? "is-active" : ""}`}
            onClick={() => {
              flushEditor();
              setUI({ view: view === "trash" ? "notes" : "trash", mobile: "editor" });
            }}
          >
            <Trash2 size={14} strokeWidth={1.7} />
            <span>Trash</span>
            {trashCount > 0 && <span className="sb-foot-count mono">{trashCount}</span>}
          </button>
          {railFeature && (
            <button type="button" className="sb-foot-btn sb-mobile-only" onClick={() => setUI({ mobile: "rail" })}>
              <CalendarCheck2 size={14} strokeWidth={1.7} />
              <span>Today</span>
            </button>
          )}
          </div>
          <div className="sb-foot-icons">
            <AccountButton />
            <IconButton label="Keyboard shortcuts" kbd="?" placement="top" onClick={() => setUI({ shortcuts: true })}>
              <Keyboard size={15} strokeWidth={1.7} />
            </IconButton>
            <IconButton label="Settings" kbd={`${MOD} ,`} placement="top" onClick={() => setUI({ settings: true })}>
              <Settings2 size={15} strokeWidth={1.7} />
            </IconButton>
          </div>
        </footer>
        <button type="button" className="sb-fab sb-mobile-only" aria-label="New note" onClick={() => newNote()}>
          <Plus size={22} strokeWidth={2} />
        </button>
      </div>

      <Popover open={!!menu && !!menuNote} onClose={() => setMenu(null)} anchor={menuAnchor} placement="bottom-start" offsetPx={4} role="menu">
        {menuNote && <Menu items={noteMenuItems(menuNote)} onClose={() => setMenu(null)} />}
      </Popover>
    </aside>
  );
}
