import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Editor } from "@tiptap/core";
import { TextSelection } from "@tiptap/pm/state";
import { CellSelection, moveTableColumn, moveTableRow } from "@tiptap/pm/tables";
import type { VirtualElement } from "@floating-ui/react-dom";
import { AnimatePresence, motion } from "motion/react";
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  BetweenHorizontalEnd,
  BetweenHorizontalStart,
  BetweenVerticalEnd,
  BetweenVerticalStart,
  Ellipsis,
  EllipsisVertical,
  Eraser,
  PanelLeft,
  PanelTop,
  Plus,
  TableCellsMerge,
  TableCellsSplit,
  Trash2,
} from "lucide-react";
import { Popover, pointAnchor } from "../ui/Popover";
import { Menu, type MenuItem } from "../ui/Menu";
import { Tooltip } from "../ui/Tooltip";
import { play } from "../../lib/sound";
import { toast } from "../../store/toasts";
import { appendColumn, appendRow, cellPosAt, selectLine, selectionSpot, spotOfElement, type CellSpot } from "./tables";

/*
 * A table's own tools, there when you need them and out of the way when you don't:
 *  · a handle on the edge of the row and the column you're pointing at (or typing in) — tap it
 *    and that whole row or column lights up, with what you can do to it;
 *  · a + along the bottom and down the right edge, for one more row or column;
 *  · right-click any cell for the lot.
 * On a touch screen the same handles and +s show around wherever you're typing.
 */

type Layout = {
  /** The table's visible part (it scrolls sideways when it's wider than the page). */
  left: number;
  top: number;
  width: number;
  height: number;
  rowMid: number;
  colMid: number;
  colShown: boolean;
  /** Room down the right for the column + (not on a narrow phone: the column menu has it). */
  roomRight: boolean;
};

type MenuState = { kind: "row" | "col" | "cell"; anchor: Element | VirtualElement; cell: HTMLTableCellElement };

const ICON = { size: 15, strokeWidth: 1.8 } as const;
/** How far around a table the pointer can wander (to reach its handles and +s) and still be "at" it. */
const REACH = 30;

const isHeader = (spot: CellSpot, row: number, col: number) => spot.table.nodeAt(cellPosAt(spot, row, col) - spot.tablePos - 1)?.type.name === "tableHeader";

