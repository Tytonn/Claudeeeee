import { useMemo, useRef, useState } from "react";
import { AnimatePresence, LayoutGroup, motion } from "motion/react";
import {
  CalendarCheck2,
  ChevronRight,
  Copy,
  Download,
  ExternalLink,
  Eye,
  EyeOff,
  FileDown,
  FileText,
  Folder,
  FolderInput,
  FolderMinus,
  FolderPlus,
  KeyRound,
  Keyboard,
  Link2,
  Lock,
  LockOpen,
  MoreHorizontal,
  PenLine,
  Pin,
  PinOff,
  Plus,
  Search,
  Settings2,
  SquarePen,
  Trash2,
  Users,
  X,
} from "lucide-react";
import { useApp } from "../store/app";
import type { Note, NoteGroup } from "../lib/types";
import { displayTitle } from "../lib/text";
import { shortStamp } from "../lib/dates";
import { useNow } from "../lib/hooks";
import { ALT, MOD } from "../lib/theme";
import { ease, spring } from "../lib/motion";
import {
  copyMarkdown,
  deleteGroup,
  downloadMarkdown,
  duplicateNote,
  flushEditor,
  moveNote,
  newGroup,
  newNote,
  newNoteInGroup,
  openSearch,
  openShare,
  togglePin,
  trashNote,
} from "../lib/actions";
import { exportPdf } from "../lib/print";
import { hideNote, lockHidden, unhideNote } from "../lib/vault";
import { sidebarSections, type Section } from "../lib/noteList";
import { Logo } from "./ui/Eclipse";
import { IconButton } from "./ui/IconButton";
import { Kbd } from "./ui/Kbd";
import { Menu, type MenuItem } from "./ui/Menu";
import { Popover, pointAnchor } from "./ui/Popover";
import { fx } from "../fx/engine";
import { AccountButton } from "../account/AccountModal";
import { navigate } from "../lib/router";
import { toast } from "../store/toasts";
import { BUILD_SHA, VERSION } from "../version";
import { touchScreen, useLongPress } from "../lib/longPress";

export function noteMenuItems(note: Note, opts: { share?: boolean } = {}): MenuItem[] {
  const { groups, ui } = useApp.getState();
  const moveTo: MenuItem[] = [
    ...groups.map((g) => ({ label: g.name, icon: <Folder size={15} />, checked: note.groupId === g.id, onSelect: () => moveNote(note.id, g.id) }) as MenuItem),
    ...(note.groupId ? [{ label: "No group", icon: <FolderMinus size={15} />, onSelect: () => moveNote(note.id, null) } as MenuItem] : []),
    ...(groups.length ? (["divider"] as MenuItem[]) : []),
    { label: "New group…", icon: <FolderPlus size={15} />, onSelect: () => newGroup(note.id) },
  ];
  return [
    { label: note.pinned ? "Unpin" : "Pin to top", icon: note.pinned ? <PinOff size={15} /> : <Pin size={15} />, onSelect: () => togglePin(note.id) },
    ...(opts.share !== false ? [{ label: "Share…", icon: <Link2 size={15} />, onSelect: () => openShare(note.id) } as MenuItem] : []),
    { label: "Duplicate", icon: <Copy size={15} />, onSelect: () => duplicateNote(note.id) },
    ...(note.hidden ? [] : [{ label: "Move to group", icon: <FolderInput size={15} />, submenu: moveTo } as MenuItem]),
    // Hiding is only on offer while the hidden notes are unlocked (in the accent, so it's easy to spot).
    ...(!ui.unlocked
      ? []
      : [
          note.hidden
            ? ({ label: "Unhide", icon: <Eye size={15} />, accent: true, onSelect: () => unhideNote(note.id) } as MenuItem)
            : ({ label: "Hide note", icon: <EyeOff size={15} />, accent: true, onSelect: () => hideNote(note.id) } as MenuItem),
        ]),
    "divider",
    { label: "Copy as Markdown", icon: <FileText size={15} />, onSelect: () => void copyMarkdown(note.id) },
    { label: "Download .md", icon: <Download size={15} />, onSelect: () => downloadMarkdown(note.id) },
    { label: "Export as PDF…", icon: <FileDown size={15} />, onSelect: () => void exportPdf(note.id) },
    "divider",
    { label: "Move to trash", icon: <Trash2 size={15} />, danger: true, onSelect: () => trashNote(note.id) },
  ];
}

