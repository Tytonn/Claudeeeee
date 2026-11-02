import { useRef, useState, type ReactNode } from "react";
import { flushSync } from "react-dom";
import { motion } from "motion/react";
import { Download, FileText, LayoutList, Link2, Upload, X } from "lucide-react";
import { useApp } from "../../store/app";
import { BOARD, shareUrl, stopShare } from "../../store/shareSync";
import { exportAll, importBackup } from "../../store/persist";
import { toast } from "../../store/toasts";
import { ACCENTS, FONTS } from "../../lib/theme";
import type { AccentId, BackdropId, EffectsId, FontId, SizeId } from "../../lib/types";
import { fx } from "../../fx/engine";
import { oklchToRgb, to255 } from "../../fx/color";
import { displayTitle } from "../../lib/text";
import { relativeLong } from "../../lib/dates";
import { download, flushEditor } from "../../lib/actions";
import { spring } from "../../lib/motion";
import { Modal } from "../ui/Modal";
import { Switch } from "../ui/Switch";
import { Segmented } from "../ui/Segmented";
import { IconButton } from "../ui/IconButton";

function Row({ label, desc, children, htmlFor }: { label: string; desc?: ReactNode; children: ReactNode; htmlFor?: string }) {
  return (
    <div className="set-row">
      <div className="set-row-text">
        <label className="set-row-label" htmlFor={htmlFor}>
          {label}
        </label>
        {desc && <div className="set-row-desc">{desc}</div>}
      </div>
      <div className="set-row-control">{children}</div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="set-section">
      <h3 className="label">{title}</h3>
      <div className="set-card">{children}</div>
    </section>
  );
}

