import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { AnimatePresence, Reorder, motion, useDragControls } from "motion/react";
import { Ban, ChevronRight, GripVertical, Layers, PenLine, Plus, Sparkles, Trash2, X } from "lucide-react";
import { useApp } from "../../store/app";
import { toast } from "../../store/toasts";
import type { Todo, TodoColor } from "../../lib/types";
import { TODO_COLORS, isMac } from "../../lib/theme";
import { TODO_COLORS as COLOR_ORDER } from "../../lib/sanitize";
import { Menu, type MenuItem } from "../ui/Menu";
import { Popover, pointAnchor } from "../ui/Popover";
import { haptic, play } from "../../lib/sound";
import { ease, spring } from "../../lib/motion";
import { Checkbox } from "../ui/Checkbox";
import { IconButton } from "../ui/IconButton";
import { fx } from "../../fx/engine";
import { dissolve } from "../../fx/dom";

function focusTodo(id: string | undefined, where: "start" | "end" = "end") {
  if (!id) return;
  requestAnimationFrame(() => {
    const el = document.querySelector<HTMLInputElement>(`[data-todo="${id}"]`);
    if (!el) return;
    el.focus();
    const pos = where === "end" ? el.value.length : 0;
    el.setSelectionRange(pos, pos);
  });
}

function removeWithUndo(id: string) {
  const removed = useApp.getState().removeTodo(id);
  if (!removed) return;
  play("drop");
  if (removed.todo.text.trim()) {
    toast("To-do deleted", { action: { label: "Undo", run: () => useApp.getState().restoreTodo(removed.todo, removed.index) } });
  }
}

/** What a color is called: your name for it, or just the color. */
function labelOf(color: TodoColor, labels: Partial<Record<TodoColor, string>>) {
  return labels[color]?.trim() || TODO_COLORS[color].name;
}

const tagStyle = (color: TodoColor | null | undefined) => (color ? ({ "--tag": TODO_COLORS[color].color } as CSSProperties) : undefined);

/** The color menu for a to-do: pick one, or none. */
function colorItems(todo: Todo, labels: Partial<Record<TodoColor, string>>): MenuItem[] {
  const set = (color: TodoColor | null) => () => {
    useApp.getState().updateTodo(todo.id, { color });
    play("pop");
  };
  return [
    ...COLOR_ORDER.map((c) => ({ label: labelOf(c, labels), icon: <span className="tag-dot" style={tagStyle(c)} />, checked: todo.color === c, onSelect: set(c) }) as MenuItem),
    "divider",
    { label: "No color", icon: <Ban size={14} />, checked: !todo.color, onSelect: set(null) },
  ];
}

/** A to-do's menu: its colors (and, from a right-click, Delete). Opens at a point on screen. */
function TodoMenu({ todo, at, onClose }: { todo: Todo; at: { x: number; y: number; full: boolean } | null; onClose: () => void }) {
  const labels = useApp((s) => s.settings.todoLabels);
  const anchor = useMemo(() => (at ? pointAnchor(at.x, at.y) : null), [at]);
  return (
    <Popover open={Boolean(at)} onClose={onClose} anchor={anchor} placement="bottom-start" offsetPx={4} role="menu">
      <Menu
        items={[
          ...colorItems(todo, labels),
          ...(at?.full ? (["divider", { label: "Delete", icon: <Trash2 size={14} />, danger: true, onSelect: () => removeWithUndo(todo.id) }] as MenuItem[]) : []),
        ]}
        onClose={onClose}
      />
    </Popover>
  );
}

/** A right-click (or, on a Mac, a Control-click). */
const isContextClick = (e: React.MouseEvent) => e.button === 2 || (isMac && e.button === 0 && e.ctrlKey);

/**
 * Right-clicking anywhere on a to-do opens its menu — on its words too. Except: with some of
 * the text already selected, you get the usual copy-and-paste menu; and a finger held on the
 * words is for selecting them, as always.
 */
