import { Droplet, Moon, Sun, Type } from "lucide-react";
import { useApp } from "../../store/app";
import { Row } from "../../components/overlays/settingsParts";
import { Switch } from "../../components/ui/Switch";
import { Segmented, SegmentedEpoch } from "../../components/ui/Segmented";
import { fx } from "../../fx/engine";
import { changeInkDark } from "../../fx/transitions";
import inkCard from "./card.webp";
import inkNightCard from "./card-night.webp";
import type { SceneUI } from "../types";

/**
 * Ink: a drop of ink that has plunged in from the surface, curling open on its way down, over
 * clouds of ink gathering below, with light from the surface playing on the paper — a moment of
 * the scene itself (the real-water simulation, photographed). By night, the same in dark water.
 */
function InkArt() {
  const dark = useApp((s) => s.settings.inkDark === true);
  return <img className="scene-img" src={dark ? inkNightCard : inkCard} alt="" aria-hidden draggable={false} decoding="async" />;
}

/** Ink's own settings (letters settle with effects off too: it's how typing feels, not the scene). */
function InkSettings() {
  const on = useApp((s) => s.settings.inkLetters === true);
  const colours = useApp((s) => (s.settings.inkColours === "accent" ? "accent" : "sumi"));
  const detail = useApp((s) => (s.settings.inkDetail === "standard" ? "standard" : "high"));
  const dark = useApp((s) => s.settings.inkDark === true);
  const scene = useApp((s) => s.settings.scene);
  const effects = useApp((s) => s.settings.effects);
  const setSettings = useApp((s) => s.setSettings);
  // (only where the ink is in real water: the lighter ink keeps to charcoal and indigo)
  const water = effects !== "off" && fx.sky?.inkFluid !== false;
  return (
    <>
      <Row label="Dark mode" desc="Ink by night: dark water, the ink glowing pale in it — and everything else dark to match.">
        <Switch checked={dark} onChange={changeInkDark} label="Dark mode" />
      </Row>
      {water && (
        <SegmentedEpoch.Provider value={scene}>
          <Row label="Ink colours" desc={dark ? "The drops falling into the water: pale silver and deep blue, or with drops of your accent colour among them too." : "The drops falling into the water: charcoal and indigo, or with drops of your accent colour among them too."}>
            <Segmented<"sumi" | "accent">
              label="Ink colours"
              size="sm"
              value={colours}
              options={[
                { value: "sumi", label: "Ink" },
                { value: "accent", label: "+ Accent" },
              ]}
              onChange={(v) => setSettings({ inkColours: v })}
            />
          </Row>
          <Row label="Ink detail" desc="How finely the ink is drawn. Standard is lighter on your graphics card.">
            <Segmented<"standard" | "high">
              label="Ink detail"
              size="sm"
              value={detail}
              options={[
                { value: "high", label: "High" },
                { value: "standard", label: "Standard" },
              ]}
              onChange={(v) => setSettings({ inkDetail: v })}
            />
          </Row>
        </SegmentedEpoch.Provider>
      )}
      <Row label="Ink settling letters" desc={dark ? "Each letter you type lands in wet ink, glowing faintly blue, and dries as you write on." : "Each letter you type lands in wet, blue-black ink and dries as you write on."}>
        <Switch checked={on} onChange={(v) => setSettings({ inkLetters: v })} label="Ink settling letters" />
      </Row>
    </>
  );
}

export const inkUI: SceneUI = {
  Art: InkArt,
  icon: <Droplet size={15} strokeWidth={1.6} />,
  Settings: InkSettings,
  commands: (settings, set) => [
    {
      id: "ink-dark",
      label: settings.inkDark === true ? "Ink by day: back to paper" : "Ink by night: dark mode",
      icon: settings.inkDark === true ? <Sun size={15} strokeWidth={1.6} /> : <Moon size={15} strokeWidth={1.6} />,
      keywords: "dark mode night black light mode day paper ink theme invert",
      run: () => changeInkDark(settings.inkDark !== true),
    },
    {
      id: "ink-settle",
      label: settings.inkLetters === true ? "Turn settling letters off" : "Turn settling letters on",
      icon: <Type size={15} strokeWidth={1.6} />,
      keywords: "ink letters typing wet dry soak settle bleed fountain pen effect",
      run: () => set({ inkLetters: settings.inkLetters !== true }),
    },
    // (only where the ink is in real water)
    ...(fx.sky?.inkFluid
      ? [
          {
            id: "ink-colours",
            label: settings.inkColours === "accent" ? "Ink in charcoal and indigo" : "Ink in your accent colour too",
            icon: <Droplet size={15} strokeWidth={1.6} />,
            keywords: "ink colour color accent drops water charcoal indigo",
            run: () => set({ inkColours: settings.inkColours === "accent" ? "sumi" : "accent" }),
          },
        ]
      : []),
  ],
};
