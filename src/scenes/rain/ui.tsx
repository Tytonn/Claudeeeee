import { Building2, CloudLightning, CloudRain } from "lucide-react";
import { useApp } from "../../store/app";
import type { RainAmountId } from "../../lib/types";
import { Row, Slider } from "../../components/overlays/settingsParts";
import { Switch } from "../../components/ui/Switch";
import { Segmented } from "../../components/ui/Segmented";
import type { SceneUI } from "../types";

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