function useRowMenu(row: React.RefObject<HTMLElement | null>) {
  const [menu, setMenu] = useState<{ x: number; y: number; full: boolean } | null>(null);
  const press = useRef<{ mouse: boolean; selected: boolean } | null>(null);
  const textOf = (target: EventTarget) => (target as HTMLElement).closest?.("input") as HTMLInputElement | null;
  const hasSelection = (el: HTMLInputElement | null) => Boolean(el && document.activeElement === el && el.selectionStart !== el.selectionEnd);
  return {
    menu,
    setMenu,
    handlers: {
      onPointerDownCapture: (e: React.PointerEvent) => {
        press.current = { mouse: e.pointerType === "mouse", selected: hasSelection(textOf(e.target)) };
      },
      onMouseDownCapture: (e: React.MouseEvent) => {
        // Don't let the right-click put the caret in the words (or select one) on its way to the menu.
        const el = textOf(e.target);
        if (el && isContextClick(e) && !hasSelection(el)) e.preventDefault();
      },
      onContextMenu: (e: React.MouseEvent) => {
        const el = textOf(e.target);
        if (el) {
          const p = press.current;
          if (!p || !p.mouse || p.selected) return;
        }
        e.preventDefault();
        const r = row.current?.getBoundingClientRect();
        // From the keyboard (no pointer position), it opens under the row instead.
        const fromKeys = e.clientX === 0 && e.clientY === 0 && r;
        setMenu({ x: fromKeys ? r.left + 28 : e.clientX, y: fromKeys ? r.bottom : e.clientY, full: true });
      },
    },
  };
}

type RowProps = { todo: Todo; prevId?: string; nextId?: string; addInput: React.RefObject<HTMLInputElement | null> };

function TodoRow({ todo, prevId, nextId, addInput }: RowProps) {
  const controls = useDragControls();
  const [settling, setSettling] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  const row = useRef<HTMLLIElement>(null);
  const updateTodo = useApp((s) => s.updateTodo);
  const { menu, setMenu, handlers } = useRowMenu(row);

  const commitDone = () => {
    const openCount = useApp.getState().todos.filter((t) => !t.done).length;
    const el = row.current;
    if (el && fx.active) {
      // Dissolve into embers, and send a streak of light to the Completed list.
      const from = el.getBoundingClientRect();
      const target =
        el.closest(".todos")?.querySelector<HTMLElement>(".todo-done-toggle") ?? el.closest(".todos")?.querySelector<HTMLElement>(".widget-head .label");
      dissolve(el);
      if (target) {
        const to = target.getBoundingClientRect();
        fx.trail({ x: from.left + 22, y: from.top + from.height / 2 }, { x: to.left + 12, y: to.top + to.height / 2 }, () => {
          target.classList.remove("pulse");
          void target.offsetWidth;
          target.classList.add("pulse");
        });
      }
    }
    useApp.getState().toggleTodo(todo.id);
    if (openCount === 1) window.setTimeout(() => play("done"), 120);
  };

  useEffect(
    () => () => {
      if (timer.current) {
        window.clearTimeout(timer.current);
        // Unmounted mid-animation (e.g. panel closed) — still record the completion.
        if (useApp.getState().todos.find((t) => t.id === todo.id && !t.done)) useApp.getState().toggleTodo(todo.id);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const onCheck = () => {
    if (settling) {
      window.clearTimeout(timer.current);
      timer.current = undefined;
      setSettling(false);
      play("untick");
      return;
    }
    setSettling(true);
    play("tick");
    haptic(10);
    timer.current = window.setTimeout(() => {
      timer.current = undefined;
      commitDone();
    }, 720);
  };

  return (
    <Reorder.Item
      ref={row}
      as="li"
      value={todo.id}
      dragListener={false}
      dragControls={controls}
      className={`todo ${settling ? "is-settling" : ""} ${todo.color ? "has-tag" : ""} ${menu ? "is-menu" : ""}`}
      style={tagStyle(todo.color)}
      {...handlers}
      layout="position"
      initial={{ opacity: 0, y: -6, filter: "blur(3px)" }}
      animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
      exit={{ opacity: 0, x: 14, filter: "blur(3px)", transition: { duration: 0.2, ease } }}
      transition={spring}
      whileDrag={{
        scale: 1.03,
        zIndex: 20,
        backgroundColor: "rgb(22 23 27)",
        boxShadow: "0 18px 40px -12px rgb(0 0 0 / 0.85), 0 0 0 1px rgb(255 255 255 / 0.09)",
      }}
    >
      <span
        className="todo-grip"
        aria-hidden
        onPointerDown={(e) => {
          e.preventDefault();
          controls.start(e);
        }}
      >
        <GripVertical size={13} strokeWidth={1.8} />
      </span>
      <Checkbox checked={settling} onToggle={onCheck} label={todo.text} />
      <span className="todo-text-wrap">
        <input
          data-todo={todo.id}
          className="todo-text"
          value={todo.text}
          aria-label="To-do"
          placeholder="To-do"
          spellCheck
          onChange={(e) => updateTodo(todo.id, { text: e.target.value })}
          onBlur={() => {
            if (!useApp.getState().todos.find((t) => t.id === todo.id)?.text.trim()) useApp.getState().removeTodo(todo.id);
          }}
          onKeyDown={(e) => {
            if (e.nativeEvent.isComposing) return;
            const el = e.currentTarget;
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              onCheck();
            } else if (e.key === "Enter") {
              e.preventDefault();
              if (!el.value.trim()) return;
              // The next one carries on in the same color.
              const id = useApp.getState().addTodo("", todo.id, todo.color);
              focusTodo(id);
            } else if (e.key === "Backspace" && el.value === "") {
              e.preventDefault();
              useApp.getState().removeTodo(todo.id);
              if (prevId) focusTodo(prevId);
              else addInput.current?.focus();
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              if (prevId) focusTodo(prevId);
              else addInput.current?.focus();
            } else if (e.key === "ArrowDown") {
              e.preventDefault();
              focusTodo(nextId);
            } else if (e.key === "Escape") {
              el.blur();
            }
          }}
        />
        <span className="todo-strike" aria-hidden>
          {todo.text}
        </span>
      </span>
      <button
        type="button"
        className="todo-tag"
        aria-label="Color"
        title="Color"
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          setMenu({ x: r.left, y: r.bottom + 2, full: false });
        }}
      >
        <span className="tag-dot" />
      </button>
      <button type="button" className="todo-del" aria-label="Delete to-do" onClick={() => removeWithUndo(todo.id)}>
        <X size={13} strokeWidth={1.8} />
      </button>
      <TodoMenu todo={todo} at={menu} onClose={() => setMenu(null)} />
    </Reorder.Item>
  );
}

