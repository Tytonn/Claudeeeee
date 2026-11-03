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
import type { SceneUI } from "../types";

/** The solar eclipse card's picture: totality low over the clouds, the diamond ring just breaking out. */
const SUN = { x: 150, y: 30, r: 9.6 };
const SOLAR_RAYS: [number, number, number, number][] = (() => {
  // a fixed, pseudo-random spray of fine coronal rays (and the long streamers, a little longer)
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
  return Array.from({ length: 64 }, (_, i) => {
    const a = (i / 64) * Math.PI * 2 + rnd() * 0.09;
    const streamer = Math.abs(Math.cos(a - 0.35)) > 0.86;
    const len = (streamer ? 9 : 3.5) + rnd() * (streamer ? 13 : 7);
    return [a, len, 0.18 + rnd() * 0.32, 0.35 + rnd() * 0.45];
  });
})();
// Cloud towers on the left, lying low under the sun.
// prettier-ignore
const SOLAR_PUFFS_BACK: [number, number, number][] = [[2, 58, 12], [16, 50, 11], [30, 46, 10], [42, 52, 11], [56, 49, 12], [70, 56, 11], [86, 60, 10], [102, 63, 9], [120, 66, 9], [138, 68, 8], [156, 69, 8], [174, 66, 9], [192, 63, 10], [210, 59, 11], [226, 56, 12], [242, 58, 11]];
// prettier-ignore
const SOLAR_PUFFS_FRONT: [number, number, number][] = [[6, 75, 13], [30, 72, 12], [54, 74, 13], [80, 75, 12], [106, 77, 12], [132, 78, 11], [158, 78, 11], [184, 76, 12], [210, 74, 13], [236, 73, 13]];

function SolarArt({ golden = false, tint = "pearl", accent = "corona" }: { golden?: boolean; tint?: SolarTintId; accent?: AccentId }) {
  const { x, y, r } = SUN;
  // Golden takes on the accent's colours (the gold accent: exactly its own)
  const shift = golden ? goldenShift(ACCENTS[accent]?.color ?? ACCENTS.corona.color, ACCENTS.corona.color) : null;
  const filter = shift && (shift.angle !== 0 || shift.sat !== 1) ? `hue-rotate(${((shift.angle * 180) / Math.PI).toFixed(1)}deg) saturate(${shift.sat.toFixed(2)})` : undefined;
  // the corona in its chosen colour (Pearl is its own white light)
  const tc = !golden && tint !== "pearl" ? SOLAR_TINTS[tint]?.color : undefined;
  const dx = x + Math.cos(-2.45) * r;
  const dy = y + Math.sin(-2.45) * r;
  return (
    <svg className="scene-svg" viewBox="0 0 240 72" preserveAspectRatio="xMidYMid slice" style={filter ? { filter } : undefined} aria-hidden>
      <defs>
        <linearGradient id="so-sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={golden ? "#1d1213" : "#0b0d1c"} />
          <stop offset="0.45" stopColor={golden ? "#3b2520" : "#24161f"} />
          <stop offset="0.78" stopColor={golden ? "#5a3424" : "#5e2c1f"} />
          <stop offset="1" stopColor={golden ? "#7d4a30" : "#9a4d28"} />
        </linearGradient>
        <radialGradient id="so-corona">
          <stop offset="0.3" stopColor={golden ? "#ffcf8a" : "#fff7ec"} stopOpacity="0.95" />
          <stop offset="0.4" stopColor={golden ? "#ff9a45" : (tc ?? "#fbe8d6")} stopOpacity={golden ? 0.55 : tc ? 0.6 : 0.45} />
          <stop offset="0.65" stopColor={golden ? "#d9692c" : (tc ?? "#efd8ca")} stopOpacity={golden ? 0.16 : tc ? 0.2 : 0.12} />
          <stop offset="1" stopColor={golden ? "#d9692c" : (tc ?? "#efd8ca")} stopOpacity="0" />
        </radialGradient>
        <radialGradient id="so-glint">
          <stop offset="0" stopColor="#fff" />
          <stop offset="0.25" stopColor="#fff3e0" stopOpacity="0.7" />
          <stop offset="1" stopColor="#ffd9b0" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="so-streak" x1="0" x2="1">
          <stop offset="0" stopColor="#fff" stopOpacity="0" />
          <stop offset="0.5" stopColor="#fff" stopOpacity="0.85" />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
        <radialGradient id="so-puff" cx="0.66" cy="0.08" r="0.85">
          <stop offset="0" stopColor="#8a4a35" />
          <stop offset="0.3" stopColor="#47282a" />
          <stop offset="0.75" stopColor="#25171b" />
          <stop offset="1" stopColor="#1d1317" />
        </radialGradient>
        <filter id="so-soft" filterUnits="userSpaceOnUse" x="0" y="-20" width="240" height="112">
          <feGaussianBlur stdDeviation="0.55" />
        </filter>
        <filter id="so-fluff" filterUnits="userSpaceOnUse" x="-10" y="20" width="260" height="70">
          <feGaussianBlur stdDeviation="1.7" />
        </filter>
      </defs>
      <rect width="240" height="72" fill="url(#so-sky)" />
      <circle cx={x} cy={y} r={r * 3.4} fill="url(#so-corona)" />
      <g stroke={golden ? "#ffc27a" : (tc ?? "#fff4e8")} strokeOpacity={golden ? 0.35 : 1} strokeLinecap="round" filter="url(#so-soft)">
        {SOLAR_RAYS.map(([a, len, o, w], i) => (
          <line key={i} x1={x + Math.cos(a) * r} y1={y + Math.sin(a) * r} x2={x + Math.cos(a) * (r + len)} y2={y + Math.sin(a) * (r + len)} strokeOpacity={o} strokeWidth={w} />
        ))}
      </g>
      <circle cx={x} cy={y} r={r} fill={golden ? "#1c100c" : "#0a080b"} />
      <circle cx={x} cy={y} r={r + 0.3} fill="none" stroke={golden ? "#ffb35c" : "#fff"} strokeOpacity={golden ? 0.95 : 0.55} strokeWidth={golden ? 0.9 : 0.6} />
      <circle cx={dx} cy={dy} r={golden ? 10 : 7} fill="url(#so-glint)" />
      <rect x={dx - 46} y={dy - 0.3} width={92} height={0.6} fill="url(#so-streak)" />
      <circle cx={dx} cy={dy} r={1.5} fill="#fff" />
      <circle cx={x - 26} cy={y + 13} r={0.8} fill="#fff" fillOpacity="0.85" />
      <g filter="url(#so-fluff)">
        {SOLAR_PUFFS_BACK.map(([px, py, pr], i) => (
          <circle key={i} cx={px} cy={py} r={pr + 2.5} fill="url(#so-puff)" />
        ))}
        {SOLAR_PUFFS_FRONT.map(([px, py, pr], i) => (
          <circle key={i} cx={px} cy={py} r={pr} fill="#150e12" />
        ))}
      </g>
    </svg>
  );
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
  return <Slider label="Distance" value={typeof size === "number" ? size : 0.5} onChange={(solarSize) => setSettings({ solarSize })} />;
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
        desc={settings.solarLook === "golden" ? "A ring of fire and the diamond ring blazing, in a warm, smoky sky. It sets the accent to gold — pick another accent to recolour the whole thing." : "The pearly corona streaming out, in a dusky sky."}
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