/** A note someone shared with you, in your list: open it, or (right-click, hold, or ···) its menu. */
function SharedRow({ id, title, from, active, menuOpen, onOpen, onMenu }: { id: string; title: string; from: string; active: boolean; menuOpen: boolean; onOpen: () => void; onMenu: (x: number, y: number) => void }) {
  const hold = useLongPress(onMenu);
  return (
    <motion.button
      layout="position"
      transition={spring}
      type="button"
      data-shared-id={id}
      className={`sb-item sb-shared-item ${active ? "is-active" : ""} ${menuOpen ? "is-menu" : ""}`}
      aria-current={active ? "page" : undefined}
      onClick={onOpen}
      onContextMenu={(e) => {
        e.preventDefault();
        onMenu(e.clientX, e.clientY);
      }}
      {...hold}
    >
      {active && <motion.span layoutId="sb-active" className="sb-item-bg" transition={spring} />}
      <span className="sb-item-title">{title}</span>
      <span className="sb-item-from mono">{from}</span>
      <RowMore label={`${title} options`} onOpen={onMenu} />
    </motion.button>
  );
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
      {list.map((l) => (
        <SharedRow
          key={l.id}
          id={l.id}
          title={l.title || "Untitled"}
          from={l.from ? l.from.split(/\s+/)[0] : ""}
          active={view === "notes" && openShared === l.id}
          menuOpen={menu?.id === l.id}
          onOpen={() => {
            flushEditor();
            setUI({ openShared: l.id, view: "notes", mobile: "editor" });
          }}
          onMenu={(x, y) => setMenu({ id: l.id, x, y })}
        />
      ))}
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


type RowProps = {
  note: Note;
  active: boolean;
  menuOpen: boolean;
  shared: boolean;
  now: number;
  draggable: boolean;
  onMenu: (id: string, x: number, y: number) => void;
};

/** One note in the list. */
/**
 * On a touch screen, a row's own "···": a phone can't right-click, so its menu needs a way in
 * (holding a finger on the row works too). It lives inside the row's button, so it's a span.
 */
function RowMore({ label, onOpen }: { label: string; onOpen: (x: number, y: number) => void }) {
  if (!touchScreen) return null;
  return (
    <span
      className="sb-item-more"
      role="button"
      aria-label={label}
      data-no-hold
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        const r = e.currentTarget.getBoundingClientRect();
        onOpen(r.left, r.bottom + 4);
      }}
    >
      <MoreHorizontal size={17} strokeWidth={2} />
    </span>
  );
}

function NoteRow({ note: n, active, menuOpen, shared, now, draggable, onMenu }: RowProps) {
  const activeId = useApp((s) => s.ui.activeId);
  const view = useApp((s) => s.ui.view);
  const hold = useLongPress((x, y) => onMenu(n.id, x, y));
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
      draggable={draggable && !touchScreen}
      className={`sb-item ${active ? "is-active" : ""} ${menuOpen ? "is-menu" : ""}`}
      {...hold}
      aria-current={active ? "page" : undefined}
      onClick={(e) => {
        flushEditor();
        // A streak of light carries the note across into the editor.
        if (fx.full && n.id !== activeId && !e.currentTarget.closest(".is-mobile")) {
          const r = e.currentTarget.getBoundingClientRect();
          const p = fx.panelRect;
          fx.trail({ x: r.right - 10, y: r.top + r.height / 2 }, { x: p.x + Math.min(150, p.w * 0.16), y: p.y + 150 }, undefined, { quiet: true, dur: 440 });
        }
        useApp.getState().selectNote(n.id);
        if (view !== "notes") useApp.getState().setUI({ view: "notes" });
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        onMenu(n.id, e.clientX, e.clientY);
      }}
    >
      {active && <motion.span layoutId="sb-active" className="sb-item-bg" transition={spring} />}
      <span className={`sb-item-title ${!n.title.trim() && !n.text.trim() ? "is-untitled" : ""}`}>{displayTitle(n)}</span>
      {shared && <span className="live-dot sm" aria-label="Shared" />}
      <span className="sb-item-time mono">{shortStamp(n.updatedAt, now)}</span>
      <RowMore label={`${displayTitle(n)} options`} onOpen={(x, y) => onMenu(n.id, x, y)} />
    </motion.button>
  );
}

