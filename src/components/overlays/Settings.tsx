import { useRef, useState, type ReactNode } from "react";
import { motion } from "motion/react";
import { Download, FileText, LayoutList, Link2, Upload, X } from "lucide-react";
import { useApp } from "../../store/app";
import { BOARD, shareUrl, stopShare } from "../../store/shareSync";
import { exportAll, importBackup } from "../../store/persist";
import { toast } from "../../store/toasts";
import { ACCENTS, FONTS } from "../../lib/theme";
import type { AccentId, BackdropId, EffectsId, FontId, RainAmountId, SceneId, SizeId } from "../../lib/types";
import { displayTitle } from "../../lib/text";
import { relativeLong } from "../../lib/dates";
import { download, flushEditor } from "../../lib/actions";
import { spring } from "../../lib/motion";
import { Modal } from "../ui/Modal";
import { useAccount } from "../../account/account";
import { Switch } from "../ui/Switch";
import { Segmented, SegmentedEpoch } from "../ui/Segmented";
import { IconButton } from "../ui/IconButton";
import { Eclipse } from "../ui/Eclipse";
import { changeAccent, changeScene } from "../../fx/transitions";

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

/** The rain card's picture: a still of the scene — bokeh, rain scattered at random, a few drops on the glass. */
// prettier-ignore
const RAIN_STREAKS: [number, number, number, number, number, number][] = [[108.2,36.5,106.9,43.4,0.47,0.37],[195.4,30.2,193.4,40.3,0.14,0.58],[18.5,55.5,16.1,68.1,0.26,0.61],[157.2,41.4,155.8,48.8,0.17,0.55],[144.7,53.1,143.7,58.5,0.46,0.45],[65.0,69.8,64.3,73.6,0.27,0.38],[67.7,-0.7,67.0,2.7,0.46,0.42],[233.6,58.4,233.0,61.5,0.49,0.33],[89.1,47.9,88.0,53.7,0.39,0.52],[78.5,67.3,77.9,70.3,0.41,0.32],[165.2,8.3,163.7,16.2,0.42,0.35],[155.6,2.9,154.0,11.3,0.16,0.54],[237.8,39.0,237.2,42.1,0.3,0.54],[241.3,10.2,240.4,14.6,0.38,0.54],[91.8,-0.4,90.9,4.2,0.25,0.48],[88.2,28.4,86.5,37.3,0.37,0.55],[41.3,5.7,40.3,10.8,0.25,0.37],[179.4,65.5,178.5,70.3,0.3,0.45],[15.5,-2.4,14.9,0.5,0.51,0.38],[174.6,-0.8,173.7,3.7,0.4,0.48],[222.9,50.9,222.3,54.1,0.32,0.34],[39.7,22.0,37.6,32.7,0.14,0.54],[107.7,19.2,105.2,32.1,0.26,0.54],[4.7,-4.6,3.6,1.3,0.51,0.33],[177.2,18.2,176.6,21.1,0.36,0.51],[170.5,54.3,169.5,59.5,0.41,0.55],[212.0,25.7,211.2,29.7,0.37,0.48],[147.0,0.1,145.0,10.3,0.18,0.62],[168.2,28.8,166.7,36.7,0.19,0.52],[3.4,39.7,2.3,45.4,0.5,0.35],[189.4,44.2,188.2,50.5,0.16,0.4],[38.1,62.8,35.4,76.9,0.24,0.57],[96.4,13.0,94.1,24.7,0.32,0.76],[140.6,18.1,139.9,21.9,0.29,0.55],[24.0,29.8,23.0,34.9,0.3,0.46],[204.8,41.5,203.9,46.1,0.17,0.55],[192.3,-4.5,191.5,-0.2,0.23,0.52],[62.1,53.2,61.3,57.4,0.2,0.35],[128.8,42.6,127.5,49.1,0.41,0.37],[113.8,7.6,113.0,11.5,0.35,0.33],[52.2,53.2,50.3,62.9,0.24,0.67],[192.4,62.9,191.7,66.3,0.48,0.42],[216.1,-5.5,214.3,3.7,0.33,0.72],[230.2,29.2,227.4,43.5,0.14,0.74],[26.6,12.4,25.0,20.7,0.51,0.46],[82.4,0.3,81.1,6.9,0.31,0.39],[224.1,10.6,223.4,14.0,0.17,0.46],[112.7,70.0,110.3,82.1,0.28,0.62],[162.5,66.6,161.0,74.5,0.47,0.57],[45.8,34.7,44.4,41.9,0.3,0.46],[6.9,63.7,4.9,73.8,0.25,0.64],[129.6,25.4,128.4,31.8,0.33,0.35],[103.6,56.0,102.2,63.1,0.2,0.43],[3.3,13.8,0.7,27.1,0.12,0.55],[75.9,21.0,74.2,30.0,0.34,0.47],[153.0,56.7,151.5,64.5,0.23,0.48],[208.5,11.7,206.1,24.3,0.2,0.55],[220.5,30.6,219.7,34.5,0.23,0.54],[241.6,64.4,240.9,68.0,0.21,0.5],[87.8,64.1,86.3,71.9,0.34,0.32],[152.1,24.7,150.6,32.6,0.37,0.41],[185.1,15.2,184.4,19.0,0.44,0.53]];
// prettier-ignore
const RAIN_BOKEH: [number, number, number, string, number][] = [[212.6, 41.3, 9.4, "#8fd0ff", 0.27], [230.6, 49.0, 9.2, "#ffd9a8", 0.33], [171.4, 61.0, 8.4, "#fff0d0", 0.35], [8.0, 43.4, 8.1, "#ff9e7a", 0.37], [25.6, 44.4, 8.0, "#ffa85c", 0.3], [7.8, 30.2, 5.4, "#d6b8ff", 0.31], [89.2, 40.1, 5.3, "#c4ceff", 0.4], [83.7, 73.7, 4.8, "#9fe6c6", 0.31], [63.0, 31.2, 4.6, "#6ed6ff", 0.36], [32.8, 35.4, 4.5, "#fff0d0", 0.21], [226.6, 29.9, 4.2, "#ff9e7a", 0.36], [162.7, 34.5, 4.2, "#fff0d0", 0.37], [228.7, 70.0, 4.0, "#d6b8ff", 0.26], [99.8, 34.1, 3.7, "#8fd0ff", 0.48], [72.5, 68.2, 3.5, "#8fd0ff", 0.44], [91.0, 64.5, 3.2, "#ff5470", 0.5], [44.1, 41.8, 2.8, "#ff9e7a", 0.33], [133.3, 57.8, 2.7, "#d6b8ff", 0.44], [157.3, 56.4, 2.5, "#d6b8ff", 0.38], [175.3, 43.6, 2.4, "#ffa85c", 0.34], [102.6, 53.8, 2.2, "#8fd0ff", 0.36], [112.0, 35.6, 2.2, "#fff0d0", 0.56], [134.4, 49.1, 2.2, "#fff0d0", 0.57], [100.2, 27.1, 2.1, "#ffce92", 0.48]];
// prettier-ignore
const RAIN_DROPS: [number, number, number][] = [[77.9, 36.4, 1.8], [70.4, 42.1, 1.7], [163.8, 18.6, 1.2], [62.7, 61.3, 1.5], [153.6, 19.0, 1.7], [148.3, 8.5, 1.2], [15.9, 10.1, 1.1], [121.2, 50.3, 1.9], [45.4, 21.1, 2.0], [196.5, 27.8, 1.3]];

