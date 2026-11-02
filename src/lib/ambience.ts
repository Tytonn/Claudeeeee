import { audioContext } from "./sound";

/**
 * Rain, close and quiet — the kind you'd fall asleep to. Made from scratch (no recordings),
 * at the device's own sample rate and with the whole top end intact:
 *  - the hush: thousands of tiny impacts a second, the airy sound of rain everywhere
 *  - patter: lighter taps on the glass and the sill, a few with a little glassy ring
 *  - now and then a single drop close by — a tick, a soft tap, or a plip into a puddle —
 *    somewhere between your left ear and your right
 *  - and thunder, low and far off, rolling in a few seconds after the lightning you see
 * Real rain is a sum of drops, so that's how this is built: every layer is individual
 * impacts, never a filtered hiss. Each ear gets its own stream, so it's wide and soft.
 * Off by default; it fades out whenever the tab is hidden.
 */

type Opts = { on: boolean; amount: number; volume: number };
type Bank = { hiss: AudioBuffer; patter: AudioBuffer; drops: AudioBuffer[] };
type Graph = {
  ctx: AudioContext;
  master: GainNode;
  hiss: GainNode;
  patter: GainNode;
  drops: GainNode;
  thunder: GainNode;
  nodes: AudioScheduledSourceNode[];
  timer: number;
  nextDrop: number;
};

/** Overall loudness. Calibrated so the default volume sits around −43 dBFS: quiet, under everything. */
const MASTER = 0.22;

let opts: Opts = { on: false, amount: 0.5, volume: 0.6 };
let bank: Bank | null = null;
let making: Promise<Bank> | null = null;
let graph: Graph | null = null;
let killTimer = 0;
let listening = false;
let deferred = false;

const rand = Math.random;
/** Roughly normal: mean 0, deviation 1. */
const gauss = () => (rand() + rand() + rand() + rand() + rand() + rand() - 3) * 1.414;
const breathe = () => new Promise<void>((r) => window.setTimeout(r, 0));

/* ── making the sounds ──────────────────────────────────────────────────── */

/** One tiny impact: a few milliseconds of noise dying away. `tone` 0 is dull, 1 is bright. */
function impact(d: Float32Array, at: number, amp: number, decay: number, tone: number) {
  const n = Math.min(d.length - at, Math.ceil(decay * 5));
  const k = Math.exp(-1 / decay);
  let e = amp;
  let prev = 0;
  for (let i = 0; i < n; i++) {
    const w = rand() * 2 - 1;
    d[at + i] += (w - prev * tone) * e;
    prev = w;
    e *= k;
  }
}

/** A clean second-order filter, run over a whole buffer. */
function biquad(d: Float32Array, sr: number, type: "lowpass" | "highpass", freq: number, q = 0.707) {
  const w0 = (2 * Math.PI * freq) / sr;
  const cos = Math.cos(w0);
  const alpha = Math.sin(w0) / (2 * q);
  const a0 = 1 + alpha;
  const a1 = (-2 * cos) / a0;
  const a2 = (1 - alpha) / a0;
  const b0 = (type === "lowpass" ? (1 - cos) / 2 : (1 + cos) / 2) / a0;
  const b1 = (type === "lowpass" ? 1 - cos : -(1 + cos)) / a0;
  const b2 = b0;
  let x1 = 0;
  let x2 = 0;
  let y1 = 0;
  let y2 = 0;
  for (let i = 0; i < d.length; i++) {
    const x = d[i];
    const y = b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
    x2 = x1;
    x1 = x;
    y2 = y1;
    y1 = y;
    d[i] = y;
  }
}

/** Loops without a seam: the last moments fade into the first. */
function seam(d: Float32Array, n: number) {
  const len = d.length;
  for (let i = 0; i < n; i++) {
    const k = i / n;
    d[len - n + i] = d[len - n + i] * (1 - k) + d[i] * k;
  }
}

function normalizeRms(d: Float32Array, target: number) {
  let sum = 0;
  for (let i = 0; i < d.length; i++) sum += d[i] * d[i];
  const rms = Math.sqrt(sum / d.length) || 1;
  const g = target / rms;
  for (let i = 0; i < d.length; i++) d[i] *= g;
}

function normalizePeak(d: Float32Array) {
  let peak = 0;
  for (let i = 0; i < d.length; i++) peak = Math.max(peak, Math.abs(d[i]));
  const g = 1 / (peak || 1);
  for (let i = 0; i < d.length; i++) d[i] *= g;
}

