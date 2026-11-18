import { useEffect, useRef, useState } from "react";
import { motion } from "motion/react";
import { Check, Download, FileText, LayoutList, Link2, MonitorDown, Upload, X } from "lucide-react";
import { useApp } from "../../store/app";
import { hasPanel } from "../../lib/panel";
import { goalOf } from "../widgets/Writing";
import { takeOffTheme } from "../../fx/look";
import { BOARD, shareUrl, stopShare } from "../../store/shareSync";
import { exportAll, importBackup } from "../../store/persist";
import { toast } from "../../store/toasts";
import { ACCENTS, FONTS, TITLE_FONTS, TRANSPARENCY, accentColor, isLightScene, sceneOf } from "../../lib/theme";
import type { AccentId, BackdropId, EffectsId, FontId, SizeId, TitleFontId } from "../../lib/types";
import { displayTitle } from "../../lib/text";
import { relativeLong } from "../../lib/dates";
import { download, flushEditor } from "../../lib/actions";
import { spring } from "../../lib/motion";
import { Modal } from "../ui/Modal";
import { useAccount } from "../../account/account";
import { Switch } from "../ui/Switch";
import { Segmented, SegmentedEpoch } from "../ui/Segmented";
import { IconButton } from "../ui/IconButton";
import { changeAccent, changeScene } from "../../fx/transitions";
import { BUILD_SHA, BUILD_TIME, VERSION } from "../../version";
import { SCENES, SCENE_LIST } from "../../scenes/meta";
import { installApp, usePwa } from "../../lib/pwa";
import { apple } from "../../lib/platform";
import { SCENE_UI } from "../../scenes/ui";
import { Row, Section } from "./settingsParts";

function ScenePicker() {
  const scene = useApp((s) => s.settings.scene);
  const inkDark = useApp((s) => s.settings.inkDark === true);
  const current = sceneOf(scene);
  // (a hidden scene has a card only while it's the one you're in)
  const shown = SCENE_LIST.filter((sc) => !sc.hidden || sc.id === current);
  return (
    <div className="scenes" role="radiogroup" aria-label="Scene" data-count={shown.length}>
      {shown.map((sc) => {
        const on = current === sc.id;
        const Art = SCENE_UI[sc.id].Art;
        return (
          <button key={sc.id} type="button" role="radio" aria-checked={on} className={`scene-card is-${sc.id} ${on ? "is-on" : ""}`} onClick={(e) => changeScene(sc.id, e.clientX, e.clientY)}>
            <span className="scene-art" aria-hidden>
              <Art />
            </span>
            <span className="scene-text">
              <span className="scene-name">{sc.name}</span>
              <span className="scene-sub">{sc.id === "ink" && inkDark && sc.nightTagline ? sc.nightTagline : sc.tagline}</span>
            </span>
            {on && <motion.span key={current} layoutId={`scene-ring-${current}`} className="scene-ring" transition={spring} />}
          </button>
        );
      })}
    </div>
  );
}

/**
 * umbra as an app: installing it (a window and an icon of its own — on a Chromebook's shelf, a
 * computer's taskbar, a phone's home screen), and whether it opens without the internet.
 */
function AppRows() {
  const canInstall = usePwa((s) => s.canInstall);
  const installed = usePwa((s) => s.installed);
  const offline = usePwa((s) => s.offline);
  const ua = navigator.userAgent;
  // (where the browser won't offer it here: how to, in this one)
  const how = apple
    ? "On iPhone and iPad: in Safari, tap Share, then Add to Home Screen."
    : /Firefox\//.test(ua)
      ? "Firefox doesn't install web apps — open umbra in Chrome or Edge to install it."
      : /Safari\//.test(ua) && !/Chrome|Chromium|Edg\//.test(ua)
        ? "In Safari on a Mac: File → Add to Dock."
        : "Installed already? Open it from your launcher. If not: the install icon at the right of the address bar — or the browser's ⋮ menu → Cast, save and share → Install page as app.";
  return (
    <>
      <Row
        label="Install umbra"
        desc={
          installed
            ? "You're in the app. Open it from your launcher, pin it to your shelf or taskbar — and right-click its icon for a new note."
            : canInstall
              ? "In a window of its own, with its own icon: in your launcher, and pinned to your shelf or taskbar if you like. Right-click the icon for a new note."
              : how
        }
      >
        {installed ? (
          <span className="set-status is-on">
            <Check size={13} strokeWidth={2.4} /> Installed
          </span>
        ) : canInstall ? (
          <button type="button" className="primary-btn sm set-install" onClick={() => void installApp()}>
            <MonitorDown size={14} strokeWidth={1.9} /> Install
          </button>
        ) : null}
      </Row>
      <Row label="Works offline" desc="umbra opens without the internet. Your notes are always saved on this device first — signed in, they sync by themselves once you're back online.">
        <span className={`set-status ${offline === "ready" ? "is-on" : ""}`}>
          {offline === "ready" ? (
            <>
              <Check size={13} strokeWidth={2.4} /> Ready
            </>
          ) : offline === "setting-up" ? (
            "Getting ready…"
          ) : offline === "dev" ? (
            "Once it's deployed"
          ) : (
            "Not in this browser"
          )}
        </span>
      </Row>
    </>
  );
}

