import { Droplet, Type } from "lucide-react";
import { useApp } from "../../store/app";
import { Row } from "../../components/overlays/settingsParts";
import { Switch } from "../../components/ui/Switch";
import { Segmented, SegmentedEpoch } from "../../components/ui/Segmented";
import { fx } from "../../fx/engine";
import inkCard from "./card.webp";
import type { SceneUI } from "../types";

/**
 * Ink: a drop of ink that has plunged in from the surface, curling open on its way down, over
 * clouds of ink gathering below, with light from the surface playing on the paper — a moment of
 * the scene itself (the real-water simulation, photographed).
 */
function InkArt() {
  return <img className="scene-img" src={inkCard} alt="" aria-hidden draggable={false} decoding="async" />;
}

/** Ink's own settings (letters settle with effects off too: it's how typing feels, not the scene). */
function InkSettings() {
  const on = useApp((s) => s.settings.inkSettle !== false);
  const colours = useApp((s) => (s.settings.inkColours === "accent" ? "accent" : "sumi"));
  const detail = useApp((s) => (s.settings.inkDetail === "standard" ? "standard" : "high"));
  const scene = useApp((s) => s.settings.scene);
  const effects = useApp((s) => s.settings.effects);
  const setSettings = useApp((s) => s.setSettings);
  // (only where the ink is in real water: the lighter ink keeps to charcoal and indigo)
  const water = effects !== "off" && fx.sky?.inkFluid !== false;
  return (
    <>
      {water && (
        <SegmentedEpoch.Provider value={scene}>
          <Row label="Ink colours" desc="The drops falling into the water: charcoal and indigo, or with drops of your accent colour among them too.">
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
      <Row label="Ink settling letters" desc="Each letter you type lands in wet, blue-black ink and dries as you write on.">
        <Switch checked={on} onChange={(v) => setSettings({ inkSettle: v })} label="Ink settling letters" />
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
      id: "ink-settle",
      label: settings.inkSettle !== false ? "Turn settling letters off" : "Turn settling letters on",
      icon: <Type size={15} strokeWidth={1.6} />,
      keywords: "ink letters typing wet dry soak settle bleed fountain pen effect",
      run: () => set({ inkSettle: settings.inkSettle === false }),
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