/** The new accent floods out from the swatch, like light spilling across the room. */
function pickAccent(id: AccentId, e: React.MouseEvent) {
  const set = () => useApp.getState().setSettings({ accent: id });
  const x = e.clientX;
  const y = e.clientY;
  const start = (document as Document & { startViewTransition?: (cb: () => void) => { ready: Promise<void>; finished: Promise<void> } })
    .startViewTransition;
  if (!start || !fx.active || useApp.getState().settings.accent === id) {
    set();
    return;
  }
  const root = document.documentElement;
  root.classList.add("vt-accent");
  const t = start.call(document, () => flushSync(set));
  const radius = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y));
  t.ready
    .then(() => {
      root.animate(
        { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${radius}px at ${x}px ${y}px)`] },
        { duration: 780, easing: "cubic-bezier(0.22, 0.9, 0.25, 1)", pseudoElement: "::view-transition-new(root)" },
      );
      const c = to255(oklchToRgb(ACCENTS[id].color));
      fx.ring(x, y, 8, 120, { dur: 700, color: c });
      fx.burst(x, y, { count: 30, speed: 260, colors: [c, [255, 255, 255]], life: 0.9 });
    })
    .catch(() => {});
  t.finished.finally(() => root.classList.remove("vt-accent"));
}

function Swatches() {
  const accent = useApp((s) => s.settings.accent);
  return (
    <div className="swatches" role="radiogroup" aria-label="Accent color">
      {(Object.keys(ACCENTS) as AccentId[]).map((id) => (
        <button
          key={id}
          type="button"
          role="radio"
          aria-checked={accent === id}
          aria-label={ACCENTS[id].name}
          title={ACCENTS[id].name}
          className="swatch"
          style={{ "--sw": ACCENTS[id].color } as React.CSSProperties}
          onClick={(e) => pickAccent(id, e)}
        >
          {accent === id && <motion.span layoutId="swatch-ring" className="swatch-ring" transition={spring} />}
          <span className="swatch-core" />
        </button>
      ))}
    </div>
  );
}

function LiveLinks() {
  const shares = useApp((s) => s.shares);
  const notes = useApp((s) => s.notes);
  const [busy, setBusy] = useState<string | null>(null);
  const list = Object.values(shares).sort((a, b) => b.createdAt - a.createdAt);
  if (!list.length) return <div className="set-empty">No live links. Share a note and it shows up here.</div>;
  return (
    <ul className="set-links">
      {list.map((r) => {
        const isBoard = r.anchor === BOARD;
        const title = isBoard ? "To-dos & countdowns" : notes[r.anchor] ? displayTitle(notes[r.anchor]) : "Deleted note";
        return (
          <li key={r.anchor} className="set-link">
            <span className="set-link-icon">{isBoard ? <LayoutList size={14} strokeWidth={1.7} /> : <FileText size={14} strokeWidth={1.7} />}</span>
            <span className="set-link-text">
              <span className="set-link-title">{title}</span>
              <span className="set-link-sub mono">since {relativeLong(r.createdAt)}</span>
            </span>
            <IconButton
              size="sm"
              label="Copy link"
              onClick={() => {
                void navigator.clipboard.writeText(shareUrl(r)).then(
                  () => toast("Link copied", { tone: "success" }),
                  () => toast("Couldn't copy", { tone: "error" }),
                );
              }}
            >
              <Link2 size={14} strokeWidth={1.7} />
            </IconButton>
            <button
              type="button"
              className="ghost-btn sm danger"
              disabled={busy === r.anchor}
              onClick={async () => {
                setBusy(r.anchor);
                try {
                  await stopShare(r.anchor);
                  toast("Link turned off");
                } catch {
                  toast("Couldn't reach the server — try again", { tone: "error" });
                } finally {
                  setBusy(null);
                }
              }}
            >
              {busy === r.anchor ? "Stopping…" : "Stop"}
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function SettingsBody({ onClose }: { onClose: () => void }) {
  const settings = useApp((s) => s.settings);
  const setSettings = useApp((s) => s.setSettings);
  const fileInput = useRef<HTMLInputElement>(null);
  const [name, setName] = useState(settings.name);

  const fontOptions = (Object.keys(FONTS) as FontId[]).map((id) => ({
    value: id,
    label: (
      <span className="font-opt">
        <span className="font-opt-aa" style={{ fontFamily: FONTS[id].stack }}>
          Aa
        </span>
        {FONTS[id].name}
      </span>
    ),
  }));

  return (
    <div className="settings-body">
      <header className="settings-head">
        <h2 className="display">Settings</h2>
        <IconButton label="Close" kbd="esc" onClick={onClose}>
          <X size={16} strokeWidth={1.7} />
        </IconButton>
      </header>

      <div className="settings-scroll">
        <Section title="Appearance">
          <Row label="Accent" desc="Tints the caret, checkmarks and the glow.">
            <Swatches />
          </Row>
          <Row label="Writing font">
            <Segmented label="Writing font" value={settings.font} options={fontOptions} onChange={(font) => setSettings({ font })} />
          </Row>
          <Row label="Text size">
            <Segmented<SizeId>
              label="Text size"
              size="sm"
              value={settings.size}
              options={[
                { value: "s", label: "S" },
                { value: "m", label: "M" },
                { value: "l", label: "L" },
              ]}
              onChange={(size) => setSettings({ size })}
            />
          </Row>
          <Row label="Effects" desc="The living sky, solar flares, light trails and embers. Calm it down any time.">
            <Segmented<EffectsId>
              label="Effects"
              size="sm"
              value={settings.effects}
              options={[
                { value: "cosmic", label: "Cosmic" },
                { value: "subtle", label: "Subtle" },
                { value: "off", label: "Off" },
              ]}
              onChange={(effects) => setSettings({ effects })}
            />
          </Row>
          {settings.effects !== "off" && (
            <Row label="Background" desc="How much of the sky shows through. Your words always stay readable.">
              <Segmented<BackdropId>
                label="Background"
                size="sm"
                value={settings.backdrop}
                options={[
                  { value: "dark", label: "Dark" },
                  { value: "glass", label: "Glass" },
                  { value: "clear", label: "Clear" },
                ]}
                onChange={(backdrop) => setSettings({ backdrop })}
              />
            </Row>
          )}
          <Row label="Fade while typing" desc="Everything except your words quietly dims as you write.">
            <Switch checked={settings.fadeWhileTyping} onChange={(v) => setSettings({ fadeWhileTyping: v })} label="Fade while typing" />
          </Row>
        </Section>

        <Section title="Widgets">
          <Row label="To-do list" desc="A simple list beside your notes.">
            <Switch checked={settings.todos} onChange={(v) => setSettings({ todos: v, rail: v || settings.countdowns ? true : settings.rail })} label="To-do list" />
          </Row>
          <Row label="Countdowns" desc="Days until trips, birthdays, launches.">
            <Switch checked={settings.countdowns} onChange={(v) => setSettings({ countdowns: v, rail: v || settings.todos ? true : settings.rail })} label="Countdowns" />
          </Row>
          <Row label="Sounds" desc="Soft ticks when you check things off.">
            <Switch checked={settings.sounds} onChange={(v) => setSettings({ sounds: v })} label="Sounds" />
          </Row>
        </Section>

        <Section title="Sharing">
          <Row label="Your name" desc="Shown to friends on links you share." htmlFor="set-name">
            <input
              id="set-name"
              className="text-input"
              value={name}
              maxLength={40}
              placeholder="Optional"
              onChange={(e) => setName(e.target.value)}
              onBlur={() => setSettings({ name: name.trim() })}
              onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
            />
          </Row>
          <div className="set-row column">
            <div className="set-row-text">
              <span className="set-row-label">Live links</span>
              <div className="set-row-desc">Turning a link off makes it stop working immediately.</div>
            </div>
            <LiveLinks />
          </div>
        </Section>

        <Section title="Your data">
          <Row label="Backup" desc="Notes live privately in this browser. Export a backup now and then — or to move to another device.">
            <div className="set-btns">
              <button
                type="button"
                className="ghost-btn"
                onClick={async () => {
                  flushEditor();
                  download(`umbra-backup-${new Date().toISOString().slice(0, 10)}.json`, await exportAll());
                }}
              >
                <Download size={14} strokeWidth={1.8} /> Export
              </button>
              <button type="button" className="ghost-btn" onClick={() => fileInput.current?.click()}>
                <Upload size={14} strokeWidth={1.8} /> Import
              </button>
              <input
                ref={fileInput}
                type="file"
                accept="application/json,.json"
                hidden
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  e.target.value = "";
                  if (!file) return;
                  try {
                    const res = importBackup(JSON.parse(await file.text()));
                    toast(`Imported ${res.notes} notes, ${res.todos} to-dos, ${res.countdowns} countdowns`, { tone: "success" });
                  } catch (err) {
                    toast(err instanceof Error ? err.message : "Couldn't read that file", { tone: "error" });
                  }
                }}
              />
            </div>
          </Row>
        </Section>

        <footer className="settings-foot">
          <span className="display">umbra</span>
          <span className="mono">a quiet place to write</span>
        </footer>
      </div>
    </div>
  );
}

export function SettingsModal() {
  const open = useApp((s) => s.ui.settings);
  const setUI = useApp((s) => s.setUI);
  const close = () => setUI({ settings: false });
  return (
    <Modal open={open} onClose={close} className="settings" label="Settings">
      <SettingsBody onClose={close} />
    </Modal>
  );
}
