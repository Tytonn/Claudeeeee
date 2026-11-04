import { Building2, CloudLightning, CloudRain } from "lucide-react";
import { useApp } from "../../store/app";
import type { RainAmountId } from "../../lib/types";
import { Row, Slider } from "../../components/overlays/settingsParts";
import { Switch } from "../../components/ui/Switch";
import { Segmented } from "../../components/ui/Segmented";
import rainCard from "./card.webp";
import type { SceneUI } from "../types";

/** The rain card's picture: the scene itself — the city's lights out of focus through the wet glass. */
function RainArt() {
  return <img className="scene-img" src={rainCard} alt="" aria-hidden draggable={false} decoding="async" />;
}

/** How out of focus the city behind the rain is. The drops on the glass always stay sharp. */
function RainBlur() {
  const blur = useApp((s) => s.settings.cityBlur);
  const setSettings = useApp((s) => s.setSettings);
  return <Slider label="Blur" value={typeof blur === "number" ? blur : 1} onChange={(cityBlur) => setSettings({ cityBlur })} />;
}

/** The rain's own settings (with effects on). */
function RainSettings() {
  const settings = useApp((s) => s.settings);
  const setSettings = useApp((s) => s.setSettings);
  if (settings.effects === "off") return null;
  return (
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
    </>
  );
}

export const rainUI: SceneUI = {
  Art: RainArt,
  icon: <CloudRain size={15} strokeWidth={1.6} />,
  Settings: RainSettings,
  commands: (settings, set) => [
    {
      id: "lightning",
      label: settings.lightning ? "Turn lightning off" : "Turn lightning on",
      icon: <CloudLightning size={15} strokeWidth={1.6} />,
      keywords: "storm thunder flash rain",
      run: () => set({ lightning: !settings.lightning }),
    },
    {
      id: "city",
      label: settings.cityLights ? "Turn the city lights off" : "Turn the city lights on",
      icon: <Building2 size={15} strokeWidth={1.6} />,
      keywords: "bokeh city lights rain blur",
      run: () => set({ cityLights: !settings.cityLights }),
    },
    ...(["drizzle", "rain", "downpour"] as RainAmountId[]).map((id) => ({
      id: `rain-${id}`,
      label: `Rain: ${id[0].toUpperCase()}${id.slice(1)}`,
      icon: <CloudRain size={15} strokeWidth={1.6} />,
      keywords: "rain amount heavy light storm",
      hidden: true,
      meta: settings.rainAmount === id ? "current" : undefined,
      run: () => set({ rainAmount: id }),
    })),
  ],
};