/** A color's section in the grouped list: its name (yours to change), its to-dos, and a quick add. */
function TodoSection({
  color,
  todos,
  addInput,
  onReorder,
}: {
  color: TodoColor | null;
  todos: Todo[];
  addInput: React.RefObject<HTMLInputElement | null>;
  onReorder: (ids: string[], next: string[]) => void;
}) {
  const labels = useApp((s) => s.settings.todoLabels);
  const [open, setOpen] = useState(true);
  const [naming, setNaming] = useState(false);
  const name = color ? labelOf(color, labels) : "No color";
  const ids = todos.map((t) => t.id);
  const [draft, setDraft] = useState(name);
  const commitName = (save: boolean) => {
    setNaming(false);
    if (!save || !color) return;
    const s = useApp.getState();
    const next = { ...s.settings.todoLabels };
    const clean = draft.trim().slice(0, 32);
    if (clean && clean !== TODO_COLORS[color].name) next[color] = clean;
    else delete next[color];
    s.setSettings({ todoLabels: next });
  };
  const add = () => {
    setOpen(true);
    const id = useApp.getState().addTodo("", null, color);
    focusTodo(id);
  };
  return (
    <motion.section layout="position" transition={spring} className={`todo-section ${color ? "" : "is-plain"}`} style={tagStyle(color)}>
      <header className="todo-section-head">
        {naming ? (
          <span className="todo-section-toggle">
            <span className="tag-dot" />
            <input
              className="todo-section-input"
              value={draft}
              maxLength={32}
              autoFocus
              aria-label="Name for this color"
              onFocus={(e) => e.currentTarget.select()}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={() => commitName(true)}
              onKeyDown={(e) => {
                if (e.key === "Enter") commitName(true);
                else if (e.key === "Escape") {
                  e.stopPropagation();
                  commitName(false);
                }
              }}
            />
          </span>
        ) : (
          <button type="button" className="todo-section-toggle" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
            <ChevronRight size={12} strokeWidth={2} className={`chev ${open ? "is-open" : ""}`} />
            {color ? <span className="tag-dot" /> : <span className="tag-dot is-none" />}
            <span className="todo-section-name">{name}</span>
            <span className="todo-section-count mono">{todos.length}</span>
          </button>
        )}
        {color && !naming && (
          <button
            type="button"
            className="todo-section-btn"
            aria-label={`Rename ${name}`}
            title="Rename"
            onClick={() => {
              setDraft(name);
              setNaming(true);
            }}
          >
            <PenLine size={12} strokeWidth={1.8} />
          </button>
        )}
        <button type="button" className="todo-section-btn" aria-label={`Add to ${name}`} title="Add a to-do here" onClick={add}>
          <Plus size={13} strokeWidth={1.8} />
        </button>
      </header>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.24, ease }} style={{ overflow: "hidden" }}>
            <Reorder.Group as="ul" axis="y" values={ids} onReorder={(next: string[]) => onReorder(ids, next)} className="todo-list">
              <AnimatePresence initial={false} mode="popLayout">
                {todos.map((t, i) => (
                  <TodoRow key={t.id} todo={t} prevId={todos[i - 1]?.id} nextId={todos[i + 1]?.id} addInput={addInput} />
                ))}
              </AnimatePresence>
            </Reorder.Group>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.section>
  );
}