/** A group's name, edited in place. */
function RenameField({ group }: { group: NoteGroup }) {
  const [value, setValue] = useState(group.name);
  const done = useRef(false);
  const commit = (save: boolean) => {
    if (done.current) return;
    done.current = true;
    const s = useApp.getState();
    if (save && value.trim()) s.renameGroup(group.id, value);
    s.setUI({ renaming: null });
  };
  return (
    <input
      className="sb-folder-input"
      value={value}
      maxLength={60}
      aria-label="Group name"
      autoFocus
      onFocus={(e) => e.currentTarget.select()}
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => commit(true)}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          commit(true);
        } else if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          commit(false);
        }
      }}
    />
  );
}

type ListProps = {
  notes: Note[];
  activeId: string | null;
  menuId: string | null;
  shares: Record<string, unknown>;
  now: number;
  canDrag: boolean;
  onMenu: (id: string, x: number, y: number) => void;
};

function Rows({ notes, activeId, menuId, shares, now, canDrag, onMenu }: ListProps) {
  const view = useApp((s) => s.ui.view);
  const openShared = useApp((s) => s.ui.openShared);
  return (
    <AnimatePresence initial={false}>
      {notes.map((n) => (
        <NoteRow
          key={n.id}
          note={n}
          active={view === "notes" && n.id === activeId && !openShared}
          menuOpen={menuId === n.id}
          shared={Boolean(shares[n.id])}
          now={now}
          draggable={canDrag && !n.pinned && !n.hidden}
          onMenu={onMenu}
        />
      ))}
    </AnimatePresence>
  );
}

/** A group of notes: folds up, takes notes dropped on it, and has a little menu of its own. */
function FolderSection({ section, list, dropping, onGroupMenu }: { section: Extract<Section, { kind: "group" }>; list: Omit<ListProps, "notes">; dropping: boolean; onGroupMenu: (id: string, x: number, y: number) => void }) {
  const { group, notes } = section;
  const renaming = useApp((s) => s.ui.renaming === group.id);
  const open = !group.collapsed;
  const hold = useLongPress((x, y) => onGroupMenu(group.id, x, y));
  return (
    <motion.section layout="position" transition={spring} className={`sb-group sb-folder ${dropping ? "is-drop" : ""} ${open ? "is-open" : ""}`} data-drop={`g:${group.id}`}>
      <div className="sb-folder-head" data-group-head={group.id}>
        {renaming ? (
          <span className="sb-folder-toggle is-editing">
            <ChevronRight size={13} strokeWidth={2} className={`chev ${open ? "is-open" : ""}`} />
            <RenameField group={group} />
          </span>
        ) : (
          <button
            type="button"
            className="sb-folder-toggle"
            aria-expanded={open}
            onClick={() => useApp.getState().setGroupCollapsed(group.id, open)}
            onDoubleClick={() => useApp.getState().setUI({ renaming: group.id })}
            onContextMenu={(e) => {
              e.preventDefault();
              onGroupMenu(group.id, e.clientX, e.clientY);
            }}
            {...hold}
          >
            <ChevronRight size={13} strokeWidth={2} className={`chev ${open ? "is-open" : ""}`} />
            <span className="sb-folder-name">{group.name}</span>
            <span className="sb-folder-count mono">{notes.length || ""}</span>
          </button>
        )}
        {!renaming && (
          <button
            type="button"
            className="sb-folder-more"
            aria-label={`${group.name} options`}
            onClick={(e) => {
              const r = e.currentTarget.getBoundingClientRect();
              onGroupMenu(group.id, r.left, r.bottom + 2);
            }}
          >
            <MoreHorizontal size={14} strokeWidth={1.8} />
          </button>
        )}
      </div>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            className="sb-folder-body"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.26, ease }}
          >
            {notes.length ? (
              <Rows notes={notes} {...list} />
            ) : (
              <div className="sb-folder-empty">{list.canDrag ? "Drag notes here" : "Move notes here from their ··· menu"}</div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </motion.section>
  );
}

