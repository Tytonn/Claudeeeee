import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { motion } from "motion/react";
import {
  Building2,
  CalendarPlus,
  CloudLightning,
  CloudRain,
  Moon,
  CornerDownLeft,
  Download,
  EyeOff,
  FileText,
  FolderPlus,
  Hourglass,
  Keyboard,
  ListChecks,
  Lock,
  LockOpen,
  Maximize2,
  MousePointer2,
  PanelLeft,
  PanelRight,
  Plus,
  Search,
  Settings2,
  Share,
  Sparkles,
  SquarePen,
  Trash2,
  Type,
  Volume2,
  VolumeX,
} from "lucide-react";
import { sortedNotes, useApp } from "../../store/app";
import { displayTitle, fuzzyScore, snippet } from "../../lib/text";
import { shortStamp } from "../../lib/dates";
import { ACCENTS, ALT, FONTS, MOD, SHIFT } from "../../lib/theme";
import type { AccentId, BackdropId, FontId, RainAmountId } from "../../lib/types";
import { NEW_COUNTDOWN_EVENT, flushEditor, newGroup, newNote, openShare } from "../../lib/actions";
import { lockHidden, openHidden } from "../../lib/vault";
import { exportAll } from "../../store/persist";
import { download } from "../../lib/actions";
import { spring } from "../../lib/motion";
import { Modal } from "../ui/Modal";
import { Kbd } from "../ui/Kbd";
import { changeScene } from "../../fx/transitions";

type Item = {
  id: string;
  group: string;
  label: string;
  sub?: string;
  meta?: string;
  icon: ReactNode;
  kbd?: string;
  keywords?: string;
  hidden?: boolean;
  run: () => void;
};

function Highlight({ text, query }: { text: string; query: string }) {
  const q = query.trim();
  if (!q) return <>{text}</>;
  const i = text.toLowerCase().indexOf(q.toLowerCase());
  if (i < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, i)}
      <mark>{text.slice(i, i + q.length)}</mark>
      {text.slice(i + q.length)}
    </>
  );
}

/** Typing "hidden" (and only that) brings up the way into hidden notes. */
const asksForHidden = (q: string) => {
  const t = q.trim().toLowerCase();
  return t.length >= 6 && ("hidden notes".startsWith(t) || t.startsWith("hidden"));
};

