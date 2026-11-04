import { motion } from "motion/react";
import { Cloud, CloudSun, Palette, Wind } from "lucide-react";
import { useApp } from "../../store/app";
import { spring } from "../../lib/motion";
import type { SkyPaletteId } from "../../lib/types";
import { Row, Slider } from "../../components/overlays/settingsParts";
import { SKY_PALETTES, SKY_PALETTE_ORDER, skyPaletteOf } from "./palettes";
import { paletteForHour } from "./controller";
import azureCard from "./cards/azure.webp";
import pastelCard from "./cards/pastel.webp";
import goldenCard from "./cards/golden.webp";
import sunsetCard from "./cards/sunset.webp";
import twilightCard from "./cards/twilight.webp";
import type { SceneUI } from "../types";

/** Each palette's card: the sky itself, photographed in those colours. */
const CARDS: Record<SkyPaletteId, string> = { azure: azureCard, pastel: pastelCard, golden: goldenCard, sunset: sunsetCard, twilight: twilightCard };

type Colours = SkyPaletteId | "auto";

/** The colours as saved ("auto", or a palette we know). */
function coloursOf(v: unknown): Colours {
  return v === "auto" ? "auto" : skyPaletteOf(v);
}

/** The palette showing now: the one chosen, or the hour's. */
function showing(c: Colours): SkyPaletteId {
  if (c !== "auto") return c;
  const d = new Date();
  return paletteForHour(d.getHours() + d.getMinutes() / 60);
}

/** The Sky's card: the sky in the colours you've chosen. */
function SkyArt() {
  const colours = useApp((s) => coloursOf(s.settings.skyColours));
  return <img className="scene-img" src={CARDS[showing(colours)]} alt="" aria-hidden draggable={false} decoding="async" />;
}

/** The colours: each palette a little sky of its own, and Auto (whatever suits the time of day). */
function SkyColours() {
  const colours = useApp((s) => coloursOf(s.settings.skyColours));
  const setSettings = useApp((s) => s.setSettings);
  const opts: { id: Colours; name: string; sky: string; glow: string }[] = [
    { id: "auto", name: "Auto — follows the time of day", sky: "conic-gradient(from 200deg, #ffc4dc, #2f7deb, #e9b56d, #f08a5d, #3b3a8c, #ffc4dc)", glow: "#8fb6ee" },
    ...SKY_PALETTE_ORDER.map((id) => {
      const p = SKY_PALETTES[id];
      return { id, name: p.name, sky: `radial-gradient(70% 70% at 30% 72%, ${p.swatch[1]}, transparent 70%), linear-gradient(0deg, ${p.swatch[0]}, ${rgb(p.zenith)})`, glow: p.swatch[0] };
    }),
  ];
  return (
    <div className="swatches sky-swatches" role="radiogroup" aria-label="Sky colours">
      {opts.map((o) => (
        <button
          key={o.id}
          type="button"
          role="radio"
          aria-checked={colours === o.id}
          aria-label={o.name}
          title={o.name}
          className={`swatch sky-swatch ${o.id === "auto" ? "is-auto" : ""}`}
          style={{ "--sky": o.sky, "--sw": o.glow } as React.CSSProperties}
          onClick={() => setSettings({ skyColours: o.id })}
        >
          {colours === o.id && <motion.span layoutId="sky-colours-ring" className="swatch-ring" transition={spring} />}
          <span className="swatch-core" />
        </button>
      ))}
    </div>
  );
}

const rgb = (c: [number, number, number]) => `rgb(${Math.round(c[0] * 255)} ${Math.round(c[1] * 255)} ${Math.round(c[2] * 255)})`;

/** The Sky's own settings (with effects on). */
function SkySettings() {
  const effects = useApp((s) => s.settings.effects);
  const colours = useApp((s) => coloursOf(s.settings.skyColours));
  const clouds = useApp((s) => (typeof s.settings.skyClouds === "number" ? s.settings.skyClouds : 0.55));
  const wind = useApp((s) => (typeof s.settings.skyWind === "number" ? s.settings.skyWind : 0.5));
  const setSettings = useApp((s) => s.setSettings);
  if (effects === "off") return null;
  const name = colours === "auto" ? `Auto (${SKY_PALETTES[showing("auto")].name} right now)` : SKY_PALETTES[colours].name;
  return (
    <>
      <Row label="Sky colours" desc={`${name}. A clear blue day, cotton-candy pastels, golden hour, a blazing sunset, or twilight with the first stars out — or Auto, to follow the time of day.`}>
        <SkyColours />
      </Row>
      <Row label="Clouds" desc="From a few wisps to a sky heaped with cloud.">
        <Slider label="Clouds" value={clouds} mark={0.55} onChange={(skyClouds) => setSettings({ skyClouds })} />
      </Row>
      <Row label="Wind" desc="How fast the clouds sail by. Your cursor is a breath of wind too.">
        <Slider label="Wind" value={wind} mark={0.5} onChange={(skyWind) => setSettings({ skyWind })} />
      </Row>
    </>
  );
}

export const skyUI: SceneUI = {
  Art: SkyArt,
  icon: <CloudSun size={15} strokeWidth={1.6} />,
  Settings: SkySettings,
  commands: (settings, set) => {
    const now = coloursOf(settings.skyColours);
    const order: Colours[] = [...SKY_PALETTE_ORDER, "auto"];
    const next = order[(order.indexOf(now) + 1) % order.length];
    const label = (c: Colours) => (c === "auto" ? "Auto" : SKY_PALETTES[c].name);
    return [
      {
        id: "sky-next",
        label: `Sky colours: ${label(next)}`,
        icon: <Palette size={15} strokeWidth={1.6} />,
        keywords: "sky colours colors palette azure blue pastel pink golden hour sunset twilight night auto time of day",
        run: () => set({ skyColours: next }),
      },
      ...order
        .filter((c) => c !== now && c !== next)
        .map((c) => ({
          id: `sky-${c}`,
          label: `Sky colours: ${label(c)}`,
          icon: <Palette size={15} strokeWidth={1.6} />,
          keywords: `sky colours colors palette ${label(c).toLowerCase()} ${c === "auto" ? "time of day clock" : ""}`,
          hidden: true,
          run: () => set({ skyColours: c }),
        })),
      {
        id: "sky-clouds",
        label: (typeof settings.skyClouds === "number" ? settings.skyClouds : 0.55) > 0.3 ? "Clear the sky (a few wisps)" : "Bring the clouds back",
        icon: <Cloud size={15} strokeWidth={1.6} />,
        keywords: "clouds sky clear cloudy weather",
        run: () => set({ skyClouds: (typeof settings.skyClouds === "number" ? settings.skyClouds : 0.55) > 0.3 ? 0.1 : 0.55 }),
      },
      {
        id: "sky-wind",
        label: (typeof settings.skyWind === "number" ? settings.skyWind : 0.5) > 0.7 ? "Calm the wind" : "Let the wind pick up",
        icon: <Wind size={15} strokeWidth={1.6} />,
        keywords: "wind breeze gust clouds faster slower sky",
        run: () => set({ skyWind: (typeof settings.skyWind === "number" ? settings.skyWind : 0.5) > 0.7 ? 0.5 : 0.85 }),
      },
    ];
  },
};