function RainArt() {
  return (
    <svg className="scene-svg" viewBox="0 0 240 72" preserveAspectRatio="xMidYMid slice" aria-hidden>
      <defs>
        <linearGradient id="sc-sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#090c14" />
          <stop offset="0.55" stopColor="#120f17" />
          <stop offset="1" stopColor="#1c1411" />
        </linearGradient>
        <filter id="sc-soft" filterUnits="userSpaceOnUse" x="-20" y="-20" width="280" height="112">
          <feGaussianBlur stdDeviation="2.1" />
        </filter>
        <radialGradient id="sc-drop" cx="0.38" cy="0.34" r="0.7">
          <stop offset="0" stopColor="#fff" />
          <stop offset="0.22" stopColor="rgb(255 255 255 / 0.18)" />
          <stop offset="0.8" stopColor="rgb(0 0 0 / 0.35)" />
          <stop offset="1" stopColor="rgb(255 255 255 / 0.3)" />
        </radialGradient>
      </defs>
      <rect width="240" height="72" fill="url(#sc-sky)" />
      <g filter="url(#sc-soft)">
        {RAIN_BOKEH.map(([x, y, r, c, o], i) => (
          <circle key={i} cx={x} cy={y} r={r * 1.25} fill={c} fillOpacity={Math.min(0.85, o * 1.35)} />
        ))}
        <circle cx={140} cy={44} r={6.8} style={{ fill: "var(--accent)" }} fillOpacity={0.45} />
      </g>
      <g stroke="#d4e2ff" strokeLinecap="round">
        {RAIN_STREAKS.map(([x1, y1, x2, y2, o, w], i) => (
          <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} strokeOpacity={o} strokeWidth={w} />
        ))}
      </g>
      {RAIN_DROPS.map(([x, y, r], i) => (
        <circle key={i} cx={x} cy={y} r={r} fill="url(#sc-drop)" />
      ))}
    </svg>
  );
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
          <button key={sc.id} type="button" role="radio" aria-checked={on} className={`scene-card is-${sc.id} ${on ? "is-on" : ""}`} onClick={(e) => changeScene(sc.id, e.clientX, e.clientY)}>
            <span className="scene-art" aria-hidden>
              {sc.id === "eclipse" ? <Eclipse progress={1} size={34} /> : <RainArt />}
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