function useItems(query: string): Item[] {
  const notes = useApp((s) => s.notes);
  const groups = useApp((s) => s.groups);
  const unlocked = useApp((s) => s.ui.unlocked);
  const hasVault = useApp((s) => Boolean(s.vault));
  const settings = useApp((s) => s.settings);
  const activeId = useApp((s) => s.ui.activeId);
  const focus = useApp((s) => s.ui.focus);
  const now = Date.now();

  return useMemo(() => {
    const s = useApp.getState();
    const q = query.trim();
    const list = sortedNotes(notes, unlocked);
    const groupName = (n: (typeof list)[number]) => (n.groupId ? groups.find((g) => g.id === n.groupId)?.name : undefined);
    const noteIcon = (n: (typeof list)[number]) => (n.hidden ? <EyeOff size={15} strokeWidth={1.6} /> : <FileText size={15} strokeWidth={1.6} />);

    let noteItems: Item[];
    if (!q) {
      noteItems = [...list]
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .slice(0, 5)
        .map((n) => ({
          id: `note-${n.id}`,
          group: "Recent",
          label: displayTitle(n),
          meta: [groupName(n), shortStamp(n.updatedAt, now)].filter(Boolean).join(" · "),
          icon: noteIcon(n),
          run: () => {
            flushEditor();
            s.selectNote(n.id);
            s.setUI({ view: "notes" });
          },
        }));
    } else {
      noteItems = list
        .map((n) => {
          const title = displayTitle(n);
          const tScore = fuzzyScore(title, q) * 2;
          const bScore = n.text.toLowerCase().includes(q.toLowerCase()) ? 60 : 0;
          return { n, title, score: Math.max(tScore, bScore), inBody: bScore > 0 && tScore === 0 };
        })
        .filter((x) => x.score > 0)
        .sort((a, b) => b.score - a.score || b.n.updatedAt - a.n.updatedAt)
        .slice(0, 8)
        .map(({ n, title, inBody }) => ({
          id: `note-${n.id}`,
          group: "Notes",
          label: title,
          sub: inBody ? snippet(n.text, q, 36) : undefined,
          meta: [groupName(n), shortStamp(n.updatedAt, now)].filter(Boolean).join(" · "),
          icon: noteIcon(n),
          run: () => {
            flushEditor();
            s.selectNote(n.id);
            s.setUI({ view: "notes" });
          },
        }));
    }

    const toggle = (key: "todos" | "countdowns" | "sidebar" | "rail" | "sounds") => () => s.setSettings({ [key]: !s.settings[key] });
    const seeThrough = settings.backdrop === "clear" || settings.backdrop === "crystal" || settings.backdrop === "bare";

    const actions: Item[] = [
      { id: "new", group: "Actions", label: "New note", icon: <SquarePen size={15} strokeWidth={1.6} />, kbd: `${ALT} N`, keywords: "create add write", run: () => newNote() },
      { id: "new-group", group: "Actions", label: "New group…", icon: <FolderPlus size={15} strokeWidth={1.6} />, keywords: "folder group organize collection", run: () => newGroup() },
      ...(unlocked
        ? [{ id: "lock", group: "Actions", label: "Lock hidden notes", icon: <Lock size={15} strokeWidth={1.6} />, keywords: "hidden private vault pin", run: () => lockHidden() }]
        : []),
      ...(activeId && notes[activeId] && !notes[activeId].deletedAt
        ? [{ id: "share", group: "Actions", label: "Share this note…", icon: <Share size={15} strokeWidth={1.6} />, keywords: "send link friend", run: () => openShare(activeId) }]
        : []),
      {
        id: "new-cd",
        group: "Actions",
        label: "New countdown…",
        icon: <CalendarPlus size={15} strokeWidth={1.6} />,
        keywords: "trip birthday date days event",
        run: () => {
          s.setSettings({ countdowns: true, rail: true });
          s.setUI({ mobile: "rail" });
          window.setTimeout(() => window.dispatchEvent(new Event(NEW_COUNTDOWN_EVENT)), 60);
        },
      },
      { id: "todos", group: "Actions", label: settings.todos ? "Hide to-do list" : "Show to-do list", icon: <ListChecks size={15} strokeWidth={1.6} />, keywords: "tasks widget toggle", run: toggle("todos") },
      { id: "cds", group: "Actions", label: settings.countdowns ? "Hide countdowns" : "Show countdowns", icon: <Hourglass size={15} strokeWidth={1.6} />, keywords: "timer days widget toggle", run: toggle("countdowns") },
      { id: "focus", group: "Actions", label: focus ? "Exit focus mode" : "Focus mode", icon: <Maximize2 size={15} strokeWidth={1.6} />, kbd: `${MOD} ${SHIFT} F`, keywords: "zen distraction", run: () => s.setUI({ focus: !s.ui.focus }) },
      { id: "sidebar", group: "Actions", label: settings.sidebar ? "Hide sidebar" : "Show sidebar", icon: <PanelLeft size={15} strokeWidth={1.6} />, kbd: `${MOD} \\`, run: toggle("sidebar") },
      { id: "rail", group: "Actions", label: settings.rail ? "Hide side panel" : "Show side panel", icon: <PanelRight size={15} strokeWidth={1.6} />, kbd: `${MOD} .`, run: toggle("rail") },
      { id: "settings", group: "Actions", label: "Settings", icon: <Settings2 size={15} strokeWidth={1.6} />, kbd: `${MOD} ,`, keywords: "preferences options", run: () => s.setUI({ settings: true }) },
      { id: "shortcuts", group: "Actions", label: "Keyboard shortcuts", icon: <Keyboard size={15} strokeWidth={1.6} />, kbd: "?", keywords: "keys help", run: () => s.setUI({ shortcuts: true }) },
      { id: "trash", group: "Actions", label: "Open trash", icon: <Trash2 size={15} strokeWidth={1.6} />, keywords: "deleted restore", run: () => s.setUI({ view: "trash", mobile: "editor" }) },
      {
        id: "sounds",
        group: "Actions",
        label: settings.sounds ? "Turn sounds off" : "Turn sounds on",
        icon: settings.sounds ? <VolumeX size={15} strokeWidth={1.6} /> : <Volume2 size={15} strokeWidth={1.6} />,
        keywords: "audio mute",
        run: toggle("sounds"),
      },
      {
        id: "export",
        group: "Actions",
        label: "Export backup",
        icon: <Download size={15} strokeWidth={1.6} />,
        keywords: "download save json",
        run: () => {
          flushEditor();
          void exportAll().then((b) => download(`umbra-backup-${new Date().toISOString().slice(0, 10)}.json`, b));
        },
      },
      ...(Object.keys(ACCENTS) as AccentId[]).map((id) => ({
        id: `accent-${id}`,
        group: "Appearance",
        label: `Accent: ${ACCENTS[id].name}`,
        icon: <span className="swatch-dot" style={{ background: ACCENTS[id].color }} />,
        keywords: "color colour theme tint",
        hidden: true,
        meta: settings.accent === id ? "current" : undefined,
        run: () => s.setSettings({ accent: id }),
      })),
      ...(settings.effects !== "off"
        ? [
            settings.scene === "rain"
              ? { id: "scene", group: "Appearance", label: "Back to the eclipse", icon: <Moon size={15} strokeWidth={1.6} />, keywords: "scene theme space stars sky background eclipse", run: () => window.setTimeout(() => changeScene("eclipse"), 240) }
              : { id: "scene", group: "Appearance", label: "Make it rain", icon: <CloudRain size={15} strokeWidth={1.6} />, keywords: "scene theme rain storm city night window background", run: () => window.setTimeout(() => changeScene("rain"), 240) },
            ...(settings.scene === "rain"
              ? [
                  {
                    id: "lightning",
                    group: "Appearance",
                    label: settings.lightning ? "Turn lightning off" : "Turn lightning on",
                    icon: <CloudLightning size={15} strokeWidth={1.6} />,
                    keywords: "storm thunder flash rain",
                    run: () => s.setSettings({ lightning: !settings.lightning }),
                  },
                  {
                    id: "city",
                    group: "Appearance",
                    label: settings.cityLights ? "Turn the city lights off" : "Turn the city lights on",
                    icon: <Building2 size={15} strokeWidth={1.6} />,
                    keywords: "bokeh city lights rain blur",
                    run: () => s.setSettings({ cityLights: !settings.cityLights }),
                  },
                  ...(["drizzle", "rain", "downpour"] as RainAmountId[]).map((id) => ({
                    id: `rain-${id}`,
                    group: "Appearance",
                    label: `Rain: ${id[0].toUpperCase()}${id.slice(1)}`,
                    icon: <CloudRain size={15} strokeWidth={1.6} />,
                    keywords: "rain amount heavy light storm",
                    hidden: true,
                    meta: settings.rainAmount === id ? "current" : undefined,
                    run: () => s.setSettings({ rainAmount: id }),
                  })),
                ]
              : []),
            {
              id: "sky",
              group: "Appearance",
              label: seeThrough ? "Darker background" : "Show more of the sky",
              icon: <Sparkles size={15} strokeWidth={1.6} />,
              keywords: "background clear glass dark transparent see through sky stars",
              run: () => s.setSettings({ backdrop: seeThrough ? "dark" : "clear" }),
            },
            {
              id: "cursor-light",
              group: "Appearance",
              label: settings.cursorLight !== false ? "Turn the cursor light off" : "Turn the cursor light on",
              icon: <MousePointer2 size={15} strokeWidth={1.6} />,
              keywords: "cursor mouse glow light spotlight",
              run: () => s.setSettings({ cursorLight: settings.cursorLight === false }),
            },
            ...(["dark", "glass", "clear", "crystal", "bare"] as BackdropId[]).map((id) => ({
              id: `backdrop-${id}`,
              group: "Appearance",
              label: `Background: ${id[0].toUpperCase()}${id.slice(1)}`,
              icon: <Sparkles size={15} strokeWidth={1.6} />,
              keywords: "background clear glass dark transparent sky",
              hidden: true,
              meta: settings.backdrop === id ? "current" : undefined,
              run: () => s.setSettings({ backdrop: id }),
            })),
          ]
        : []),
      ...(Object.keys(FONTS) as FontId[]).map((id) => ({
        id: `font-${id}`,
        group: "Appearance",
        label: `Writing font: ${FONTS[id].name}`,
        icon: <Type size={15} strokeWidth={1.6} />,
        keywords: "typeface typography serif sans mono",
        hidden: true,
        meta: settings.font === id ? "current" : undefined,
        run: () => s.setSettings({ font: id }),
      })),
    ];

    const matchedActions = q
      ? actions
          .map((a) => ({ a, score: Math.max(fuzzyScore(a.label, q) * 1.5, fuzzyScore(a.keywords ?? "", q)) }))
          .filter((x) => x.score > 0)
          .sort((x, y) => y.score - x.score)
          .map((x) => x.a)
      : actions.filter((a) => !a.hidden);

    const create: Item[] =
      q && !list.some((n) => displayTitle(n).toLowerCase() === q.toLowerCase())
        ? [{ id: "create", group: "Create", label: `New note “${q}”`, icon: <Plus size={15} strokeWidth={1.8} />, run: () => newNote({ title: q }) }]
        : [];

    // The way into hidden notes only shows up for someone who types "hidden".
    const vault: Item[] = asksForHidden(q)
      ? [
          {
            id: "hidden",
            group: "Private",
            label: "Hidden notes",
            sub: unlocked ? "Unlocked — they're in the list" : hasVault ? "Enter your PIN" : "Choose a PIN to start hiding notes",
            icon: unlocked ? <LockOpen size={15} strokeWidth={1.6} /> : <Lock size={15} strokeWidth={1.6} />,
            run: () => openHidden(),
          },
        ]
      : [];

    return [...vault, ...noteItems, ...matchedActions, ...(vault.length ? [] : create)];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, notes, groups, unlocked, hasVault, settings, activeId, focus]);
}