/** The scene's own settings (each scene's rows live with it: scenes/<id>/ui.tsx). */
function SceneRows() {
  const scene = useApp((s) => sceneOf(s.settings.scene));
  const Rows = SCENE_UI[scene].Settings;
  return Rows ? <Rows /> : null;
}

function Swatches() {
  const accent = useApp((s) => s.settings.accent);
  const scene = useApp((s) => `${s.settings.scene}:${s.settings.solarLook}:${s.settings.inkDark === true}`);
  // on paper, each swatch shows its colour as the ink carries it
  const sceneId = useApp((s) => sceneOf(s.settings.scene));
  const inkDark = useApp((s) => s.settings.inkDark === true);
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
          style={{ "--sw": accentColor(id, sceneId, inkDark) } as React.CSSProperties}
          onClick={(e) => changeAccent(id, e.clientX, e.clientY)}
        >
          {accent === id && <motion.span key={scene} layoutId={`swatch-ring-${scene}`} className="swatch-ring" transition={spring} />}
          <span className="swatch-core" />
        </button>
      ))}
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

/** Only devices with a pointer that hovers have a cursor to light things with. */
const hasCursor = typeof matchMedia !== "undefined" && matchMedia("(hover: hover) and (pointer: fine)").matches;

function SettingsBody({ onClose }: { onClose: () => void }) {
  const settings = useApp((s) => s.settings);
  const setSettings = useApp((s) => s.setSettings);
  const meta = SCENES[sceneOf(settings.scene)];
  // (Ink by night: the water's dark, and its light is light again)
  const night = meta.id === "ink" && settings.inkDark === true;
  const fileInput = useRef<HTMLInputElement>(null);
  const signedIn = useAccount((s) => Boolean(s.user));

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
    <SegmentedEpoch.Provider value={`${settings.scene}:${settings.solarLook}`}>
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
            <SceneRows />
            <Row label="Accent" desc={isLightScene(meta.id, settings.inkDark) ? "Tints the caret, checkmarks and links — in a deeper, inkier shade on paper." : "Tints the caret, checkmarks and the glow."}>
              <Swatches />
            </Row>
            {settings.effects !== "off" && (
              <Row label="Transparency" desc={night ? "How much of the dark water shows through. Your words always stay readable." : meta.backdropDesc}>
                <Segmented<BackdropId>
                  label="Transparency"
                  size="sm"
                  value={settings.backdrop}
                  options={TRANSPARENCY.map((t) => ({ value: t.id, label: t.name }))}
                  onChange={(backdrop) => setSettings({ backdrop })}
                />
              </Row>
            )}
            <Row label="Writing font">
              <Segmented label="Writing font" value={settings.font} options={fontOptions} onChange={(font) => setSettings({ font })} />
            </Row>
            <Row label="Title font" desc="For every note's title. Right-click a title to give just that note its own font, size and alignment.">
              <Segmented<TitleFontId>
                label="Title font"
                size="sm"
                value={settings.titleFont && settings.titleFont in TITLE_FONTS ? settings.titleFont : "display"}
                options={(Object.keys(TITLE_FONTS) as TitleFontId[]).map((id) => ({
                  value: id,
                  title: TITLE_FONTS[id].name,
                  label: (
                    <span className={`title-font-opt is-${id}`} style={{ fontFamily: TITLE_FONTS[id].stack, fontStyle: TITLE_FONTS[id].italic ? "italic" : undefined }}>
                      {id === "italic" ? "Italic" : TITLE_FONTS[id].name}
                    </span>
                  ),
                }))}
                onChange={(titleFont) => setSettings({ titleFont })}
              />
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
              desc={meta.effectsDesc}
            >
              <Segmented<EffectsId>
                label="Effects"
                size="sm"
                value={settings.effects}
                options={[
                  { value: "cosmic", label: "Max" },
                  { value: "subtle", label: "Subtle" },
                  { value: "off", label: "Off" },
                ]}
                onChange={(effects) => setSettings({ effects })}
              />
            </Row>
            {settings.effects !== "off" && hasCursor && (
              <Row
                label="Cursor light"
                desc={night ? "Your cursor stirs the water as it passes, and catches the edges of things in its light." : meta.cursorDesc}
              >
                <Switch checked={settings.cursorLight !== false} onChange={(v) => setSettings({ cursorLight: v })} label="Cursor light" />
              </Row>
            )}
            <Row label="Fade while typing" desc="Everything except your words quietly dims as you write.">
              <Switch checked={settings.fadeWhileTyping} onChange={(v) => setSettings({ fadeWhileTyping: v })} label="Fade while typing" />
            </Row>
            <Row label="Character count" desc="Beside the word count under each note's title. Hover it for the count without spaces.">
              <Switch checked={settings.charCount === true} onChange={(v) => setSettings({ charCount: v })} label="Character count" />
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
            <Row label="Writing stats" desc="The words you've written today, your streak and a goal ring, at the top of the side panel.">
              <Switch
                checked={settings.writing === true}
                onChange={(v) =>
                  setSettings({
                    writing: v,
                    rail: v || settings.todos || settings.countdowns ? true : settings.rail,
                  })
                }
                label="Writing stats"
              />
            </Row>
            {settings.writing && (
              <Row label="Daily goal" desc="How many words a day fill the ring.">
                <Segmented<"100" | "250" | "500" | "1000" | "2000">
                  label="Daily goal"
                  size="sm"
                  value={String(goalOf(settings.writingGoal)) as "100" | "250" | "500" | "1000" | "2000"}
                  options={[
                    { value: "100", label: "100" },
                    { value: "250", label: "250" },
                    { value: "500", label: "500" },
                    { value: "1000", label: "1k" },
                    { value: "2000", label: "2k" },
                  ]}
                  onChange={(g) => setSettings({ writingGoal: Number(g) })}
                />
              </Row>
            )}
            {hasPanel(settings) && (
              <Row label="Milliseconds" desc="Show fractions of a second on the clock.">
                <div className="set-inline">
                  {settings.clockMs && (
                    <Segmented<"1" | "2" | "3">
                      label="Digits"
                      size="sm"
                      value={String(settings.clockMsDigits ?? 3) as "1" | "2" | "3"}
                      options={[
                        { value: "1", label: <span className="mono">.1</span> },
                        { value: "2", label: <span className="mono">.12</span> },
                        { value: "3", label: <span className="mono">.123</span> },
                      ]}
                      onChange={(d) => setSettings({ clockMsDigits: Number(d) as 1 | 2 | 3 })}
                    />
                  )}
                  <Switch checked={settings.clockMs === true} onChange={(v) => setSettings({ clockMs: v })} label="Milliseconds" />
                </div>
              </Row>
            )}
            <Row label="Sounds" desc="Soft ticks when you check things off.">
              <Switch checked={settings.sounds} onChange={(v) => setSettings({ sounds: v })} label="Sounds" />
            </Row>
          </Section>

          <Section title="Account">
            <AccountRow />
          </Section>

          <Section title="Sharing">
            <div className="set-row column">
              <div className="set-row-text">
                <span className="set-row-label">Live links</span>
                <div className="set-row-desc">Turning a link off makes it stop working immediately.</div>
              </div>
              <LiveLinks />
            </div>
          </Section>

          <Section title="App">
            <AppRows />
          </Section>

          <Section title="Your data">
            <Row
              label="Backup"
              desc={
                signedIn
                  ? "Everything is synced to your account, end-to-end encrypted. Export a file whenever you'd like a copy of your own."
                  : "Without an account, your notes live only in this browser. Export a backup now and then — or sign in to keep them synced."
              }
            >
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

          <Section title="About">
            <Row
              label="Show version"
              desc={`A small v${VERSION} next to umbra, top left — handy for screenshots. This is build ${BUILD_SHA}${BUILD_TIME ? `, from ${new Date(BUILD_TIME).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}` : ""}.`}
            >
              <Switch checked={settings.showVersion === true} onChange={(v) => setSettings({ showVersion: v })} label="Show version" />
            </Row>
          </Section>

          <footer className="settings-foot">
            <span className="display">umbra</span>
            <span className="mono">a quiet place to write · v{VERSION}</span>
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
  // Settings is your own look: wearing a shared note's theme, it comes off as Settings opens
  // (the note's "Use their theme" puts it back)
  useEffect(() => {
    if (open && useApp.getState().borrowed) takeOffTheme();
  }, [open]);
  return (
    <Modal open={open} onClose={close} className="settings" label="Settings">
      <SettingsBody onClose={close} />
    </Modal>
  );
}