type Layer = { perSecond: number; amp: number; spread: number; decayMs: [number, number]; tone: [number, number]; ping?: number };

/** A loop of rain: impacts arriving at random (Poisson), soft ones far more often than loud. */
async function rainLoop(sr: number, seconds: number, layer: Layer) {
  const d = new Float32Array(Math.floor(sr * seconds));
  const gap = sr / layer.perSecond;
  let t = 0;
  let next = sr;
  while (true) {
    t += -Math.log(1 - rand()) * gap;
    const at = Math.floor(t);
    if (at >= d.length) break;
    // soft ones far more often than loud — but never a sharp click
    const amp = layer.amp * Math.min(2.6, Math.exp(gauss() * layer.spread));
    const decay = ((layer.decayMs[0] + rand() * (layer.decayMs[1] - layer.decayMs[0])) * sr) / 1000;
    impact(d, at, amp, decay, layer.tone[0] + rand() * (layer.tone[1] - layer.tone[0]));
    // now and then a drop on the glass rings, very faintly
    if (layer.ping && rand() < layer.ping) {
      const f = 3600 + rand() * 3400;
      const tau = sr * (0.0012 + rand() * 0.0022);
      const n = Math.min(d.length - at, Math.ceil(tau * 5));
      const w = (2 * Math.PI * f) / sr;
      for (let i = 0; i < n; i++) d[at + i] += Math.sin(w * i) * Math.exp(-i / tau) * amp * 0.5;
    }
    if (at > next) {
      next += sr;
      await breathe();
    }
  }
  // Slow swells, timed to fit the loop exactly so it stays seamless.
  const len = d.length;
  const p1 = rand() * 6.28;
  const p2 = rand() * 6.28;
  for (let i = 0; i < len; i++) {
    const u = (i / len) * Math.PI * 2;
    d[i] *= 1 + 0.16 * Math.sin(u * 2 + p1) + 0.08 * Math.sin(u * 5 + p2);
  }
  return d;
}

/** One drop close by: `tick` on the glass, `tap` on the sill, `plip` into a puddle. */
function drop(sr: number, kind: "tick" | "tap" | "plip") {
  const d = new Float32Array(Math.floor(sr * 0.16));
  if (kind === "tick") {
    impact(d, 0, 1, (sr * (0.25 + rand() * 0.45)) / 1000, 0.95);
    const f = 3400 + rand() * 3600;
    const tau = sr * (0.0016 + rand() * 0.003);
    const w = (2 * Math.PI * f) / sr;
    for (let i = 0; i < d.length; i++) d[i] += Math.sin(w * i) * Math.exp(-i / tau) * 0.4;
    biquad(d, sr, "highpass", 900);
  } else if (kind === "plip") {
    // a bubble closing over: a ring whose pitch rises as it fades
    const f0 = 850 + rand() * 1500;
    const rise = 1.25 + rand() * 0.6;
    const tf = sr * (0.004 + rand() * 0.006);
    const ta = sr * (0.009 + rand() * 0.014);
    let ph = 0;
    for (let i = 0; i < d.length; i++) {
      ph += (2 * Math.PI * f0 * (1 + (rise - 1) * (1 - Math.exp(-i / tf)))) / sr;
      d[i] = Math.sin(ph) * (1 - Math.exp(-i / (sr * 0.0005))) * Math.exp(-i / ta);
    }
    impact(d, 0, 0.3, sr * 0.0005, 0.9);
  } else {
    impact(d, 0, 1, sr * (0.0014 + rand() * 0.0026), 0.15);
    biquad(d, sr, "lowpass", 1700 + rand() * 1700, 0.6);
  }
  normalizePeak(d);
  return d;
}

async function makeBank(ctx: AudioContext): Promise<Bank> {
  const sr = ctx.sampleRate;
  const mono = (d: Float32Array) => {
    const b = ctx.createBuffer(1, d.length, sr);
    b.getChannelData(0).set(d);
    return b;
  };
  const hiss = await rainLoop(sr, 13.7, { perSecond: 2600, amp: 0.02, spread: 0.5, decayMs: [0.15, 1.2], tone: [0.3, 0.75] });
  biquad(hiss, sr, "highpass", 240);
  biquad(hiss, sr, "lowpass", 12000);
  seam(hiss, Math.floor(sr * 0.25));
  normalizeRms(hiss, 0.1);
  await breathe();
  const patter = await rainLoop(sr, 11.3, { perSecond: 170, amp: 0.06, spread: 0.5, decayMs: [0.4, 2.5], tone: [0.45, 0.95], ping: 0.14 });
  biquad(patter, sr, "highpass", 420);
  biquad(patter, sr, "lowpass", 15000);
  seam(patter, Math.floor(sr * 0.25));
  normalizeRms(patter, 0.1);
  const drops: AudioBuffer[] = [];
  for (let i = 0; i < 30; i++) drops.push(mono(drop(sr, i % 3 === 0 ? "plip" : i % 3 === 1 ? "tick" : "tap")));
  return { hiss: mono(hiss), patter: mono(patter), drops };
}

