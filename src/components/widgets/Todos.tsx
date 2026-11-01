import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, Reorder, motion, useDragControls } from "motion/react";
import { ChevronRight, GripVertical, Plus, Sparkles, X } from "lucide-react";
import { useApp } from "../../store/app";
import { toast } from "../../store/toasts";
import type { Todo } from "../../lib/types";
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

type RowProps = { todo: Todo; prevId?: string; nextId?: string; addInput: React.RefObject<HTMLInputElement | null> };

function TodoRow({ todo, prevId, nextId, addInput }: RowProps) {
  const controls = useDragControls();
  const [settling, setSettling] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  const row = useRef<HTMLLIElement>(null);
  const updateTodo = useApp((s) => s.updateTodo);

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
      className={`todo ${settling ? "is-settling" : ""}`}
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
              const id = useApp.getState().addTodo("", todo.id);
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
      <button type="button" className="todo-del" aria-label="Delete to-do" onClick={() => removeWithUndo(todo.id)}>
        <X size={13} strokeWidth={1.8} />
      </button>
    </Reorder.Item>
  );
}

function DoneRow({ todo }: { todo: Todo }) {
  return (
    <motion.li
      layout="position"
      className="todo is-done"
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

      <Reorder.Group as="ul" axis="y" values={openIds} onReorder={reorder} className="todo-list">
        <AnimatePresence initial={false} mode="popLayout">
          {open.map((t, i) => (
            <TodoRow key={t.id} todo={t} prevId={open[i - 1]?.id} nextId={open[i + 1]?.id} addInput={input} />
          ))}
        </AnimatePresence>
      </Reorder.Group>

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
