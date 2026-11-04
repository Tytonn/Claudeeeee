import { motion } from "motion/react";
import { Cloudy, Eclipse } from "lucide-react";
import { useApp } from "../../store/app";
import { ACCENTS, SOLAR_TINTS } from "../../lib/theme";
import type { AccentId, SolarTintId } from "../../lib/types";
import { spring } from "../../lib/motion";
import { goldenShift } from "../../fx/color";
import { changeSolarLook } from "../../fx/transitions";
import { Row, Slider } from "../../components/overlays/settingsParts";
import { Switch } from "../../components/ui/Switch";
import { Segmented, SegmentedEpoch } from "../../components/ui/Segmented";
import goldenCard from "./cards/golden.webp";
import pearlCard from "./cards/pearl.webp";
import goldCard from "./cards/gold.webp";
import emberCard from "./cards/ember.webp";
import roseCard from "./cards/rose.webp";
import violetCard from "./cards/violet.webp";
import iceCard from "./cards/ice.webp";
import mintCard from "./cards/mint.webp";
import type { SceneUI } from "../types";

/**
 * The solar eclipse card's picture: the eclipse itself, low over the clouds — photographed from
 * the scene, in each corona colour and in the Golden look. Golden takes on the accent's colours
 * (the gold accent: exactly its own), as the scene does.
 */
const CORONA_CARDS: Record<SolarTintId, string> = { pearl: pearlCard, gold: goldCard, ember: emberCard, rose: roseCard, violet: violetCard, ice: iceCard, mint: mintCard };

function SolarArt({ golden = false, tint = "pearl", accent = "corona" }: { golden?: boolean; tint?: SolarTintId; accent?: AccentId }) {
  const shift = golden ? goldenShift(ACCENTS[accent]?.color ?? ACCENTS.corona.color, ACCENTS.corona.color) : null;
  const filter = shift && (shift.angle !== 0 || shift.sat !== 1) ? `hue-rotate(${((shift.angle * 180) / Math.PI).toFixed(1)}deg) saturate(${shift.sat.toFixed(2)})` : undefined;
  const src = golden ? goldenCard : (CORONA_CARDS[tint] ?? CORONA_CARDS.pearl);
  return <img className="scene-img" src={src} style={filter ? { filter } : undefined} alt="" aria-hidden draggable={false} decoding="async" />;
}

/** The card, as the eclipse looks right now: its look, its corona's colour, the accent. */
function SolarCard() {
  const golden = useApp((s) => s.settings.solarLook === "golden");
  const tint = useApp((s) => s.settings.solarTint ?? "pearl");
  const accent = useApp((s) => s.settings.accent);
  return <SolarArt golden={golden} tint={tint} accent={accent} />;
}

/** How close the solar eclipse looks: further off (smaller) to closer (bigger). */
function SunDistance() {
  const size = useApp((s) => s.settings.solarSize);
  const setSettings = useApp((s) => s.setSettings);
  return <Slider label="Distance" value={typeof size === "number" ? size : 0.5} mark={0.5} onChange={(solarSize) => setSettings({ solarSize })} />;
}


/** The corona's colour, in the Corona look. Pearl is the real thing. */
function CoronaTints() {
  const tint = useApp((s) => s.settings.solarTint ?? "pearl");
  const setSettings = useApp((s) => s.setSettings);
  return (
    <div className="swatches" role="radiogroup" aria-label="Corona color">
      {(Object.keys(SOLAR_TINTS) as SolarTintId[]).map((id) => (
        <button
          key={id}
          type="button"
          role="radio"
          aria-checked={tint === id}
          aria-label={SOLAR_TINTS[id].name}
          title={SOLAR_TINTS[id].name}
          className="swatch"
          style={{ "--sw": SOLAR_TINTS[id].color } as React.CSSProperties}
          onClick={() => setSettings({ solarTint: id })}
        >
          {tint === id && <motion.span layoutId="corona-tint-ring" className="swatch-ring" transition={spring} />}
          <span className="swatch-core" />
        </button>
      ))}
    </div>
  );
}

/** The solar eclipse's own settings (with effects on). */
function SolarSettings() {
  const settings = useApp((s) => s.settings);
  const setSettings = useApp((s) => s.setSettings);
  if (settings.effects === "off") return null;
  return (
    <>
      <Row
        label="Look"
        desc={settings.solarLook === "golden" ? "A ring of fire and the diamond ring blazing, in a warm, smoky sky — in gold, or in whatever accent you pick: the whole thing takes it on." : "The pearly corona streaming out, in a dusky sky."}
      >
        <SegmentedEpoch.Provider value={settings.scene}>
          <Segmented<"corona" | "golden">
            label="Look"
            size="sm"
            value={settings.solarLook === "golden" ? "golden" : "corona"}
            options={[
              { value: "corona", label: "Corona" },
              { value: "golden", label: "Golden" },
            ]}
            onChange={changeSolarLook}
          />
        </SegmentedEpoch.Provider>
      </Row>
      {settings.solarLook !== "golden" && (
        <Row label="Corona color" desc="The colour of the light streaming out round the moon. Pearl is how it really looks.">
          <CoronaTints />
        </Row>
      )}
      <Row label="Distance" desc="How close the eclipse looks. Slide right to bring it nearer.">
        <SunDistance />
      </Row>
      <Row label="Clouds" desc="A bank of cloud drifting by below the sun — and now and then a thin veil across it.">
        <Switch checked={settings.solarClouds !== false} onChange={(v) => setSettings({ solarClouds: v })} label="Clouds" />
      </Row>
    </>
  );
}

export const solarUI: SceneUI = {
  Art: SolarCard,
  icon: <Eclipse size={15} strokeWidth={1.6} />,
  Settings: SolarSettings,
  commands: (settings, set) => [
    {
      id: "solar-look",
      label: settings.solarLook === "golden" ? "Eclipse look: Corona" : "Eclipse look: Golden",
      icon: <Eclipse size={15} strokeWidth={1.6} />,
      keywords: "eclipse look golden gold orange ring of fire diamond corona silver style sun",
      run: () => changeSolarLook(settings.solarLook === "golden" ? "corona" : "golden"),
    },
    {
      id: "clouds",
      label: settings.solarClouds !== false ? "Clear the clouds away" : "Bring the clouds back",
      icon: <Cloudy size={15} strokeWidth={1.6} />,
      keywords: "clouds sky eclipse sun weather",
      run: () => set({ solarClouds: settings.solarClouds === false }),
    },
  ],
};
