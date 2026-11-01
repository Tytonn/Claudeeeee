/**
 * Tiny synthesized UI sounds (Web Audio, no assets). Soft, glassy, short.
 */
export type SoundName = "tick" | "untick" | "pop" | "drop" | "chime" | "done" | "dawn" | "eclipse" | "transmit";

let ctx: AudioContext | null = null;
let out: GainNode | null = null;
let enabled = true;

export function setSoundEnabled(value: boolean) {
  enabled = value;
}

function audio(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!ctx) {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    out = ctx.createGain();
    out.gain.value = 0.9;
    const soften = ctx.createBiquadFilter();
    soften.type = "lowpass";
    soften.frequency.value = 8500;
    out.connect(soften).connect(ctx.destination);
  }
  if (ctx.state === "suspended") void ctx.resume();
  return ctx;
}

type ToneOpts = { at?: number; dur?: number; gain?: number; type?: OscillatorType; glide?: number; attack?: number };

function tone(freq: number, { at = 0, dur = 0.12, gain = 0.04, type = "sine", glide, attack = 0.004 }: ToneOpts = {}) {
  const c = ctx!;
  const t0 = c.currentTime + at;
  const osc = c.createOscillator();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (glide) osc.frequency.exponentialRampToValueAtTime(glide, t0 + dur * 0.7);
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(gain, t0 + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(g).connect(out!);
  osc.start(t0);
  osc.stop(t0 + dur + 0.03);
}

let noiseBuf: AudioBuffer | null = null;
function click({ at = 0, dur = 0.014, gain = 0.02, freq = 3800 } = {}) {
  const c = ctx!;
  if (!noiseBuf) {
    noiseBuf = c.createBuffer(1, Math.floor(c.sampleRate * 0.05), c.sampleRate);
    const data = noiseBuf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  }
  const t0 = c.currentTime + at;
  const src = c.createBufferSource();
  src.buffer = noiseBuf;
  const bp = c.createBiquadFilter();
  bp.type = "bandpass";
  bp.frequency.value = freq;
  bp.Q.value = 1.2;
  const g = c.createGain();
  g.gain.setValueAtTime(gain, t0);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  src.connect(bp).connect(g).connect(out!);
  src.start(t0);
  src.stop(t0 + dur + 0.01);
}

/** Filtered noise whose band sweeps between two frequencies — air, wind, light. */
function swell({ at = 0, dur = 0.6, from = 400, to = 3000, gain = 0.03, q = 0.9, type = "bandpass" as BiquadFilterType } = {}) {
  const c = ctx!;
  if (!noiseBuf || noiseBuf.duration < 2) {
    noiseBuf = c.createBuffer(1, Math.floor(c.sampleRate * 2), c.sampleRate);
    const data = noiseBuf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  }
  const t0 = c.currentTime + at;
  const src = c.createBufferSource();
  src.buffer = noiseBuf;
  const f = c.createBiquadFilter();
  f.type = type;
  f.Q.value = q;
  f.frequency.setValueAtTime(from, t0);
  f.frequency.exponentialRampToValueAtTime(to, t0 + dur);
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(gain, t0 + dur * 0.45);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  src.connect(f).connect(g).connect(out!);
  src.start(t0);
  src.stop(t0 + dur + 0.05);
}

export function play(name: SoundName) {
  if (!enabled) return;
  const c = audio();
  if (!c) return;
  try {
    switch (name) {
      case "tick":
        click({ gain: 0.03 });
        tone(1318.5, { dur: 0.1, gain: 0.032 });
        tone(1975.5, { at: 0.055, dur: 0.26, gain: 0.026 });
        break;
      case "untick":
        click({ gain: 0.018, freq: 2600 });
        tone(880, { dur: 0.09, gain: 0.022 });
        break;
      case "pop":
        click({ gain: 0.012, freq: 2000 });
        tone(480, { dur: 0.1, gain: 0.04, glide: 920 });
        break;
      case "drop":
        tone(420, { dur: 0.14, gain: 0.03, glide: 190 });
        click({ gain: 0.012, freq: 900, dur: 0.04 });
        break;
      case "chime":
        tone(1318.5, { dur: 0.42, gain: 0.02 });
        tone(1661.2, { at: 0.06, dur: 0.42, gain: 0.018 });
        tone(1975.5, { at: 0.12, dur: 0.6, gain: 0.018 });
        break;
      case "done":
        [1046.5, 1318.5, 1568, 2093].forEach((f, i) => tone(f, { at: i * 0.07, dur: 0.5, gain: 0.02 }));
        break;
      case "dawn":
        swell({ dur: 1.1, from: 300, to: 5200, gain: 0.035 });
        [659.3, 987.8, 1318.5, 1661.2, 1975.5].forEach((f, i) => tone(f, { at: 0.08 + i * 0.05, dur: 1.2, gain: 0.014, attack: 0.05 }));
        tone(3951, { at: 0.1, dur: 0.5, gain: 0.006 });
        break;
      case "eclipse":
        swell({ dur: 1.1, from: 2400, to: 160, gain: 0.04, type: "lowpass", q: 0.5 });
        tone(196, { dur: 1.1, gain: 0.035, glide: 82, attack: 0.08 });
        tone(293.7, { at: 0.05, dur: 0.9, gain: 0.012, glide: 110, attack: 0.1 });
        break;
      case "transmit":
        swell({ dur: 0.8, from: 600, to: 6000, gain: 0.025 });
        [1318.5, 1760, 2349.3].forEach((f, i) => tone(f, { at: i * 0.07, dur: 0.22, gain: 0.02 }));
        break;
    }
  } catch {
    /* audio is best-effort */
  }
}

export function haptic(ms = 8) {
  try {
    navigator.vibrate?.(ms);
  } catch {
    /* noop */
  }
}