export function TableTools({ editor, container }: { editor: Editor; container: HTMLElement | null }) {
  const [hoverCell, setHoverCell] = useState<HTMLTableCellElement | null>(null);
  const [hoverTable, setHoverTable] = useState<HTMLTableElement | null>(null);
  const [typingCell, setTypingCell] = useState<HTMLTableCellElement | null>(null);
  const [focused, setFocused] = useState(false);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [layout, setLayout] = useState<Layout | null>(null);
  const [tick, setTick] = useState(0);
  const hoverTableRef = useRef<HTMLTableElement | null>(null);
  hoverTableRef.current = hoverTable;

  // The cell the tools are about: the one with its menu open, else the one under the pointer,
  // else the one you're typing in.
  const live = (el: HTMLTableCellElement | null | undefined) => (el?.isConnected ? el : null);
  const cell = live(menu?.cell) ?? live(hoverCell) ?? (focused ? live(typingCell) : null);
  const table = cell?.closest("table") ?? null;
  const active = Boolean(cell);
  const activeRef = useRef(active);
  activeRef.current = active;
  // The +s show while you're at the table (pointing at it, typing in it, or in its menu).
  const atTable = Boolean(table && (hoverTable === table || menu || (focused && typingCell && table.contains(typingCell))));

  // Where you're typing, and when the table changes shape (or you type a long line into it).
  useEffect(() => {
    const update = () => {
      const spot = selectionSpot(editor.state);
      const dom = spot ? editor.view.nodeDOM(spot.cellPos) : null;
      setTypingCell(dom instanceof HTMLTableCellElement ? dom : null);
      if (activeRef.current || dom) setTick((t) => t + 1);
    };
    const onFocus = () => {
      setFocused(true);
      update();
    };
    const onBlur = () => setFocused(false);
    editor.on("transaction", update);
    editor.on("focus", onFocus);
    editor.on("blur", onBlur);
    setFocused(editor.isFocused);
    update();
    return () => {
      editor.off("transaction", update);
      editor.off("focus", onFocus);
      editor.off("blur", onBlur);
    };
  }, [editor]);

  // The pointer: which cell it's over — and staying put while it travels out to a handle. (Read
  // as it moves, not on the next frame: the handles must never lag behind it.)
  useEffect(() => {
    if (!container) return;
    const clear = () => {
      setHoverCell(null);
      setHoverTable(null);
    };
    const onMove = (e: PointerEvent) => {
      if (e.pointerType !== "mouse") return;
      const t = e.target as Element | null;
      if (!t?.closest || t.closest(".tt-ui")) return;
      const el = t.closest(".ProseMirror td, .ProseMirror th") as HTMLTableCellElement | null;
      if (el && editor.view.dom.contains(el)) {
        setHoverCell(el);
        setHoverTable(el.closest("table"));
        return;
      }
      const tbl = hoverTableRef.current;
      if (tbl?.isConnected) {
        const r = tbl.getBoundingClientRect();
        const w = (tbl.parentElement ?? tbl).getBoundingClientRect();
        const left = Math.max(r.left, w.left) - REACH;
        const right = Math.min(r.right, w.right) + REACH;
        if (e.clientX >= left && e.clientX <= right && e.clientY >= r.top - REACH && e.clientY <= r.bottom + REACH) return;
      }
      if (hoverTableRef.current) clear();
    };
    const onLeave = (e: PointerEvent) => {
      if (e.pointerType === "mouse") clear();
    };
    container.addEventListener("pointermove", onMove, { passive: true });
    container.addEventListener("pointerleave", onLeave);
    return () => {
      container.removeEventListener("pointermove", onMove);
      container.removeEventListener("pointerleave", onLeave);
    };
  }, [container, editor]);

  // Keep up with the table as it moves: a resized window, a column dragged wider, a table
  // scrolled sideways, rows growing as you type.
  useEffect(() => {
    if (!table || !container) return;
    const bump = () => setTick((t) => t + 1);
    const ro = new ResizeObserver(bump);
    ro.observe(table);
    window.addEventListener("resize", bump);
    container.addEventListener("scroll", bump, true);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", bump);
      container.removeEventListener("scroll", bump, true);
    };
  }, [table, container]);

  useLayoutEffect(() => {
    if (!container || !cell || !table) {
      setLayout(null);
      return;
    }
    const base = container.getBoundingClientRect();
    const t = table.getBoundingClientRect();
    const w = (table.parentElement ?? table).getBoundingClientRect();
    const left = Math.max(t.left, w.left);
    const right = Math.min(t.right, w.right);
    const row = (cell.parentElement ?? cell).getBoundingClientRect();
    const c = cell.getBoundingClientRect();
    const colMid = c.left + c.width / 2;
    setLayout({
      left: left - base.left,
      top: t.top - base.top,
      width: Math.max(0, right - left),
      height: t.height,
      rowMid: row.top + row.height / 2 - base.top,
      colMid: colMid - base.left,
      colShown: colMid >= w.left + 4 && colMid <= w.right - 4,
      roomRight: right + 30 <= Math.min(base.right, document.documentElement.clientWidth),
    });
  }, [container, cell, table, tick]);

  // Right-click a cell: everything you can do to the table. (With words selected, the browser's
  // own menu stays — copy, spelling, look up.)
  useEffect(() => {
    const dom = editor.view.dom;
    const onContext = (e: MouseEvent) => {
      const el = (e.target as Element | null)?.closest?.("td, th") as HTMLTableCellElement | null;
      if (!el || !dom.contains(el) || !editor.isEditable) return;
      const sel = editor.state.selection;
      if (!sel.empty && !(sel instanceof CellSelection)) return;
      const spot = spotOfElement(editor.view, el);
      if (!spot) return;
      e.preventDefault();
      if (!(sel instanceof CellSelection) && selectionSpot(editor.state)?.cellPos !== spot.cellPos) {
        const hit = editor.view.posAtCoords({ left: e.clientX, top: e.clientY });
        const pos = hit && hit.pos > spot.cellPos && hit.pos < spot.cellPos + (editor.state.doc.nodeAt(spot.cellPos)?.nodeSize ?? 0) ? hit.pos : spot.cellPos + 1;
        editor.view.dispatch(editor.state.tr.setSelection(TextSelection.near(editor.state.doc.resolve(pos))));
      }
      setMenu({ kind: "cell", anchor: pointAnchor(e.clientX, e.clientY), cell: el });
    };
    dom.addEventListener("contextmenu", onContext);
    return () => dom.removeEventListener("contextmenu", onContext);
  }, [editor]);

  const spotOfCell = () => (cell ? spotOfElement(editor.view, cell) : null);

  const openLine = (kind: "row" | "col", anchor: HTMLElement) => {
    const spot = spotOfCell();
    if (!spot || !cell) return;
    selectLine(editor, spot, kind);
    setMenu({ kind, anchor, cell });
  };

  const add = (kind: "row" | "col") => {
    const spot = spotOfCell();
    if (!spot) return;
    if (!(kind === "row" ? appendRow(editor, spot.tablePos) : appendColumn(editor, spot.tablePos))) return;
    play("pop");
    // the handles follow the caret into the new cell (until the pointer moves on)
    setHoverCell(null);
  };

  /** Runs a table command on the selection (which the handle set: the whole row or column). */
  const cmd = (fn: (c: ReturnType<Editor["chain"]>) => ReturnType<Editor["chain"]>) => () => {
    fn(editor.chain().focus()).run();
  };

  const move = (kind: "row" | "col", spot: CellSpot, to: number) => () => {
    const from = kind === "row" ? spot.row : spot.col;
    const command = kind === "row" ? moveTableRow({ from, to, pos: spot.cellPos + 1 }) : moveTableColumn({ from, to, pos: spot.cellPos + 1 });
    command(editor.state, editor.view.dispatch);
    editor.view.focus();
  };

  const deleteTable: MenuItem = {
    label: "Delete table",
    icon: <Trash2 {...ICON} />,
    danger: true,
    onSelect: () => {
      if (!editor.chain().focus().deleteTable().run()) return;
      toast("Table deleted", { action: { label: "Undo", run: () => editor.chain().focus().undo().run() } });
    },
  };

  const itemsFor = (m: MenuState): MenuItem[] => {
    const spot = spotOfElement(editor.view, m.cell);
    if (!spot) return [];
    const { width, height } = spot.map;
    if (m.kind === "row") {
      return [
        { label: "Insert row above", icon: <BetweenHorizontalStart {...ICON} />, onSelect: cmd((c) => c.addRowBefore()) },
        { label: "Insert row below", icon: <BetweenHorizontalEnd {...ICON} />, onSelect: cmd((c) => c.addRowAfter()) },
        ...(spot.row > 0 ? [{ label: "Move up", icon: <ArrowUp {...ICON} />, onSelect: move("row", spot, spot.row - 1) }] : []),
        ...(spot.row < height - 1 ? [{ label: "Move down", icon: <ArrowDown {...ICON} />, onSelect: move("row", spot, spot.row + 1) }] : []),
        ...(spot.row === 0
          ? [{ label: "Header row", icon: <PanelTop {...ICON} />, checked: Array.from({ length: width }, (_, c) => isHeader(spot, 0, c)).every(Boolean), onSelect: cmd((c) => c.toggleHeaderRow()) }]
          : []),
        "divider",
        { label: "Clear row", icon: <Eraser {...ICON} />, onSelect: cmd((c) => c.deleteSelection()) },
        ...(height > 1 ? [{ label: "Delete row", icon: <Trash2 {...ICON} />, danger: true, onSelect: cmd((c) => c.deleteRow()) }, "divider" as const] : []),
        deleteTable,
      ];
    }
    if (m.kind === "col") {
      const align = spot.table.nodeAt(spot.cellPos - spot.tablePos - 1)?.attrs.align as string | null | undefined;
      const setAlign = (value: string | null) => cmd((c) => c.setCellAttribute("align", value));
      return [
        { label: "Insert column left", icon: <BetweenVerticalStart {...ICON} />, onSelect: cmd((c) => c.addColumnBefore()) },
        { label: "Insert column right", icon: <BetweenVerticalEnd {...ICON} />, onSelect: cmd((c) => c.addColumnAfter()) },
        ...(spot.col > 0 ? [{ label: "Move left", icon: <ArrowLeft {...ICON} />, onSelect: move("col", spot, spot.col - 1) }] : []),
        ...(spot.col < width - 1 ? [{ label: "Move right", icon: <ArrowRight {...ICON} />, onSelect: move("col", spot, spot.col + 1) }] : []),
        {
          label: "Align",
          icon: align === "center" ? <AlignCenter {...ICON} /> : align === "right" ? <AlignRight {...ICON} /> : <AlignLeft {...ICON} />,
          submenu: [
            { label: "Left", icon: <AlignLeft {...ICON} />, checked: align !== "center" && align !== "right", onSelect: setAlign(null) },
            { label: "Center", icon: <AlignCenter {...ICON} />, checked: align === "center", onSelect: setAlign("center") },
            { label: "Right", icon: <AlignRight {...ICON} />, checked: align === "right", onSelect: setAlign("right") },
          ],
        },
        ...(spot.col === 0
          ? [{ label: "Header column", icon: <PanelLeft {...ICON} />, checked: Array.from({ length: height }, (_, r) => isHeader(spot, r, 0)).every(Boolean), onSelect: cmd((c) => c.toggleHeaderColumn()) }]
          : []),
        "divider",
        { label: "Clear column", icon: <Eraser {...ICON} />, onSelect: cmd((c) => c.deleteSelection()) },
        ...(width > 1 ? [{ label: "Delete column", icon: <Trash2 {...ICON} />, danger: true, onSelect: cmd((c) => c.deleteColumn()) }, "divider" as const] : []),
        deleteTable,
      ];
    }
    const can = editor.can();
    return [
      { label: "Insert row above", icon: <BetweenHorizontalStart {...ICON} />, onSelect: cmd((c) => c.addRowBefore()) },
      { label: "Insert row below", icon: <BetweenHorizontalEnd {...ICON} />, onSelect: cmd((c) => c.addRowAfter()) },
      { label: "Insert column left", icon: <BetweenVerticalStart {...ICON} />, onSelect: cmd((c) => c.addColumnBefore()) },
      { label: "Insert column right", icon: <BetweenVerticalEnd {...ICON} />, onSelect: cmd((c) => c.addColumnAfter()) },
      ...(can.mergeCells() || can.splitCell()
        ? [
            "divider" as const,
            ...(can.mergeCells() ? [{ label: "Merge cells", icon: <TableCellsMerge {...ICON} />, onSelect: cmd((c) => c.mergeCells()) }] : []),
            ...(can.splitCell() ? [{ label: "Split cell", icon: <TableCellsSplit {...ICON} />, onSelect: cmd((c) => c.splitCell()) }] : []),
          ]
        : []),
      "divider",
      ...(height > 1 ? [{ label: "Delete row", icon: <Trash2 {...ICON} />, danger: true, onSelect: cmd((c) => c.deleteRow()) }] : []),
      ...(width > 1 ? [{ label: "Delete column", icon: <Trash2 {...ICON} />, danger: true, onSelect: cmd((c) => c.deleteColumn()) }] : []),
      deleteTable,
    ];
  };

  // The tools never take the caret away from the note (and never start a text selection).
  const keep = (e: React.MouseEvent) => e.preventDefault();
  const pop = { initial: { opacity: 0, scale: 0.6 }, animate: { opacity: 1, scale: 1 }, exit: { opacity: 0, scale: 0.6 }, transition: { duration: 0.14 } };

  return (
    <div className="tt-ui">
      <AnimatePresence>
        {layout && layout.colShown && (
          <motion.button
            key="col"
            type="button"
            className={`tt-handle tt-col ${menu?.kind === "col" ? "is-open" : ""}`}
            style={{ left: layout.colMid, top: layout.top }}
            aria-label="Column options"
            tabIndex={-1}
           
            onMouseDown={keep}
            onClick={(e) => openLine("col", e.currentTarget)}
            {...pop}
          >
            <Ellipsis size={14} strokeWidth={2.2} />
          </motion.button>
        )}
        {layout && (
          <motion.button
            key="row"
            type="button"
            className={`tt-handle tt-row ${menu?.kind === "row" ? "is-open" : ""}`}
            style={{ left: layout.left, top: layout.rowMid }}
            aria-label="Row options"
            tabIndex={-1}
           
            onMouseDown={keep}
            onClick={(e) => openLine("row", e.currentTarget)}
            {...pop}
          >
            <EllipsisVertical size={14} strokeWidth={2.2} />
          </motion.button>
        )}
        {layout && atTable && (
          <motion.div key="add-row" className="tt-add-wrap tt-add-row" style={{ left: layout.left, top: layout.top + layout.height, width: layout.width }} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.16 }}>
            <Tooltip label="Add a row" placement="bottom">
              <button type="button" className="tt-add" aria-label="Add a row" tabIndex={-1} onMouseDown={keep} onClick={() => add("row")}>
                <Plus size={13} strokeWidth={2.2} />
              </button>
            </Tooltip>
          </motion.div>
        )}
        {layout && atTable && layout.roomRight && (
          <motion.div key="add-col" className="tt-add-wrap tt-add-col" style={{ left: layout.left + layout.width, top: layout.top, height: layout.height }} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.16 }}>
            <Tooltip label="Add a column" placement="right">
              <button type="button" className="tt-add" aria-label="Add a column" tabIndex={-1} onMouseDown={keep} onClick={() => add("col")}>
                <Plus size={13} strokeWidth={2.2} />
              </button>
            </Tooltip>
          </motion.div>
        )}
      </AnimatePresence>
      <Popover open={Boolean(menu)} onClose={() => setMenu(null)} anchor={menu?.anchor ?? null} placement={menu?.kind === "row" ? "right-start" : "bottom-start"} offsetPx={6} role="menu">
        {menu && <Menu items={itemsFor(menu)} onClose={() => setMenu(null)} />}
      </Popover>
    </div>
  );
}
