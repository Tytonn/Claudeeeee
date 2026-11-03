/**
 * Tiny synthesized UI sounds (Web Audio, no assets). Soft, glassy, short — in the rain scene,
 * made of water: drips, bubbles, washes; in Ink, of a nib and still water: soft taps, deep
 * slow drops, the hush of paper.
 */
export type SoundName = "tick" | "untick" | "pop" | "drop" | "chime" | "done" | "dawn" | "eclipse" | "transmit" | "inkdrop";

let ctx: AudioContext | null = null;
let out: GainNode | null = null;
let enabled = true;
type SoundTheme = "eclipse" | "rain" | "ink";
let theme: SoundTheme = "eclipse";

export function setSoundEnabled(value: boolean) {
  enabled = value;
}

export function setSoundTheme(value: SoundTheme) {
  theme = value;
}

/** The shared audio context (made on first use; the browser keeps it paused until you interact). */
export function audioContext(): AudioContext | null {
  return audio();
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

/** A drop of water: a little bubble ringing, its pitch leaping up as it closes. */
function plink(f0: number, { at = 0, gain = 0.035, up = 1.9, dur = 0.12 } = {}) {
  const c = ctx!;
  const t0 = c.currentTime + at;
  const osc = c.createOscillator();
  osc.type = "sine";
  osc.frequency.setValueAtTime(f0, t0);
  osc.frequency.exponentialRampToValueAtTime(f0 * up, t0 + dur * 0.42);
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(gain, t0 + 0.003);
  g.gain.exponentialRampToValueAtTime(gain * 0.35, t0 + dur * 0.4);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(g).connect(out!);
  osc.start(t0);
  osc.stop(t0 + dur + 0.03);
}

const jitter = (f: number) => f * (0.96 + Math.random() * 0.08);

function playRain(name: SoundName) {
  switch (name) {
    case "tick":
      click({ gain: 0.012, freq: 5200, dur: 0.008 });
      plink(jitter(1050), { gain: 0.05, up: 2.1, dur: 0.11 });
      plink(jitter(1560), { at: 0.075, gain: 0.026, up: 1.8, dur: 0.1 });
      break;
    case "untick":
      plink(jitter(720), { gain: 0.034, up: 1.7, dur: 0.1 });
      break;
    case "pop":
      plink(jitter(380), { gain: 0.05, up: 2.6, dur: 0.17 });
      break;
    case "drop":
      click({ gain: 0.012, freq: 1100, dur: 0.03 });
      plink(jitter(640), { gain: 0.036, up: 0.55, dur: 0.15 });
      break;
    case "chime":
      [1318.5, 1568, 1975.5].forEach((f, i) => plink(f, { at: i * 0.07, gain: 0.03, up: 1.25, dur: 0.32 }));
      tone(2637, { at: 0.2, dur: 0.6, gain: 0.006, attack: 0.04 });
      break;
    case "done":
      [987.8, 1174.7, 1318.5, 1568, 1975.5].forEach((f, i) => plink(f, { at: i * 0.075, gain: 0.034, up: 1.5, dur: 0.16 }));
      tone(1975.5, { at: 0.38, dur: 0.9, gain: 0.01, attack: 0.05 });
      tone(2637, { at: 0.42, dur: 0.8, gain: 0.006, attack: 0.06 });
      break;
    case "dawn":
      // a roll of distant thunder, and the first drops
      swell({ dur: 1.6, from: 320, to: 90, gain: 0.07, type: "lowpass", q: 0.4 });
      plink(jitter(1180), { at: 0.12, gain: 0.03, up: 2, dur: 0.12 });
      plink(jitter(1640), { at: 0.3, gain: 0.02, up: 1.8, dur: 0.1 });
      break;
    case "eclipse":
      // washed away: water rushing down, then a last drip
      swell({ dur: 1.15, from: 3600, to: 240, gain: 0.05, q: 0.6 });
      swell({ at: 0.08, dur: 0.9, from: 900, to: 140, gain: 0.035, type: "lowpass", q: 0.4 });
      plink(jitter(860), { at: 1.02, gain: 0.03, up: 2, dur: 0.12 });
      break;
    case "transmit":
      swell({ dur: 0.7, from: 700, to: 5200, gain: 0.022 });
      [880, 1174.7, 1568, 2093].forEach((f, i) => plink(f, { at: i * 0.055, gain: 0.026, up: 1.7, dur: 0.11 }));
      break;
    case "inkdrop":
      plink(jitter(420), { gain: 0.05, up: 2.4, dur: 0.2 });
      break;
  }
}

/** A pen nib touching paper: a dry, tiny tick of fibre. */
function nib({ at = 0, gain = 0.016 } = {}) {
  click({ at, gain, freq: 2300, dur: 0.012 });
  click({ at: at + 0.004, gain: gain * 0.5, freq: 5400, dur: 0.006 });
}

function playInk(name: SoundName) {
  switch (name) {
    case "tick":
      nib();
      plink(jitter(760), { at: 0.01, gain: 0.04, up: 1.55, dur: 0.14 });
      tone(1520, { at: 0.05, dur: 0.3, gain: 0.008, attack: 0.02 });
      break;
    case "untick":
      nib({ gain: 0.011 });
      plink(jitter(520), { gain: 0.028, up: 1.35, dur: 0.12 });
      break;
    case "pop":
      plink(jitter(330), { gain: 0.045, up: 2.1, dur: 0.19 });
      break;
    case "drop":
      // a sheet lifted away: the hush of paper, and a low drip
      swell({ dur: 0.32, from: 2600, to: 900, gain: 0.016, q: 0.5 });
      plink(jitter(470), { at: 0.04, gain: 0.03, up: 0.6, dur: 0.17 });
      break;
    case "chime":
      [784, 987.8, 1174.7].forEach((f, i) => plink(f, { at: i * 0.08, gain: 0.026, up: 1.18, dur: 0.38 }));
      tone(1568, { at: 0.22, dur: 0.7, gain: 0.005, attack: 0.05 });
      break;
    case "done":
      [659.3, 784, 987.8, 1318.5].forEach((f, i) => plink(f, { at: i * 0.085, gain: 0.03, up: 1.35, dur: 0.2 }));
      tone(1318.5, { at: 0.36, dur: 1, gain: 0.008, attack: 0.06 });
      break;
    case "dawn":
      // ink let into the water: a soft bloom of sound
      swell({ dur: 1.2, from: 180, to: 1400, gain: 0.03, type: "lowpass", q: 0.4 });
      plink(jitter(300), { at: 0.05, gain: 0.04, up: 2.4, dur: 0.24 });
      [987.8, 1318.5].forEach((f, i) => tone(f, { at: 0.18 + i * 0.09, dur: 0.9, gain: 0.006, attack: 0.08 }));
      break;
    case "eclipse":
      // washed out of the paper: a slow draining hush
      swell({ dur: 1.1, from: 2200, to: 200, gain: 0.04, type: "lowpass", q: 0.5 });
      plink(jitter(380), { at: 0.9, gain: 0.026, up: 0.7, dur: 0.18 });
      break;
    case "transmit":
      swell({ dur: 0.7, from: 500, to: 3800, gain: 0.018 });
      [659.3, 880, 1174.7].forEach((f, i) => plink(f, { at: i * 0.06, gain: 0.024, up: 1.5, dur: 0.14 }));
      break;
    case "inkdrop":
      // the one drop: it meets the water (a deep, round bubble ringing up), a breath of splash,
      // and the hush of the ink opening out
      click({ gain: 0.02, freq: 1400, dur: 0.02 });
      plink(220, { gain: 0.07, up: 2.6, dur: 0.26 });
      plink(440, { at: 0.012, gain: 0.022, up: 2.2, dur: 0.2 });
      swell({ at: 0.02, dur: 0.5, from: 3200, to: 700, gain: 0.014, q: 0.6 });
      swell({ at: 0.12, dur: 1.6, from: 140, to: 900, gain: 0.03, type: "lowpass", q: 0.3 });
      plink(jitter(980), { at: 0.42, gain: 0.012, up: 1.6, dur: 0.12 });
      tone(330, { at: 0.06, dur: 1.4, gain: 0.006, attack: 0.12 });
      break;
  }
}

export function play(name: SoundName) {
  if (!enabled) return;
  const c = audio();
  if (!c) return;
  if (theme === "ink") {
    try {
      playInk(name);
    } catch {
      /* audio is best-effort */
    }
    return;
  }
  if (theme === "rain") {
    try {
      playRain(name);
    } catch {
      /* audio is best-effort */
    }
    return;
  }
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
      case "inkdrop":
        tone(300, { dur: 0.22, gain: 0.04, glide: 640 });
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