function PaletteBody({ onClose }: { onClose: () => void }) {
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);
  const [pointer, setPointer] = useState(false);
  const items = useItems(query);
  const list = useRef<HTMLDivElement>(null);

  useEffect(() => setIndex(0), [query]);
  useEffect(() => {
    if (pointer) return;
    list.current?.querySelector<HTMLElement>(`[data-i="${index}"]`)?.scrollIntoView({ block: "nearest" });
  }, [index, pointer]);

  const run = (i: number) => {
    const item = items[i];
    if (!item) return;
    onClose();
    requestAnimationFrame(() => item.run());
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown" || (e.ctrlKey && e.key === "n")) {
      e.preventDefault();
      setPointer(false);
      setIndex((i) => (items.length ? (i + 1) % items.length : 0));
    } else if (e.key === "ArrowUp" || (e.ctrlKey && e.key === "p")) {
      e.preventDefault();
      setPointer(false);
      setIndex((i) => (items.length ? (i - 1 + items.length) % items.length : 0));
    } else if (e.key === "Enter" && !e.nativeEvent.isComposing) {
      e.preventDefault();
      run(index);
    }
  };

  let lastGroup = "";
  return (
    <div className="palette-body" onKeyDown={onKeyDown}>
      <div className="palette-input">
        <Search size={17} strokeWidth={1.7} />
        <input
          data-autofocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search notes or type a command…"
          aria-label="Search"
          spellCheck={false}
          autoComplete="off"
        />
        <Kbd keys="esc" subtle />
      </div>
      <div className="palette-list" ref={list} role="listbox" onPointerMove={() => setPointer(true)}>
        {items.length === 0 && <div className="palette-empty">Nothing matches “{query}”.</div>}
        {items.map((item, i) => {
          const header = item.group !== lastGroup ? item.group : null;
          lastGroup = item.group;
          return (
            <div key={item.id}>
              {header && <div className="palette-group label">{header}</div>}
              <button
                type="button"
                role="option"
                aria-selected={i === index}
                data-i={i}
                className={`palette-item ${i === index ? "is-active" : ""}`}
                onMouseMove={() => i !== index && setIndex(i)}
                onClick={() => run(i)}
              >
                {i === index && <motion.span layoutId="palette-hl" className="palette-hl" transition={{ ...spring, stiffness: 900, damping: 62 }} />}
                <span className="palette-icon">{item.icon}</span>
                <span className="palette-text">
                  <span className="palette-label">
                    <Highlight text={item.label} query={item.group === "Notes" ? query : ""} />
                  </span>
                  {item.sub && (
                    <span className="palette-sub">
                      <Highlight text={item.sub} query={query} />
                    </span>
                  )}
                </span>
                {item.meta && <span className="palette-meta mono">{item.meta}</span>}
                {item.kbd && <Kbd keys={item.kbd} subtle />}
              </button>
            </div>
          );
        })}
      </div>
      <div className="palette-foot mono">
        <span>
          <Kbd keys={["↑", "↓"]} subtle /> navigate
        </span>
        <span>
          <Kbd keys="↵" subtle /> open
        </span>
        <span className="flex" />
        <span className="palette-brand">
          <CornerDownLeft size={11} /> umbra
        </span>
      </div>
    </div>
  );
}

export function CommandPalette() {
  const open = useApp((s) => s.ui.palette);
  const setUI = useApp((s) => s.setUI);
  const close = () => setUI({ palette: false });
  return (
    <Modal open={open} onClose={close} position="top" className="palette" label="Search and commands">
      <PaletteBody onClose={close} />
    </Modal>
  );
}
