import { Droplet, Type } from "lucide-react";
import { useApp } from "../../store/app";
import { Row } from "../../components/overlays/settingsParts";
import { Switch } from "../../components/ui/Switch";
import type { SceneUI } from "../types";

/**
 * Ink: warm paper, a cloud of ink rising from the bottom with a tendril curling away from it,
 * a bluer one at the side, a wisp across the water — and the single drop, falling.
 * (The card shows the middle of this: the cloud and the drop sit there.)
 */
function InkArt() {
  return (
    <svg className="scene-svg" viewBox="0 0 240 72" preserveAspectRatio="xMidYMid slice" aria-hidden>
      <defs>
        <linearGradient id="ink-paper" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#f8f5ef" />
          <stop offset="1" stopColor="#ece6da" />
        </linearGradient>
        <radialGradient id="ink-vignette" cx="50%" cy="40%" r="80%">
          <stop offset="0.55" stopColor="#000" stopOpacity="0" />
          <stop offset="1" stopColor="#4a3e2e" stopOpacity="0.18" />
        </radialGradient>
        <radialGradient id="ink-cloud" cx="50%" cy="60%" r="50%">
          <stop offset="0" stopColor="#1b1b22" stopOpacity="0.95" />
          <stop offset="0.55" stopColor="#24242e" stopOpacity="0.7" />
          <stop offset="1" stopColor="#2a2a36" stopOpacity="0" />
        </radialGradient>
        <radialGradient id="ink-indigo" cx="50%" cy="55%" r="50%">
          <stop offset="0" stopColor="#262b52" stopOpacity="0.85" />
          <stop offset="0.6" stopColor="#2e3460" stopOpacity="0.45" />
          <stop offset="1" stopColor="#343a66" stopOpacity="0" />
        </radialGradient>
        <radialGradient id="ink-bead" cx="38%" cy="34%" r="70%">
          <stop offset="0" stopColor="#5a5c70" />
          <stop offset="0.35" stopColor="#141419" />
          <stop offset="1" stopColor="#0b0b10" />
        </radialGradient>
        <filter id="ink-bleed" x="-40%" y="-40%" width="180%" height="180%">
          <feTurbulence type="fractalNoise" baseFrequency="0.07" numOctaves="3" seed="7" result="n" />
          <feDisplacementMap in="SourceGraphic" in2="n" scale="14" xChannelSelector="R" yChannelSelector="G" result="d" />
          <feGaussianBlur in="d" stdDeviation="0.9" />
        </filter>
        <filter id="ink-wisp" x="-40%" y="-40%" width="180%" height="180%">
          <feTurbulence type="fractalNoise" baseFrequency="0.08" numOctaves="2" seed="3" result="n" />
          <feDisplacementMap in="SourceGraphic" in2="n" scale="5" xChannelSelector="R" yChannelSelector="G" result="d" />
          <feGaussianBlur in="d" stdDeviation="1.1" />
        </filter>
        <filter id="ink-haze" x="-40%" y="-40%" width="180%" height="180%">
          <feGaussianBlur stdDeviation="3.2" />
        </filter>
      </defs>
      <rect width="240" height="72" fill="url(#ink-paper)" />
      {/* the haze the clouds give off into the water */}
      <g filter="url(#ink-haze)" opacity="0.32">
        <ellipse cx="96" cy="70" rx="40" ry="16" fill="#2a2a34" />
        <ellipse cx="168" cy="72" rx="26" ry="11" fill="#2c3258" />
      </g>
      {/* the big cloud, rising from the bottom */}
      <g filter="url(#ink-bleed)">
        <ellipse cx="94" cy="72" rx="34" ry="15" fill="url(#ink-cloud)" />
        <ellipse cx="80" cy="62" rx="15" ry="10" fill="url(#ink-cloud)" opacity="0.85" />
        <ellipse cx="106" cy="60" rx="12" ry="9" fill="url(#ink-cloud)" opacity="0.75" />
        <ellipse cx="66" cy="70" rx="13" ry="8" fill="url(#ink-cloud)" opacity="0.7" />
        <ellipse cx="162" cy="72" rx="20" ry="11" fill="url(#ink-indigo)" />
        <ellipse cx="174" cy="63" rx="9" ry="7" fill="url(#ink-indigo)" opacity="0.8" />
      </g>
      {/* tendrils: one rising and curling away from the cloud (soft and wide where it leaves it,
          finer as it goes), and a bluer one at the side */}
      <g filter="url(#ink-wisp)" fill="none" strokeLinecap="round">
        <path d="M98 58 C 106 46, 98 38, 108 31" stroke="#25252e" strokeWidth="4.2" opacity="0.32" />
        <path d="M100 54 C 108 42, 98 34, 110 28 C 120 23, 128 30, 122 36 C 117 40, 112 35, 116 32" stroke="#23232c" strokeWidth="1.8" opacity="0.5" />
        <path d="M84 58 C 79 49, 86 43, 81 36" stroke="#2b2b35" strokeWidth="2.2" opacity="0.26" />
        <path d="M170 60 C 178 51, 168 45, 176 39 C 182 35, 186 41, 181 43" stroke="#2c3258" strokeWidth="2" opacity="0.36" />
      </g>
      <rect width="240" height="72" fill="url(#ink-vignette)" />
      {/* the drop, falling, catching the light */}
      <ellipse cx="136" cy="17" rx="2.6" ry="3.3" fill="url(#ink-bead)" />
      <circle cx="135.1" cy="15.9" r="0.75" fill="#fff" opacity="0.9" />
    </svg>
  );
}

/** Ink's own settings (letters settle with effects off too: it's how typing feels, not the scene). */
function InkSettings() {
  const on = useApp((s) => s.settings.inkSettle !== false);
  const setSettings = useApp((s) => s.setSettings);
  return (
    <Row label="Ink settling letters" desc="Each letter you type lands in wet, blue-black ink and dries as you write on.">
      <Switch checked={on} onChange={(v) => setSettings({ inkSettle: v })} label="Ink settling letters" />
    </Row>
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
  ],
};
