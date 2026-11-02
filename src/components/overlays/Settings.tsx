import { useRef, useState, type ReactNode } from "react";
import { flushSync } from "react-dom";
import { motion } from "motion/react";
import { Download, FileText, LayoutList, Link2, Upload, X } from "lucide-react";
import { useApp } from "../../store/app";
import { BOARD, shareUrl, stopShare } from "../../store/shareSync";
import { exportAll, importBackup } from "../../store/persist";
import { toast } from "../../store/toasts";
import { ACCENTS, FONTS } from "../../lib/theme";
import type { AccentId, BackdropId, EffectsId, FontId, RainAmountId, SceneId, SizeId } from "../../lib/types";
import { fx } from "../../fx/engine";
import { oklchToRgb, to255 } from "../../fx/color";
import { displayTitle } from "../../lib/text";
import { relativeLong } from "../../lib/dates";
import { download, flushEditor } from "../../lib/actions";
import { spring } from "../../lib/motion";
import { Modal } from "../ui/Modal";
import { useAccount } from "../../account/account";
import { Switch } from "../ui/Switch";
import { Segmented } from "../ui/Segmented";
import { IconButton } from "../ui/IconButton";
import { Eclipse } from "../ui/Eclipse";

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

type ViewTransitionStart = (cb: () => void) => { ready: Promise<void>; finished: Promise<void> };

/** Where the falling sheet of rain has got to: its lower edge, with drips running ahead. */
const DRIPS = Array.from({ length: 29 }, (_, i) => (i % 2 ? 0.25 + Math.random() * 0.75 : Math.random() * 0.25));
function curtain(k: number) {
  const pts = ["0% -20%", "100% -20%"];
  for (let i = DRIPS.length - 1; i >= 0; i--) pts.push(`${((i / (DRIPS.length - 1)) * 100).toFixed(2)}% ${(k * 100 + DRIPS[i] * 16 - 8).toFixed(2)}%`);
  return `polygon(${pts.join(", ")})`;
}

/**
 * Changing the scene. Rain comes down over everything like a sheet of water running down
 * the window; the eclipse opens out from where you clicked, like the accent does.
 */