/** How out of focus the city behind the rain is. The drops on the glass always stay sharp. */
function RainBlur() {
  const blur = useApp((s) => s.settings.cityBlur);
  const setSettings = useApp((s) => s.setSettings);
  const v = typeof blur === "number" ? blur : 1;
  return (
    <input
      type="range"
      className="range wide"
      min={0}
      max={1}
      step={0.01}
      value={v}
      aria-label="Blur"
      style={{ "--v": `${v * 100}%` } as React.CSSProperties}
      onChange={(e) => setSettings({ cityBlur: Number(e.target.value) })}
    />
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
  const scene = useApp((s) => s.settings.scene);
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
          onClick={(e) => changeAccent(id, e.clientX, e.clientY)}
        >
          {accent === id && <motion.span layoutId={`swatch-ring-${scene}`} className="swatch-ring" transition={spring} />}
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
  const scene = useApp((s) => s.settings.scene);
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
          {ink === i.id && <motion.span layoutId={`ink-ring-${scene}`} className="swatch-ring" transition={spring} />}
          <span className="swatch-core" />
        </button>
      ))}
      <label className={`swatch swatch-custom ${custom ? "is-set" : ""}`} title="Pick any color" style={{ "--sw": custom ? ink : "#f3f3f5" } as React.CSSProperties}>
        {custom && <motion.span layoutId={`ink-ring-${scene}`} className="swatch-ring" transition={spring} />}
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
                  toast("Couldn't reach the server — try again", {
                    tone: "error",
                  });
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
    <SegmentedEpoch.Provider value={settings.scene}>
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
                <Row label="Blur" desc="How out of focus the city is. The drops on the glass stay sharp.">
                  <RainBlur />
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
            <Row
              label="Effects"
              desc={settings.scene === "rain" ? "The rain, the lightning, splashes and drips. Calm it down any time." : "The living sky, solar flares, light trails and embers. Calm it down any time."}
            >
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
              <Switch
                checked={settings.todos}
                onChange={(v) =>
                  setSettings({
                    todos: v,
                    rail: v || settings.countdowns ? true : settings.rail,
                  })
                }
                label="To-do list"
              />
            </Row>
            <Row label="Countdowns" desc="Days until trips, birthdays, launches.">
              <Switch
                checked={settings.countdowns}
                onChange={(v) =>
                  setSettings({
                    countdowns: v,
                    rail: v || settings.todos ? true : settings.rail,
                  })
                }
                label="Countdowns"
              />
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
    </SegmentedEpoch.Provider>
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