/** Hidden notes, while they're unlocked: set apart, with a lock to put them away again. */
function VaultSection({ notes, list }: { notes: Note[]; list: Omit<ListProps, "notes"> }) {
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const anchor = useMemo(() => (menu ? pointAnchor(menu.x, menu.y) : null), [menu]);
  return (
    <motion.section
      layout="position"
      className="sb-group sb-vault"
      initial={{ opacity: 0, height: 0, filter: "blur(6px)" }}
      animate={{ opacity: 1, height: "auto", filter: "blur(0px)" }}
      exit={{ opacity: 0, height: 0, filter: "blur(6px)", transition: { duration: 0.3, ease } }}
      transition={{ duration: 0.5, ease }}
    >
      <div className="sb-vault-inner">
        <div className="sb-vault-head">
          <span className="sb-vault-label">
            <LockOpen size={12} strokeWidth={2} /> Hidden
          </span>
          {notes.length > 0 && <span className="sb-folder-count mono">{notes.length}</span>}
          <span className="flex" />
          <button
            type="button"
            className="sb-folder-more is-shown"
            aria-label="Hidden notes options"
            onClick={(e) => {
              const r = e.currentTarget.getBoundingClientRect();
              setMenu({ x: r.left, y: r.bottom + 2 });
            }}
          >
            <MoreHorizontal size={14} strokeWidth={1.8} />
          </button>
          <button type="button" className="sb-vault-lock" onClick={() => lockHidden()}>
            <Lock size={12} strokeWidth={2} /> Lock
          </button>
        </div>
        {notes.length ? <Rows notes={notes} {...list} /> : <div className="sb-folder-empty">Nothing hidden yet. Hide a note from its ··· menu.</div>}
      </div>
      <Popover open={Boolean(menu)} onClose={() => setMenu(null)} anchor={anchor} placement="bottom-start" offsetPx={4} role="menu">
        <Menu
          items={[
            { label: "Change PIN", icon: <KeyRound size={15} />, onSelect: () => useApp.getState().setUI({ vault: { mode: "change" } }) },
            { label: "Lock now", icon: <Lock size={15} />, onSelect: () => lockHidden() },
          ]}
          onClose={() => setMenu(null)}
        />
      </Popover>
    </motion.section>
  );
}

