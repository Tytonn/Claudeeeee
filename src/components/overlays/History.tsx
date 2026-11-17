import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";
import { EditorContent, useEditor } from "@tiptap/react";
import { create } from "zustand";
import { ArrowLeft, Bookmark, Check, ChevronRight, Copy, CopyPlus, Ellipsis, History as HistoryIcon, ImageIcon, PenLine, RotateCcw, X } from "lucide-react";
import { isVisible, useApp } from "../../store/app";
import { toast } from "../../store/toasts";
import { Modal } from "../ui/Modal";
import { IconButton } from "../ui/IconButton";
import { Switch } from "../ui/Switch";
import { Popover } from "../ui/Popover";
import { Menu } from "../ui/Menu";
import { buildExtensions } from "../editor/extensions";
import { safeDoc } from "../editor/safeDoc";
import { authForNote } from "../../lib/images";
import { titleAttrs } from "../../lib/theme";
import { useIsMobile, useNow } from "../../lib/hooks";
import { dayDiff, formatTime } from "../../lib/dates";
import { displayTitle } from "../../lib/text";
import { spring } from "../../lib/motion";
import { listVersions, loadVersion, nameVersion, onHistory, restoreVersion, saveVersionNow, settleNote, versionHash, type VersionContent, type VersionMeta } from "../../lib/history";
import { blocksOf, diffBlocks, diffText, type DiffBlock, type Piece } from "../../lib/diff";

/**
 * Version history: a note's earlier versions, newest first, by day. Pick one to read it — with
 * what changed since the one before it marked (added words highlighted, taken-away ones struck
 * through), or as it looked — then restore it (Undo is right there), restore it as a new note,
 * copy it, or give it a name so it's kept for good.
 */

const useHistoryUI = create<{ noteId: string | null }>(() => ({ noteId: null }));

/** Opens a note's version history. */
export function openHistory(noteId: string) {
  // (whatever's still being typed is kept as a version first, so the list holds still while
  // you look through it)
  window.dispatchEvent(new Event("umbra:flush-editor"));
  void settleNote(noteId);
  useHistoryUI.setState({ noteId });
}

const closeHistory = () => useHistoryUI.setState({ noteId: null });

const CHANGES_KEY = "umbra:history-changes";
const readChanges = () => {
  try {
    return localStorage.getItem(CHANGES_KEY) !== "0";
  } catch {
    return true;
  }
};

// ── words for times ───────────────────────────────────────────────────────

function dayLabel(ts: number, now: number): string {
  const d = new Date(ts);
  const days = dayDiff(d, new Date(now));
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return d.toLocaleDateString(undefined, { weekday: "long" });
  return d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", year: d.getFullYear() === new Date(now).getFullYear() ? undefined : "numeric" });
}

/** "today at 3:42 PM", "yesterday at 9:02 PM", "Monday at 10:15 AM", "Nov 3 at 4:20 PM". */
function whenLong(ts: number, now = Date.now()): string {
  const d = new Date(ts);
  const days = dayDiff(d, new Date(now));
  const day = days === 0 ? "today" : days === 1 ? "yesterday" : days < 7 ? d.toLocaleDateString(undefined, { weekday: "long" }) : d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: d.getFullYear() === new Date(now).getFullYear() ? undefined : "numeric" });
  return `${day} at ${formatTime(d)}`;
}

const plural = (n: number, w: string) => `${n.toLocaleString()} ${w}${n === 1 ? "" : "s"}`;

/** How a version differs from the one before it, in a few words. */
function summary(v: { words: number }, older: { words: number } | undefined): string {
  if (!older) return "Earliest kept";
  const d = v.words - older.words;
  if (d > 0) return `+${plural(d, "word")}`;
  if (d < 0) return `−${plural(-d, "word")}`;
  return "Edited";
}

/** A version's story, where it has one: where it came from, or what came next. */
function story(v: VersionMeta, newer: { words: number } | undefined, now: number): string | null {
  if (v.source === "restore") return v.from ? `Restored from ${whenLong(v.from, now)}` : "Restored";
  if (v.source === "sync") return "From another device";
  if (v.why === "deletion") return newer && newer.words < v.words ? `Before ${plural(v.words - newer.words, "word")} were deleted` : "Before a big deletion";
  if (v.why === "restore") return "Before restoring";
  if (v.source === "saved" && !v.name) return "Saved by you";
  return null;
}

// ── the panel ─────────────────────────────────────────────────────────────