function pickScene(id: SceneId, e: React.MouseEvent) {
  const s = useApp.getState();
  if (s.settings.scene === id) return;
  const set = () => s.setSettings({ scene: id });
  const start = (document as Document & { startViewTransition?: ViewTransitionStart }).startViewTransition;
  if (!start || !fx.active) {
    set();
    return;
  }
  const root = document.documentElement;
  root.classList.add("vt-accent");
  const x = e.clientX;
  const y = e.clientY;
  const t = start.call(document, () => {
    flushSync(set);
    fx.renderNow();
  });
  t.ready
    .then(() => {
      if (fx.rain) {
        root.animate(
          { clipPath: [curtain(-0.18), curtain(0.5), curtain(1.2)] },
          { duration: 1300, easing: "cubic-bezier(0.5, 0, 0.3, 1)", pseudoElement: "::view-transition-new(root)" },
        );
      } else {
        const radius = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y));
        root.animate(
          { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${radius}px at ${x}px ${y}px)`] },
          { duration: 900, easing: "cubic-bezier(0.22, 0.9, 0.25, 1)", pseudoElement: "::view-transition-new(root)" },
        );
        fx.ring(x, y, 8, 140, { dur: 800 });
      }
    })
    .catch(() => {});
  t.finished.finally(() => root.classList.remove("vt-accent"));
}

const SCENES: { id: SceneId; name: string; sub: string }[] = [
  { id: "eclipse", name: "Eclipse", sub: "A living corona in deep space" },
  { id: "rain", name: "Rain", sub: "A city at night, through a wet window" },
];

function ScenePicker() {
  const scene = useApp((s) => s.settings.scene);
  return (
    <div className="scenes" role="radiogroup" aria-label="Scene">
      {SCENES.map((sc) => {
        const on = (scene === "rain" ? "rain" : "eclipse") === sc.id;
        return (
          <button key={sc.id} type="button" role="radio" aria-checked={on} className={`scene-card is-${sc.id} ${on ? "is-on" : ""}`} onClick={(e) => pickScene(sc.id, e)}>
            <span className="scene-art" aria-hidden>
              {sc.id === "eclipse" ? (
                <Eclipse progress={1} size={34} />
              ) : (
                <>
                  <span className="scene-rain" />
                  <span className="scene-drop a" />
                  <span className="scene-drop b" />
                  <span className="scene-drop c" />
                </>
              )}
            </span>
            <span className="scene-text">
              <span className="scene-name">{sc.name}</span>
              <span className="scene-sub">{sc.sub}</span>
            </span>
            {on && <motion.span layoutId="scene-ring" className="scene-ring" transition={spring} />}
          </button>
        );
      })}
    </div>
  );
}

function RainVolume() {
  const volume = useApp((s) => s.settings.rainVolume);
  const setSettings = useApp((s) => s.setSettings);
  const v = typeof volume === "number" ? volume : 0.6;
  return (
    <input
      type="range"
      className="range"
      min={0.05}
      max={1}
      step={0.05}
      value={v}
      aria-label="Rain volume"
      style={{ "--v": `${v * 100}%` } as React.CSSProperties}
      onChange={(e) => setSettings({ rainVolume: Number(e.target.value) })}
    />
  );
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

/** A few soft, readable inks — plus any color you like. */
const INKS: { id: string; name: string; color: string }[] = [
  { id: "", name: "Default", color: "#f3f3f5" },
  { id: "#f4ecdf", name: "Paper", color: "#f4ecdf" },
  { id: "#dbe4ff", name: "Moonlight", color: "#dbe4ff" },
  { id: "#cff3e3", name: "Mint", color: "#cff3e3" },
  { id: "#ffd8e5", name: "Blossom", color: "#ffd8e5" },
  { id: "#ffe1b3", name: "Amber", color: "#ffe1b3" },
];

function InkPicker() {
  const ink = useApp((s) => s.settings.ink);
  const setSettings = useApp((s) => s.setSettings);
  const custom = Boolean(ink) && !INKS.some((i) => i.id === ink);
  return (
    <div className="swatches" role="radiogroup" aria-label="Text color">
      {INKS.map((i) => (
        <button
          key={i.name}
          type="button"
          role="radio"
          aria-checked={ink === i.id}
          aria-label={i.name}
          title={i.name}
          className="swatch"
          style={{ "--sw": i.color } as React.CSSProperties}
          onClick={() => setSettings({ ink: i.id })}
        >
          {ink === i.id && <motion.span layoutId="ink-ring" className="swatch-ring" transition={spring} />}
          <span className="swatch-core" />
        </button>
      ))}
      <label className={`swatch swatch-custom ${custom ? "is-set" : ""}`} title="Pick any color" style={{ "--sw": custom ? ink : "#f3f3f5" } as React.CSSProperties}>
        {custom && <motion.span layoutId="ink-ring" className="swatch-ring" transition={spring} />}
        <span className="swatch-core" />
        <input type="color" aria-label="Custom text color" value={/^#[0-9a-f]{6}$/i.test(ink) ? ink : "#f3f3f5"} onChange={(e) => setSettings({ ink: e.target.value })} />
      </label>
    </div>
  );
}

function AccountRow() {
  const user = useAccount((s) => s.user);
  const sync = useAccount((s) => s.sync);
  const setUI = useApp((s) => s.setUI);
  return (
    <Row
      label={user ? `Signed in as @${user.username}` : "Sync across devices"}
      desc={
        user
          ? sync === "offline"
            ? "Offline — changes will sync when you're back."
            : "Your notes, lists, shared links and settings follow you to every device. End-to-end encrypted."
          : "Create a free account to see your notes on your phone and laptop, and keep every note shared with you in one place."
      }
    >
      <button type="button" className="ghost-btn" onClick={() => setUI({ settings: false, account: true })}>
        {user ? "Manage" : "Sign in"}
      </button>
    </Row>
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
          {settings.effects !== "off" && (
            <div className="set-row column">
              <div className="set-row-text">
                <span className="set-row-label">Scene</span>
                <div className="set-row-desc">What's out there, behind the glass.</div>
              </div>
              <ScenePicker />
            </div>
          )}
          {settings.effects !== "off" && settings.scene === "rain" && (
            <>
              <Row label="Lightning" desc="A storm rolls through now and then — never while you're typing.">
                <Switch checked={settings.lightning} onChange={(v) => setSettings({ lightning: v })} label="Lightning" />
              </Row>
              <Row label="City lights" desc="The blurred lights of the city behind the glass.">
                <Switch checked={settings.cityLights} onChange={(v) => setSettings({ cityLights: v })} label="City lights" />
              </Row>
              <Row label="How hard it rains">
                <Segmented<RainAmountId>
                  label="How hard it rains"
                  size="sm"
                  value={settings.rainAmount}
                  options={[
                    { value: "drizzle", label: "Drizzle" },
                    { value: "rain", label: "Rain" },
                    { value: "downpour", label: "Downpour" },
                  ]}
                  onChange={(rainAmount) => setSettings({ rainAmount })}
                />
              </Row>
              <Row label="Rain sound" desc="Soft rain on the window, and thunder after the lightning. Just on this device.">
                <div className="set-inline">
                  {settings.rainSound && <RainVolume />}
                  <Switch checked={settings.rainSound} onChange={(v) => setSettings({ rainSound: v })} label="Rain sound" />
                </div>
              </Row>
            </>
          )}
          <Row label="Accent" desc="Tints the caret, checkmarks and the glow.">
            <Swatches />
          </Row>
          <Row label="Text color" desc="The color of your writing. Very dark picks get lifted so they stay readable.">
            <InkPicker />
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
          <Row label="Effects" desc={settings.scene === "rain" ? "The rain, the lightning, splashes and drips. Calm it down any time." : "The living sky, solar flares, light trails and embers. Calm it down any time."}>
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
                  { value: "crystal", label: "Crystal" },
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

        <Section title="Account">
          <AccountRow />
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