export function Sidebar() {
  const notes = useApp((s) => s.notes);
  const groups = useApp((s) => s.groups);
  const unlocked = useApp((s) => s.ui.unlocked);
  const activeId = useApp((s) => s.ui.activeId);
  const view = useApp((s) => s.ui.view);
  const shares = useApp((s) => s.shares);
  const setUI = useApp((s) => s.setUI);
  const railFeature = useApp((s) => s.settings.todos || s.settings.countdowns);
  const now = useNow(60_000);
  const [menu, setMenu] = useState<{ id: string; x: number; y: number } | null>(null);
  const [groupMenu, setGroupMenu] = useState<{ id: string; x: number; y: number } | null>(null);
  const [drag, setDrag] = useState<{ id: string; over: string | null } | null>(null);
  const canDrag = useMemo(() => typeof matchMedia !== "undefined" && matchMedia("(hover: hover) and (pointer: fine)").matches, []);

  const sections = useMemo(() => sidebarSections(notes, groups, unlocked, new Date(now)), [notes, groups, unlocked, now]);
  const hasNotes = sections.some((s) => s.kind !== "hidden" && s.notes.length) || groups.length > 0;
  const trashCount = useMemo(() => Object.values(notes).filter((n) => n.deletedAt && (unlocked || !n.hidden)).length, [notes, unlocked]);
  const menuNote = menu ? notes[menu.id] : null;
  const menuAnchor = useMemo(() => (menu ? pointAnchor(menu.x, menu.y) : null), [menu]);
  const groupMenuGroup = groupMenu ? groups.find((g) => g.id === groupMenu.id) : null;
  const groupMenuAnchor = useMemo(() => (groupMenu ? pointAnchor(groupMenu.x, groupMenu.y) : null), [groupMenu]);
  const openMenu = (id: string, x: number, y: number) => setMenu({ id, x, y });
  const list = { activeId, menuId: menu?.id ?? null, shares, now, canDrag, onMenu: openMenu };
  const dragged = drag ? notes[drag.id] : null;

  // Dragging a note onto a group files it there; onto the open list, takes it out of its group.
  const dropTarget = (e: React.DragEvent) => (e.target as Element).closest?.("[data-drop]")?.getAttribute("data-drop") ?? null;
  const onDragStart = (e: React.DragEvent) => {
    const id = (e.target as Element).closest?.("[data-note-id]")?.getAttribute("data-note-id");
    if (!id) return;
    e.dataTransfer.setData("text/x-umbra-note", id);
    e.dataTransfer.effectAllowed = "move";
    setDrag({ id, over: null });
  };
  const onDragOver = (e: React.DragEvent) => {
    if (!drag || !dragged) return;
    const t = dropTarget(e);
    const valid = t && (t === "none" ? Boolean(dragged.groupId) : t !== `g:${dragged.groupId}`);
    if (valid) {
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
    }
    const over = valid ? t : null;
    if (over !== drag.over) setDrag({ ...drag, over });
  };
  const onDrop = (e: React.DragEvent) => {
    const t = dropTarget(e);
    const id = drag?.id;
    setDrag(null);
    if (!t || !id) return;
    e.preventDefault();
    moveNote(id, t === "none" ? null : t.slice(2));
  };

  const showVersion = useApp((s) => s.settings.showVersion === true);
  return (
    <aside className="sidebar" aria-label="Notes">
      <div className="sidebar-inner">
        <header className="sb-head">
          <div className="brand">
            <Logo size={20} />
            <span className="wordmark display">umbra</span>
            {showVersion && (
              <span className="app-version" title={`umbra v${VERSION} · build ${BUILD_SHA}`}>
                v{VERSION}
              </span>
            )}
          </div>
          <div className="sb-head-actions">
            <IconButton label="Search" tooltip={false} className="sb-mobile-only" onClick={openSearch}>
              <Search size={17} strokeWidth={1.8} />
            </IconButton>
            <IconButton label="New group" onClick={() => newGroup()}>
              <FolderPlus size={16} strokeWidth={1.7} />
            </IconButton>
            <IconButton label="New note" kbd={`${ALT} N`} onClick={() => newNote()}>
              <SquarePen size={16} strokeWidth={1.7} />
            </IconButton>
          </div>
        </header>

        <button type="button" className="sb-search" data-light onClick={() => setUI({ palette: true })}>
          <Search size={14} strokeWidth={1.8} />
          <span>Search</span>
          <Kbd keys={`${MOD} K`} subtle />
        </button>

        <nav
          className={`sb-list ${drag ? "is-dragging" : ""}`}
          aria-label="All notes"
          onDragStart={onDragStart}
          onDragOver={onDragOver}
          onDragLeave={(e) => {
            if (drag && !e.currentTarget.contains(e.relatedTarget as Node)) setDrag({ ...drag, over: null });
          }}
          onDrop={onDrop}
          onDragEnd={() => setDrag(null)}
        >
          {!hasNotes && !unlocked && (
            <div className="sb-empty">
              <p className="display">No notes yet</p>
              <button type="button" className="link-btn" onClick={() => newNote()}>
                Write your first one
              </button>
            </div>
          )}
          <LayoutGroup id="sidebar">
            <SharedSection />
            <AnimatePresence initial={false}>
              {sections.map((sec) =>
                sec.kind === "hidden" ? (
                  <VaultSection key="hidden" notes={sec.notes} list={list} />
                ) : sec.kind === "group" ? (
                  <FolderSection key={sec.key} section={sec} list={list} dropping={drag?.over === sec.key} onGroupMenu={(id, x, y) => setGroupMenu({ id, x, y })} />
                ) : (
                  <motion.section
                    key={sec.key}
                    layout="position"
                    transition={spring}
                    className={`sb-group ${sec.kind === "date" && drag?.over === "none" ? "is-drop" : ""}`}
                    data-drop={sec.kind === "date" ? "none" : undefined}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0, transition: { duration: 0.12 } }}
                  >
                    <motion.div layout="position" transition={spring} className="sb-label label">
                      {sec.kind === "pinned" ? "Pinned" : sec.label}
                    </motion.div>
                    <Rows notes={sec.notes} {...list} />
                  </motion.section>
                ),
              )}
            </AnimatePresence>
          </LayoutGroup>
          {/* Somewhere to drop a note to take it out of its group, even when every note is filed. */}
          <AnimatePresence>
            {dragged?.groupId && !sections.some((s) => s.kind === "date") && (
              <motion.div
                key="ungroup"
                className={`sb-ungroup ${drag?.over === "none" ? "is-drop" : ""}`}
                data-drop="none"
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
              >
                Drop here to take it out of its group
              </motion.div>
            )}
          </AnimatePresence>
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
      <Popover open={Boolean(groupMenuGroup)} onClose={() => setGroupMenu(null)} anchor={groupMenuAnchor} placement="bottom-start" offsetPx={4} role="menu">
        {groupMenuGroup && (
          <Menu
            items={[
              { label: "New note here", icon: <SquarePen size={15} />, onSelect: () => newNoteInGroup(groupMenuGroup.id) },
              { label: "Rename", icon: <PenLine size={15} />, onSelect: () => setUI({ renaming: groupMenuGroup.id }) },
              "divider",
              { label: "Remove group", icon: <Trash2 size={15} />, danger: true, hint: "notes stay", onSelect: () => deleteGroup(groupMenuGroup.id) },
            ]}
            onClose={() => setGroupMenu(null)}
          />
        )}
      </Popover>
    </aside>
  );
}