/** Thunder, far off: low rolling swells (and, when it's close, a crackle first). */
function thunderBuffer(ctx: AudioContext, near: boolean) {
  const sr = ctx.sampleRate;
  const len = Math.floor(sr * (near ? 6 : 7.5));
  const buf = ctx.createBuffer(2, len, sr);
  const rolls = Array.from({ length: 3 + Math.floor(rand() * 3) }, (_, i) => ({
    at: (near ? 0.04 : 0.35) + i * (0.35 + rand() * 0.75),
    rise: near && i === 0 ? 0.05 : 0.25 + rand() * 0.5,
    fall: 0.7 + rand() * 1.6,
    amp: i === 0 ? 1 : 0.4 + rand() * 0.55,
  }));
  const a = 1 - Math.exp((-2 * Math.PI * (near ? 230 : 140)) / sr);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    let b = 0;
    let l1 = 0;
    let l2 = 0;
    for (let i = 0; i < len; i++) {
      const t = i / sr;
      b = (b + 0.02 * (rand() * 2 - 1)) / 1.02;
      l1 += a * (b - l1);
      l2 += a * (l1 - l2);
      let env = 0;
      for (const r of rolls) {
        const u = t - r.at;
        if (u > 0) env += r.amp * (u < r.rise ? (u / r.rise) * (u / r.rise) : Math.exp(-(u - r.rise) / r.fall));
      }
      d[i] = l2 * env;
    }
    if (near) {
      for (let k = 0; k < 34; k++) {
        const at = Math.floor(sr * (rand() * 0.28));
        impact(d, at, 0.05 * (1 - at / (sr * 0.3)) * (0.3 + rand()), sr * (0.0003 + rand() * 0.0012), 0.9);
      }
    }
  }
  let peak = 0;
  for (let ch = 0; ch < 2; ch++) for (const v of buf.getChannelData(ch)) peak = Math.max(peak, Math.abs(v));
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    for (let i = 0; i < len; i++) d[i] /= peak || 1;
  }
  return buf;
}

/* ── playing them ───────────────────────────────────────────────────────── */

const levelFor = () => (document.hidden ? 0 : Math.pow(Math.max(0, Math.min(1, opts.volume)), 1.6) * MASTER);
/** A drizzle is mostly patter; a downpour is mostly hush. */
const hissLevel = () => 0.3 + opts.amount * 0.95;
const patterLevel = () => 0.75 + opts.amount * 0.2;

function gainNode(ctx: AudioContext, v: number) {
  const g = ctx.createGain();
  g.gain.value = v;
  return g;
}

/** Plays a mono loop into both ears, from two different points, so it's wide and never in step. */
function stereoLoop(ctx: AudioContext, buf: AudioBuffer, out: AudioNode, nodes: AudioScheduledSourceNode[]) {
  const merger = ctx.createChannelMerger(2);
  for (let ch = 0; ch < 2; ch++) {
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    src.connect(merger, 0, ch);
    src.start(0, ch ? buf.duration * 0.5 + rand() : rand() * 2);
    nodes.push(src);
  }
  merger.connect(out);
}

function scheduleDrops() {
  const g = graph;
  if (!g || !bank || g.ctx.state !== "running" || document.hidden) return;
  const now = g.ctx.currentTime;
  if (g.nextDrop < now) g.nextDrop = now + 0.05;
  const rate = 1.3 + opts.amount * 2.4;
  while (g.nextDrop < now + 0.4) {
    const src = g.ctx.createBufferSource();
    src.buffer = bank.drops[Math.floor(rand() * bank.drops.length)];
    src.playbackRate.value = 0.88 + rand() * 0.26;
    const pan = g.ctx.createStereoPanner();
    pan.pan.value = rand() * 1.7 - 0.85;
    const v = g.ctx.createGain();
    v.gain.value = 0.04 + Math.pow(rand(), 2) * 0.22;
    src.connect(v).connect(pan).connect(g.drops);
    src.start(g.nextDrop);
    g.nextDrop += -Math.log(1 - rand()) / rate;
  }
}