export function HistoryView() {
  const noteId = useHistoryUI((s) => s.noteId);
  const exists = useApp((s) => Boolean(noteId && isVisible(s.notes[noteId], s.ui.unlocked)));
  // (the note went away while its history was open — deleted, or hidden notes locked: nothing to show)
  useEffect(() => {
    if (noteId && !exists) closeHistory();
  }, [noteId, exists]);
  return (
    <Modal open={Boolean(noteId && exists)} onClose={closeHistory} label="Version history" className="history">
      {noteId && exists && <HistoryPanel key={noteId} noteId={noteId} />}
    </Modal>
  );
}

function useVersions(noteId: string): VersionMeta[] | null {
  const [list, setList] = useState<VersionMeta[] | null>(null);
  useEffect(() => {
    let alive = true;
    const load = () =>
      void listVersions(noteId)
        .then((l) => alive && setList(l))
        .catch(() => alive && setList([]));
    load();
    const off = onHistory(noteId, load);
    return () => {
      alive = false;
      off();
    };
  }, [noteId]);
  return list;
}

type Item = { id: "current"; at: number; words: number } | (VersionMeta & { current?: false });

function HistoryPanel({ noteId }: { noteId: string }) {
  const note = useApp((s) => s.notes[noteId]);
  const versions = useVersions(noteId);
  const isMobile = useIsMobile();
  const now = useNow(30_000);
  const [sel, setSel] = useState<string>("current");
  const [showChanges, setShowChanges] = useState(readChanges);
  const [pane, setPane] = useState<"list" | "preview">("list");
  const [naming, setNaming] = useState<HTMLElement | null>(null);
  const [more, setMore] = useState<HTMLElement | null>(null);
  const list = useRef<HTMLDivElement>(null);

  const currentWords = useMemo(() => (note ? blocksWords(note.title, note.text) : 0), [note]);
  // (the newest version kept is often the note just as it is: then that's the current version,
  // rather than the same thing twice)
  const currentHash = useMemo(() => (note ? versionHash({ title: note.title, doc: note.doc, text: note.text }) : ""), [note]);
  const topIsCurrent = Boolean(versions?.[0] && versions[0].hash === currentHash);
  const items: Item[] = useMemo(
    () => (topIsCurrent && versions ? versions : [{ id: "current" as const, at: now, words: currentWords }, ...(versions ?? [])]),
    [versions, currentWords, now, topIsCurrent],
  );
  const currentId = topIsCurrent && versions ? versions[0].id : "current";
  const selId = sel === "current" ? currentId : sel;
  const index = Math.max(0, items.findIndex((i) => i.id === selId));
  const selected = items[index];
  const older = items[index + 1] as VersionMeta | undefined;
  const isCurrent = selected.id === currentId;
  /** The selected version, unless it's the note as it is now. */
  const selMeta = selected.id === "current" || isCurrent ? null : (selected as VersionMeta);
  /** The selected version's own record (the current one's too, if it's been kept). */
  const selRecord = selected.id === "current" ? null : (selected as VersionMeta);

  // (a version gone — thinned out, say — falls back to the current one)
  useEffect(() => {
    if (versions && sel !== "current" && !versions.some((v) => v.id === sel)) setSel("current");
    else if (sel === currentId && sel !== "current") setSel("current");
  }, [versions, sel, currentId]);

  // What's being read, and what it's compared with.
  const [shown, setShown] = useState<{ id: string; content: VersionContent | null; base: VersionContent | null } | null>(null);
  useEffect(() => {
    if (!note) return;
    let alive = true;
    const cur: VersionContent = { title: note.title, doc: note.doc, text: note.text };
    const get = (id: string | undefined) => (!id ? Promise.resolve(null) : id === "current" ? Promise.resolve(cur) : loadVersion(noteId, id));
    void Promise.all([get(selected.id), get(older?.id)]).then(([content, base]) => {
      // (a version that can't be read back — from a browser that kept it differently — says so)
      if (alive) setShown({ id: selected.id, content, base });
    });
    return () => {
      alive = false;
    };
  }, [noteId, selected.id, older?.id, note]);

  const choose = (id: string) => {
    setSel(id === currentId ? "current" : id);
    if (isMobile) setPane("preview");
  };

  // ↑ ↓ through the versions (from anywhere in the panel, but a text field)
  const step = useRef<(d: number) => void>(() => {});
  step.current = (d: number) => {
    const id = items[Math.min(items.length - 1, Math.max(0, index + d))].id;
    setSel(id === currentId ? "current" : id);
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
      const t = e.target as HTMLElement | null;
      if (t?.closest?.("input, textarea, [contenteditable='true'], [data-floating-layer]")) return;
      e.preventDefault();
      step.current(e.key === "ArrowDown" ? 1 : -1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  useEffect(() => {
    list.current?.querySelector<HTMLElement>(`[data-version="${CSS.escape(isCurrent ? "current" : selected.id)}"]`)?.scrollIntoView({ block: "nearest" });
  }, [selected.id, isCurrent]);

  const toggleChanges = (v: boolean) => {
    setShowChanges(v);
    try {
      localStorage.setItem(CHANGES_KEY, v ? "1" : "0");
    } catch {
      /* fine */
    }
  };

  const unreadable = () => toast("This version couldn't be read on this device", { tone: "error" });

  const restore = async () => {
    if (!selMeta) return;
    if (!(await loadVersion(noteId, selMeta.id))) return unreadable();
    const before = await restoreVersion(noteId, selMeta.id);
    closeHistory();
    toast(`Restored the version from ${whenLong(selMeta.at)}`, {
      tone: "success",
      duration: 9000,
      action: before
        ? {
            label: "Undo",
            run: () => void restoreVersion(noteId, before.id).then(() => toast("Back to how it was")),
          }
        : undefined,
    });
  };

  const restoreAsCopy = async () => {
    if (!selMeta || !note) return;
    const c = await loadVersion(noteId, selMeta.id);
    if (!c) return unreadable();
    const stamp = new Date(selMeta.at).toLocaleDateString(undefined, { month: "short", day: "numeric" });
    useApp.getState().createNote({
      title: `${c.title || "Untitled"} (${stamp}, ${formatTime(new Date(selMeta.at))})`,
      doc: c.doc ? structuredClone(c.doc) : null,
      text: c.text,
      groupId: note.groupId ?? null,
      hidden: note.hidden === true,
      titleStyle: note.titleStyle ?? null,
    });
    closeHistory();
    toast("Restored as a new note — the original is just as it was", { tone: "success" });
  };

  const copy = async () => {
    const c = shown?.content;
    if (!c) return;
    try {
      await navigator.clipboard.writeText(c.title ? `${c.title}\n\n${c.text}` : c.text);
      toast("Copied");
    } catch {
      toast("Couldn't copy — select the words and copy them instead", { tone: "error" });
    }
  };

  if (!note) return null;
  const grouped = groupByDay(versions ?? [], now);
  const preview = (
    <section className="hv-preview" aria-label="Version">
      <header className="hv-banner">
        {isMobile && (
          <IconButton label="All versions" tooltip={false} onClick={() => setPane("list")}>
            <ArrowLeft size={17} strokeWidth={1.7} />
          </IconButton>
        )}
        <div className="hv-banner-text">
          <div className="hv-banner-when">
            {selRecord?.name && <span className="hv-banner-name">{selRecord.name}</span>}
            <span>{isCurrent ? "Current version" : cap(whenLong(selected.at, now))}</span>
          </div>
          <div className="hv-banner-sub mono">
            {plural(selected.words, "word")}
            {isCurrent && selRecord && <> · kept {whenLong(selRecord.at, now)}</>}
            {selMeta && story(selMeta, items[index - 1], now) && <> · {story(selMeta, items[index - 1], now)}</>}
            {showChanges && older && <> · compared with {dayDiff(new Date(older.at), new Date(selected.at)) === 0 ? formatTime(new Date(older.at)) : whenLong(older.at, now)}</>}
            {showChanges && !older && !isCurrent && <> · the earliest kept, so nothing to compare it with</>}
          </div>
        </div>
        <label className="hv-changes">
          <span>Show changes</span>
          <Switch checked={showChanges} onChange={toggleChanges} label="Show changes" />
        </label>
      </header>
      <div className="hv-scroll">
        <AnimatePresence mode="wait" initial={false}>
          {/* (only once the chosen version itself has loaded — never the last one, just opened) */}
          {shown && shown.id === selected.id && (
            <motion.div key={`${shown.id}:${showChanges ? 1 : 0}`} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, transition: { duration: 0.08 } }} transition={{ duration: 0.16 }}>
              {!shown.content ? (
                <div className="hv-same">This version couldn't be read on this device.</div>
              ) : showChanges && shown.base ? (
                <Changes noteId={noteId} content={shown.content} base={shown.base} />
              ) : (
                <AsItWas noteId={noteId} content={shown.content} />
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
      <footer className="hv-foot">
        {selMeta ? (
          <>
            <button type="button" className="primary-btn hv-restore" onClick={() => void restore()}>
              <RotateCcw size={14} strokeWidth={2} /> Restore this version
            </button>
            <button type="button" className="ghost-btn" onClick={() => void copy()}>
              <Copy size={14} strokeWidth={1.8} /> Copy
            </button>
            <span className="flex" />
            <IconButton label="More" onClick={(e) => setMore(e.currentTarget)} active={Boolean(more)}>
              <Ellipsis size={17} strokeWidth={1.7} />
            </IconButton>
          </>
        ) : (
          <>
            <button type="button" className="ghost-btn" onClick={(e) => setNaming(e.currentTarget)}>
              <Bookmark size={14} strokeWidth={1.8} /> Save this version…
            </button>
            <button type="button" className="ghost-btn" onClick={() => void copy()}>
              <Copy size={14} strokeWidth={1.8} /> Copy
            </button>
            <span className="flex" />
            <span className="hv-foot-hint">This is the note as it is now</span>
          </>
        )}
      </footer>
      <Popover open={Boolean(more)} onClose={() => setMore(null)} anchor={more} placement="top-end" role="menu">
        <Menu
          items={[
            { label: "Restore as a new note", icon: <CopyPlus size={15} />, onSelect: () => void restoreAsCopy() },
            { label: selMeta?.name ? "Rename this version…" : "Name this version…", icon: <PenLine size={15} />, onSelect: () => setNaming(more) },
            ...(selMeta?.name ? [{ label: "Remove its name", icon: <X size={15} />, onSelect: () => selMeta && void nameVersion(noteId, selMeta.id, "") }] : []),
          ]}
          onClose={() => setMore(null)}
        />
      </Popover>
      <NamePopover
        anchor={naming}
        initial={selRecord?.name ?? ""}
        current={!selMeta}
        onClose={() => setNaming(null)}
        onSave={(name) => {
          if (selMeta) void nameVersion(noteId, selMeta.id, name);
          else
            void saveVersionNow(noteId, name).then((v) => {
              if (v) {
                setSel(v.id);
                toast(name ? `Saved as “${name}” — it's kept for good` : "Saved this version", { tone: "success" });
              }
            });
        }}
      />
    </section>
  );

  const timeline = (
    <aside className="hv-list" ref={list} aria-label="Versions">
      {!topIsCurrent && (
        <button type="button" data-version="current" className={`hv-item is-current ${isCurrent ? "is-sel" : ""}`} onClick={() => choose("current")}>
          {isCurrent && <motion.span layoutId="hv-sel" className="hv-item-bg" transition={spring} />}
          <span className="hv-dot" />
          <span className="hv-main">
            <span className="hv-time">Current version</span>
            <span className="hv-sub">
              Now · {plural(currentWords, "word")}
              {versions?.[0] && <> · {summary({ words: currentWords }, versions[0])}</>}
            </span>
          </span>
          {isMobile && <ChevronRight size={15} className="hv-chev" />}
        </button>
      )}
      {versions === null ? (
        <div className="hv-loading" aria-hidden>
          {[0, 1, 2].map((i) => (
            <span key={i} className="hv-skel" style={{ animationDelay: `${i * 120}ms` }} />
          ))}
        </div>
      ) : versions.length === 0 ? (
        <div className="hv-empty">
          <HistoryIcon size={18} strokeWidth={1.6} />
          <p>Earlier versions will appear here as you write.</p>
          <p className="hv-empty-sub">One's kept whenever you pause, every few minutes while you keep going, when you leave the note, and before anything big.</p>
        </div>
      ) : (
        grouped.map(({ label, items: day }) => (
          <Fragment key={label}>
            <div className="hv-day label">{label}</div>
            {day.map((v) => {
              const i = items.findIndex((x) => x.id === v.id);
              const tale = story(v, items[i - 1], now);
              const here = v.id === currentId;
              return (
                <button key={v.id} type="button" data-version={here ? "current" : v.id} className={`hv-item ${selId === v.id ? "is-sel" : ""} ${here ? "is-current" : ""} ${v.name ? "is-named" : ""} ${v.source === "before" || v.why ? "is-safety" : ""}`} onClick={() => choose(v.id)}>
                  {selId === v.id && <motion.span layoutId="hv-sel" className="hv-item-bg" transition={spring} />}
                  <span className="hv-dot" />
                  <span className="hv-main">
                    <span className="hv-time">
                      {here ? "Current version" : formatTime(new Date(v.at))}
                      {v.name && <span className="hv-name">{v.name}</span>}
                    </span>
                    <span className="hv-sub">
                      {summary(v, items[i + 1] as VersionMeta | undefined)}
                      {tale && <> · {tale}</>}
                    </span>
                  </span>
                  {isMobile && <ChevronRight size={15} className="hv-chev" />}
                </button>
              );
            })}
          </Fragment>
        ))
      )}
      <p className="hv-keep">
        Kept on this device: everything from the last day, then one an hour for a week, one a day for a month and one a week for a year. Named versions are kept for good.
      </p>
    </aside>
  );

  return (
    <div className={`hv ${isMobile ? `is-phone is-${pane}` : ""}`}>
      <header className="hv-head">
        <HistoryIcon size={17} strokeWidth={1.7} className="hv-head-icon" />
        <div className="hv-head-text">
          <h2 className="hv-head-title display">Version history</h2>
          <span className="hv-head-note">{displayTitle(note)}</span>
        </div>
        <span className="flex" />
        <IconButton label="Close" kbd="Esc" onClick={closeHistory}>
          <X size={17} strokeWidth={1.7} />
        </IconButton>
      </header>
      <div className="hv-body">
        {(!isMobile || pane === "preview") && preview}
        {(!isMobile || pane === "list") && timeline}
      </div>
    </div>
  );
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function blocksWords(title: string, text: string): number {
  const m = `${title} ${text}`.match(/[\p{L}\p{N}][\p{L}\p{N}'’_-]*/gu);
  return m ? m.length : 0;
}

function groupByDay(versions: VersionMeta[], now: number): { label: string; items: VersionMeta[] }[] {
  const out: { label: string; items: VersionMeta[] }[] = [];
  for (const v of versions) {
    const label = dayLabel(v.at, now);
    const last = out[out.length - 1];
    if (last && last.label === label) last.items.push(v);
    else out.push({ label, items: [v] });
  }
  return out;
}

// ── naming a version ──────────────────────────────────────────────────────

function NamePopover({ anchor, initial, current, onClose, onSave }: { anchor: HTMLElement | null; initial: string; current: boolean; onClose: () => void; onSave: (name: string) => void }) {
  const [value, setValue] = useState(initial);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!anchor) return;
    setValue(initial);
    // (once the menu it was chosen from has closed and handed focus back: into the field)
    let raf = requestAnimationFrame(() => {
      raf = requestAnimationFrame(() => {
        const el = input.current;
        if (!el || document.activeElement === el) return;
        el.focus();
        // (the name there already, ready to type over — unless you've started typing)
        if (el.value === initial) el.select();
      });
    });
    return () => cancelAnimationFrame(raf);
  }, [anchor, initial]);
  return (
    <Popover open={Boolean(anchor)} onClose={onClose} anchor={anchor} placement="top-start" label="Name this version" className="hv-name-pop">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onSave(value.trim());
          onClose();
        }}
      >
        <div className="hv-name-label">{current ? "Save this version" : "Name this version"}</div>
        <input ref={input} autoFocus className="hv-name-input" value={value} maxLength={60} placeholder="e.g. First draft" onChange={(e) => setValue(e.target.value)} />
        <div className="hv-name-hint">{current ? "Give it a name to keep it for good — or save it as it is." : "Named versions are kept for good."}</div>
        <div className="hv-name-actions">
          <button type="button" className="ghost-btn sm" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="primary-btn sm">
            <Check size={13} strokeWidth={2.4} /> {current && !value.trim() ? "Save" : "Save name"}
          </button>
        </div>
      </form>
    </Popover>
  );
}

// ── reading a version ─────────────────────────────────────────────────────

/** A version as it looked: the note's own fonts, formatting and pictures (read-only). */
function AsItWas({ noteId, content }: { noteId: string; content: VersionContent }) {
  const titleStyle = useApp((s) => s.notes[noteId]?.titleStyle);
  const editor = useEditor(
    {
      editable: false,
      extensions: buildExtensions({ editable: false, imageAuth: () => authForNote(noteId) }),
      content: safeDoc(content.doc, content.text) ?? "",
      immediatelyRender: true,
      shouldRerenderOnTransaction: false,
      editorProps: { attributes: { class: "prose" } },
    },
    [noteId],
  );
  useEffect(() => {
    if (editor && !editor.isDestroyed) editor.commands.setContent(safeDoc(content.doc, content.text) ?? "", { emitUpdate: false });
  }, [editor, content]);
  return (
    <article className="note hv-doc" {...titleAttrs(titleStyle)}>
      <h1 className="note-title display hv-title">{content.title || <span className="hv-untitled">Untitled</span>}</h1>
      <EditorContent editor={editor} className="note-body" />
    </article>
  );
}

/** A version with what changed since the one before it: added words highlighted, taken-away ones struck through. */
function Changes({ noteId, content, base }: { noteId: string; content: VersionContent; base: VersionContent }) {
  const titleStyle = useApp((s) => s.notes[noteId]?.titleStyle);
  const blocks = useMemo(() => diffBlocks(blocksOf(base.doc, base.text), blocksOf(content.doc, content.text)), [base, content]);
  const title = useMemo(() => diffText(base.title, content.title), [base.title, content.title]);
  const changed = blocks.some((b) => b.op !== "same") || title.some((p) => p.op !== "same");
  const doc = useRef<HTMLElement>(null);
  // (straight to the first change, if it's out of sight)
  useEffect(() => {
    const first = doc.current?.querySelector<HTMLElement>(".is-add, .is-del, .is-mod, ins, del");
    const scroller = doc.current?.closest(".hv-scroll");
    if (!first || !scroller) return;
    const r = first.getBoundingClientRect();
    const s = scroller.getBoundingClientRect();
    if (r.top < s.top + 24 || r.bottom > s.bottom - 24) scroller.scrollTo({ top: scroller.scrollTop + r.top - s.top - s.height * 0.3, behavior: "smooth" });
  }, [blocks]);
  return (
    <article className="note hv-doc" ref={doc} {...titleAttrs(titleStyle)}>
      <h1 className="note-title display hv-title">{content.title || base.title ? <Pieces pieces={title} /> : <span className="hv-untitled">Untitled</span>}</h1>
      {!changed && <div className="hv-same">No changes in the words since the version before — only formatting, or nothing at all.</div>}
      <div className="note-body">
        <div className="prose hv-diff">
          {blocks.map((b, i) => (
            <DiffRow key={i} b={b} />
          ))}
        </div>
      </div>
    </article>
  );
}

function Pieces({ pieces }: { pieces: Piece[] }) {
  return (
    <>
      {pieces.map((p, i) =>
        p.op === "add" ? (
          <ins key={i} className="hv-ins">
            {p.text}
          </ins>
        ) : p.op === "del" ? (
          <del key={i} className="hv-del">
            {p.text}
          </del>
        ) : (
          <Fragment key={i}>{p.text}</Fragment>
        ),
      )}
    </>
  );
}

function DiffRow({ b }: { b: DiffBlock }) {
  const inner: ReactNode = b.op === "mod" && b.pieces ? <Pieces pieces={b.pieces} /> : b.text || <br />;
  const cls = `hv-b is-${b.op}`;
  const style = b.depth ? ({ "--depth": b.depth } as React.CSSProperties) : undefined;
  switch (b.kind) {
    case "h1":
      return <h1 className={cls}>{inner}</h1>;
    case "h2":
      return <h2 className={cls}>{inner}</h2>;
    case "h3":
      return <h3 className={cls}>{inner}</h3>;
    case "bullet":
    case "number":
    case "task":
      return (
        <div className={`${cls} hv-li`} style={style}>
          <span className="hv-marker" aria-hidden>
            {b.kind === "bullet" ? "•" : b.kind === "number" ? `${b.n ?? 1}.` : <span className={`hv-check ${b.checked ? "is-on" : ""} ${b.was && Boolean(b.was.checked) !== Boolean(b.checked) ? "is-flipped" : ""}`}>{b.checked && <Check size={10} strokeWidth={3} />}</span>}
          </span>
          <span className={`hv-li-text ${b.kind === "task" && b.checked ? "is-done" : ""}`}>{inner}</span>
        </div>
      );
    case "quote":
      return (
        <blockquote className={cls}>
          <p>{inner}</p>
        </blockquote>
      );
    case "code":
      return (
        <pre className={cls}>
          <code>{inner}</code>
        </pre>
      );
    case "rule":
      return <hr className={cls} />;
    case "image":
      return (
        <div className={`${cls} hv-image`}>
          <ImageIcon size={15} strokeWidth={1.7} /> Picture{b.text ? ` — ${b.text}` : ""}
        </div>
      );
    case "row":
      return <div className={`${cls} hv-row ${b.header ? "is-head" : ""}`}>{inner}</div>;
    default:
      return (
        <p className={cls} style={style}>
          {inner}
        </p>
      );
  }
}
