import { X } from "lucide-react";
import { useApp } from "../../store/app";
import { ALT, MOD, SHIFT } from "../../lib/theme";
import { Modal } from "../ui/Modal";
import { Kbd } from "../ui/Kbd";
import { IconButton } from "../ui/IconButton";

const GROUPS: { title: string; items: [string, string | string[]][] }[] = [
  {
    title: "Everywhere",
    items: [
      ["Search & commands", `${MOD} K`],
      ["New note", `${ALT} N`],
      ["Previous / next note", [ALT, "↑", "↓"]],
      ["Settings", `${MOD} ,`],
      ["This list", "?"],
    ],
  },
  {
    title: "View",
    items: [
      ["Toggle sidebar", `${MOD} \\`],
      ["Toggle side panel", `${MOD} .`],
      ["Focus mode", `${MOD} ${SHIFT} F`],
    ],
  },
  {
    title: "Writing",
    items: [
      ["Blocks menu", "/"],
      ["Bold · Italic", [MOD, "B", "I"]],
      ["Strikethrough", `${MOD} ${SHIFT} S`],
      ["Inline code", `${MOD} E`],
      ["Highlight", `${MOD} ${SHIFT} H`],
      ["Link (with text selected)", `${MOD} K`],
      ["Heading", ["#", "space"]],
      ["Checklist", ["[]", "space"]],
      ["Quote", [">", "space"]],
      ["Code block", ["```"]],
      ["Next table cell", "Tab"],
      ["Export as PDF", `${MOD} P`],
    ],
  },
  {
    title: "To-dos",
    items: [
      ["Add another below", "↵"],
      ["Check off", `${MOD} ↵`],
      ["Remove empty to-do", "⌫"],
      ["Reorder", ["drag", "⋮⋮"]],
    ],
  },
];

export function ShortcutsModal() {
  const open = useApp((s) => s.ui.shortcuts);
  const setUI = useApp((s) => s.setUI);
  const close = () => setUI({ shortcuts: false });
  return (
    <Modal open={open} onClose={close} className="shortcuts" label="Keyboard shortcuts">
      <header className="settings-head">
        <h2 className="display">Shortcuts</h2>
        <IconButton label="Close" kbd="esc" onClick={close}>
          <X size={16} strokeWidth={1.7} />
        </IconButton>
      </header>
      <div className="shortcuts-grid">
        {GROUPS.map((g) => (
          <section key={g.title} className="sc-group">
            <h3 className="label">{g.title}</h3>
            <ul>
              {g.items.map(([label, keys]) => (
                <li key={label}>
                  <span>{label}</span>
                  <Kbd keys={keys} />
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </Modal>
  );
}