function DoneRow({ todo }: { todo: Todo }) {
  const row = useRef<HTMLLIElement>(null);
  const { menu, setMenu, handlers } = useRowMenu(row);
  return (
    <motion.li
      ref={row}
      layout="position"
      className={`todo is-done ${todo.color ? "has-tag" : ""} ${menu ? "is-menu" : ""}`}
      style={tagStyle(todo.color)}
      {...handlers}
      initial={{ opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, transition: { duration: 0.14 } }}
      transition={spring}
    >
      <span className="todo-grip is-hidden" aria-hidden />
      <Checkbox
        checked
        label={todo.text}
        onToggle={() => {
          play("untick");
          useApp.getState().toggleTodo(todo.id);
        }}
      />
      <span className="todo-text-wrap">
        <span className="todo-text static">{todo.text}</span>
        <span className="todo-strike" aria-hidden>
          {todo.text}
        </span>
      </span>
      <button type="button" className="todo-del" aria-label="Delete to-do" onClick={() => removeWithUndo(todo.id)}>
        <X size={13} strokeWidth={1.8} />
      </button>
      <TodoMenu todo={todo} at={menu} onClose={() => setMenu(null)} />
    </motion.li>
  );
}

export function Todos() {
  const todos = useApp((s) => s.todos);
  const addTodo = useApp((s) => s.addTodo);
  const reorder = useApp((s) => s.reorderOpenTodos);
  const open = useMemo(() => todos.filter((t) => !t.done), [todos]);
  const done = useMemo(() => todos.filter((t) => t.done).sort((a, b) => (b.doneAt ?? 0) - (a.doneAt ?? 0)), [todos]);
  const openIds = useMemo(() => open.map((t) => t.id), [open]);
  const grouped = useApp((s) => s.settings.todoGroups === true);
  const anyColor = useMemo(() => todos.some((t) => t.color), [todos]);
  // Grouped by color: a section per color in use, in rainbow order, then the uncolored ones.
  const sections = useMemo(() => {
    if (!grouped || !anyColor) return null;
    const out: { color: TodoColor | null; todos: Todo[] }[] = [];
    for (const c of COLOR_ORDER) {
      const list = open.filter((t) => t.color === c);
      if (list.length) out.push({ color: c, todos: list });
    }
    const plain = open.filter((t) => !t.color);
    if (plain.length) out.push({ color: null, todos: plain });
    return out;
  }, [grouped, anyColor, open]);
  // Reordering inside a section keeps everything else where it was.
  const reorderWithin = (ids: string[], next: string[]) => {
    const slots = openIds.map((id, i) => (ids.includes(id) ? i : -1)).filter((i) => i >= 0);
    const order = [...openIds];
    slots.forEach((slot, k) => (order[slot] = next[k]));
    reorder(order);
  };
  const [showDone, setShowDone] = useState(false);
  const [draft, setDraft] = useState("");
  const input = useRef<HTMLInputElement>(null);

  const submit = () => {
    const text = draft.trim();
    if (!text) return;
    addTodo(text);
    setDraft("");
    play("pop");
  };

  const clearDone = () => {
    const removed = useApp.getState().clearDoneTodos();
    if (!removed.length) return;
    play("drop");
    toast(`Cleared ${removed.length} completed`, {
      action: {
        label: "Undo",
        run: () => useApp.setState((s) => ({ todos: [...s.todos, ...removed] })),
      },
    });
  };

  return (
    <section className="widget todos" aria-label="To-do list">
      <header className="widget-head">
        <span className="label">To-do</span>
        <AnimatePresence initial={false}>
          {open.length > 0 && (
            <motion.span key="count" className="widget-count mono" initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.8 }}>
              {open.length}
            </motion.span>
          )}
        </AnimatePresence>
        <span className="flex" />
        <AnimatePresence initial={false}>
          {(anyColor || grouped) && (
            <motion.span key="group" initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.8 }}>
              <IconButton
                size="sm"
                label={grouped ? "Don't group by color" : "Group by color"}
                active={grouped}
                onClick={() => {
                  useApp.getState().setSettings({ todoGroups: !grouped });
                  play("pop");
                }}
              >
                <Layers size={14} strokeWidth={1.8} />
              </IconButton>
            </motion.span>
          )}
        </AnimatePresence>
        <IconButton size="sm" label="Add to-do" onClick={() => input.current?.focus()}>
          <Plus size={15} strokeWidth={1.8} />
        </IconButton>
      </header>

      <form
        className="todo-add"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <span className="todo-add-icon" aria-hidden>
          <Plus size={14} strokeWidth={1.8} />
        </span>
        <input
          ref={input}
          value={draft}
          placeholder="Add a to-do"
          aria-label="New to-do"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown" && open[0]) {
              e.preventDefault();
              focusTodo(open[0].id);
            } else if (e.key === "Escape") {
              setDraft("");
              e.currentTarget.blur();
            }
          }}
        />
        <AnimatePresence>
          {draft.trim() && (
            <motion.kbd className="kbd todo-enter" initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.8 }}>
              ↵
            </motion.kbd>
          )}
        </AnimatePresence>
      </form>

      {sections ? (
        <div className="todo-sections">
          <AnimatePresence initial={false}>
            {sections.map((sec) => (
              <TodoSection key={sec.color ?? "none"} color={sec.color} todos={sec.todos} addInput={input} onReorder={reorderWithin} />
            ))}
          </AnimatePresence>
        </div>
      ) : (
        <Reorder.Group as="ul" axis="y" values={openIds} onReorder={reorder} className="todo-list">
          <AnimatePresence initial={false} mode="popLayout">
            {open.map((t, i) => (
              <TodoRow key={t.id} todo={t} prevId={open[i - 1]?.id} nextId={open[i + 1]?.id} addInput={input} />
            ))}
          </AnimatePresence>
        </Reorder.Group>
      )}

      <AnimatePresence initial={false}>
        {open.length === 0 && (
          <motion.div key="empty" className="widget-empty" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            {done.length ? (
              <span className="all-done">
                <Sparkles size={13} strokeWidth={1.8} /> All done. Nice.
              </span>
            ) : (
              "A clean slate."
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {done.length > 0 && (
        <div className="todo-done">
          <div className="todo-done-head">
            <button type="button" className="todo-done-toggle" aria-expanded={showDone} onClick={() => setShowDone((v) => !v)}>
              <ChevronRight size={13} strokeWidth={2} className={`chev ${showDone ? "is-open" : ""}`} />
              Completed <span className="mono">{done.length}</span>
            </button>
            <AnimatePresence>
              {showDone && (
                <motion.button
                  type="button"
                  className="link-btn"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  onClick={clearDone}
                >
                  Clear
                </motion.button>
              )}
            </AnimatePresence>
          </div>
          <AnimatePresence initial={false}>
            {showDone && (
              <motion.ul
                className="todo-list done"
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.28, ease }}
                style={{ overflow: "hidden" }}
              >
                <AnimatePresence initial={false}>
                  {done.map((t) => (
                    <DoneRow key={t.id} todo={t} />
                  ))}
                </AnimatePresence>
              </motion.ul>
            )}
          </AnimatePresence>
        </div>
      )}
    </section>
  );
}