function build(ctx: AudioContext, b: Bank): Graph {
  const master = gainNode(ctx, 0);
  master.connect(ctx.destination);
  // airy, never harsh
  const polish = ctx.createBiquadFilter();
  polish.type = "highshelf";
  polish.frequency.value = 8000;
  polish.gain.value = -4;
  polish.connect(master);
  const hiss = gainNode(ctx, hissLevel());
  const patter = gainNode(ctx, patterLevel());
  const drops = gainNode(ctx, 0.55);
  const thunder = gainNode(ctx, 1);
  for (const n of [hiss, patter, drops, thunder]) n.connect(polish);
  const nodes: AudioScheduledSourceNode[] = [];
  stereoLoop(ctx, b.hiss, hiss, nodes);
  stereoLoop(ctx, b.patter, patter, nodes);
  const g: Graph = { ctx, master, hiss, patter, drops, thunder, nodes, timer: 0, nextDrop: 0 };
  g.timer = window.setInterval(scheduleDrops, 220);
  return g;
}

function teardown() {
  const g = graph;
  if (!g) return;
  graph = null;
  window.clearInterval(g.timer);
  for (const n of g.nodes) {
    try {
      n.stop();
    } catch {
      /* already stopped */
    }
  }
  g.master.disconnect();
}

function listen() {
  if (listening) return;
  listening = true;
  document.addEventListener("visibilitychange", () => {
    const g = graph;
    if (!g) return;
    g.master.gain.setTargetAtTime(opts.on ? levelFor() : 0, g.ctx.currentTime, document.hidden ? 0.15 : 0.8);
  });
  // Browsers keep audio paused until you interact with the page; start the moment you do.
  const wake = () => {
    if (graph && graph.ctx.state === "suspended") void graph.ctx.resume();
  };
  for (const type of ["pointerdown", "keydown", "touchend"] as const) addEventListener(type, wake, { passive: true, capture: true });
}

export function setRainSound(next: Partial<Opts>) {
  opts = { ...opts, ...next };
  if (!opts.on) {
    if (graph) {
      graph.master.gain.setTargetAtTime(0, graph.ctx.currentTime, 0.3);
      window.clearTimeout(killTimer);
      killTimer = window.setTimeout(teardown, 1800);
    }
    return;
  }
  // Until you've interacted with the page the browser won't play anything; start then.
  const activation = (navigator as Navigator & { userActivation?: { hasBeenActive: boolean } }).userActivation;
  if (activation && !activation.hasBeenActive) {
    if (!deferred) {
      deferred = true;
      const go = () => {
        deferred = false;
        for (const type of ["pointerdown", "keydown", "touchend"] as const) removeEventListener(type, go, true);
        if (opts.on) setRainSound({});
      };
      for (const type of ["pointerdown", "keydown", "touchend"] as const) addEventListener(type, go, { capture: true, passive: true });
    }
    return;
  }
  const ctx = audioContext();
  if (!ctx) return;
  listen();
  window.clearTimeout(killTimer);
  if (!bank) {
    // The rain takes a moment to make (it's a few hundred thousand drops); it fades in when ready.
    making ??= makeBank(ctx);
    void making.then((b) => {
      bank = b;
      if (opts.on) setRainSound({});
    });
    return;
  }
  if (!graph) graph = build(ctx, bank);
  const t = ctx.currentTime;
  graph.hiss.gain.setTargetAtTime(hissLevel(), t, 0.8);
  graph.patter.gain.setTargetAtTime(patterLevel(), t, 0.8);
  graph.master.gain.cancelScheduledValues(t);
  graph.master.gain.setTargetAtTime(levelFor(), t, 1.1);
}

/** Thunder, arriving `delay` seconds from now — soft, low and far away. */
export function thunder({ delay, power }: { delay: number; power: number }) {
  const g = graph;
  if (!g || !opts.on || document.hidden || g.ctx.state !== "running") return;
  const near = power >= 0.95;
  const src = g.ctx.createBufferSource();
  src.buffer = thunderBuffer(g.ctx, near);
  const v = g.ctx.createGain();
  v.gain.value = (near ? 0.5 : 0.28) * Math.min(1, power + 0.2);
  src.connect(v).connect(g.thunder);
  src.start(g.ctx.currentTime + delay);
}
