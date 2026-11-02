import { audioContext } from "./sound";

/**
 * The sound of rain on a window at night, made entirely from noise — no recordings:
 *  - the wash of rain falling all over the city (pink noise, softened)
 *  - a low rumble under it (brown noise)
 *  - the patter on the glass and the sill: thousands of tiny impacts, baked into a loop
 *  - now and then a single fat drop, close by, left or right
 *  - and thunder, rolling in a few seconds after the lightning you see
 * Quiet, off by default, and it fades out whenever the tab is hidden.
 */

type Opts = { on: boolean; amount: number; volume: number };
type Buffers = { pink: AudioBuffer; brown: AudioBuffer; patter: AudioBuffer; white: AudioBuffer };
type Graph = {
  ctx: AudioContext;
  master: GainNode;
  bed: GainNode;
  thunderBus: GainNode;
  nodes: AudioScheduledSourceNode[];
  timer: number;
  nextDrip: number;
};

let opts: Opts = { on: false, amount: 0.5, volume: 0.6 };
let buffers: Buffers | null = null;
let graph: Graph | null = null;
let killTimer = 0;
let listening = false;
let deferred = false;

/** Loops cleanly: the last moments fade into the first, so there's no click at the seam. */
function seam(d: Float32Array, n: number) {
  const len = d.length;
  for (let i = 0; i < n; i++) {
    const k = i / n;
    d[len - n + i] = d[len - n + i] * (1 - k) + d[i] * k;
  }
}

function makeBuffers(ctx: AudioContext): Buffers {
  const sr = ctx.sampleRate;
  const make = (seconds: number, fill: (d: Float32Array) => void) => {
    const buf = ctx.createBuffer(2, Math.floor(sr * seconds), sr);
    for (let ch = 0; ch < 2; ch++) fill(buf.getChannelData(ch));
    return buf;
  };
  const pink = make(9.7, (d) => {
    let b0 = 0,
      b1 = 0,
      b2 = 0,
      b3 = 0,
      b4 = 0,
      b5 = 0,
      b6 = 0;
    for (let i = 0; i < d.length; i++) {
      const w = Math.random() * 2 - 1;
      b0 = 0.99886 * b0 + w * 0.0555179;
      b1 = 0.99332 * b1 + w * 0.0750759;
      b2 = 0.969 * b2 + w * 0.153852;
      b3 = 0.8665 * b3 + w * 0.3104856;
      b4 = 0.55 * b4 + w * 0.5329522;
      b5 = -0.7616 * b5 - w * 0.016898;
      d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
      b6 = w * 0.115926;
    }
    seam(d, Math.floor(sr * 0.12));
  });
  const brown = make(11.3, (d) => {
    let last = 0;
    for (let i = 0; i < d.length; i++) {
      last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02;
      d[i] = last * 3.4;
    }
    seam(d, Math.floor(sr * 0.2));
  });
  const patter = make(7.9, (d) => {
    // Thousands of tiny impacts a second: mostly whispers, a few clear taps.
    const n = Math.floor(7.9 * 700);
    for (let k = 0; k < n; k++) {
      const at = Math.floor(Math.random() * d.length);
      const amp = Math.pow(Math.random(), 3.2) * 0.85 + 0.015;
      const decay = sr * (0.0005 + Math.random() * 0.0022);
      const L = Math.min(d.length - at, Math.floor(decay * 6));
      for (let i = 0; i < L; i++) d[at + i] += (Math.random() * 2 - 1) * amp * Math.exp(-i / decay);
    }
  });
  const white = make(1.5, (d) => {
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  });
  return { pink, brown, patter, white };
}

const levelFor = () => (document.hidden ? 0 : Math.max(0, Math.min(1, opts.volume)) * 0.5);
/** A drizzle is about half as loud as a downpour. */
const bedLevel = () => 0.55 + opts.amount * 0.95;

function loop(ctx: AudioContext, buf: AudioBuffer, ...chain: AudioNode[]) {
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.loop = true;
  let node: AudioNode = src;
  for (const n of chain) node = node.connect(n);
  src.start(0, Math.random() * buf.duration);
  return src;
}

function filter(ctx: AudioContext, type: BiquadFilterType, freq: number, q = 0.7, gain = 0) {
  const f = ctx.createBiquadFilter();
  f.type = type;
  f.frequency.value = freq;
  f.Q.value = q;
  f.gain.value = gain;
  return f;
}

function gainNode(ctx: AudioContext, v: number) {
  const g = ctx.createGain();
  g.gain.value = v;
  return g;
}

/** One fat drop landing close by: a little ring, or a tap on the sill. */
function drip(g: Graph, at: number) {
  const { ctx } = g;
  const pan = ctx.createStereoPanner();
  pan.pan.value = Math.random() * 1.6 - 0.8;
  pan.connect(g.bed);
  const loud = 0.006 + Math.pow(Math.random(), 2) * 0.03;
  if (Math.random() < 0.55) {
    const f0 = 500 + Math.random() * 1100;
    const osc = ctx.createOscillator();
    osc.frequency.setValueAtTime(f0, at);
    osc.frequency.exponentialRampToValueAtTime(f0 * (1.6 + Math.random() * 0.8), at + 0.045);
    const e = ctx.createGain();
    e.gain.setValueAtTime(0.0001, at);
    e.gain.exponentialRampToValueAtTime(loud, at + 0.003);
    e.gain.exponentialRampToValueAtTime(0.0001, at + 0.09 + Math.random() * 0.06);
    osc.connect(e).connect(pan);
    osc.start(at);
    osc.stop(at + 0.2);
  } else {
    const src = ctx.createBufferSource();
    src.buffer = buffers!.white;
    const bp = filter(ctx, "bandpass", 1800 + Math.random() * 3500, 2 + Math.random() * 4);
    const e = ctx.createGain();
    e.gain.setValueAtTime(loud * 2.2, at);
    e.gain.exponentialRampToValueAtTime(0.0001, at + 0.02 + Math.random() * 0.03);
    src.connect(bp).connect(e).connect(pan);
    src.start(at, Math.random() * 1.2);
    src.stop(at + 0.08);
  }
}

function scheduleDrips() {
  const g = graph;
  if (!g || g.ctx.state !== "running" || document.hidden) return;
  const now = g.ctx.currentTime;
  if (g.nextDrip < now) g.nextDrip = now + 0.05;
  const rate = 0.8 + opts.amount * 3.2;
  while (g.nextDrip < now + 0.35) {
    drip(g, g.nextDrip);
    g.nextDrip += -Math.log(1 - Math.random()) / rate;
  }
}

function build(ctx: AudioContext): Graph {
  buffers ??= makeBuffers(ctx);
  const master = gainNode(ctx, 0);
  master.connect(ctx.destination);
  const bed = gainNode(ctx, bedLevel());
  bed.connect(master);
  const thunderBus = gainNode(ctx, 1);
  thunderBus.connect(master);

  const bodyLevel = gainNode(ctx, 0.5);
  const patLevel = gainNode(ctx, 0.3);
  const nodes: AudioScheduledSourceNode[] = [
    loop(ctx, buffers.pink, filter(ctx, "highpass", 280), filter(ctx, "lowpass", 5200, 0.5), bodyLevel, bed),
    loop(ctx, buffers.patter, filter(ctx, "bandpass", 2600, 0.55), filter(ctx, "highshelf", 7000, 0.7, -8), patLevel, bed),
    loop(ctx, buffers.brown, filter(ctx, "lowpass", 360, 0.5), gainNode(ctx, 0.42), bed),
  ];
  // Gusts: the rain swells and eases, slowly, never quite in step.
  for (const [hz, depth, target] of [
    [0.055, 0.14, bodyLevel],
    [0.021, 0.1, patLevel],
    [0.083, 0.06, bodyLevel],
  ] as const) {
    const lfo = ctx.createOscillator();
    lfo.frequency.value = hz;
    lfo.connect(gainNode(ctx, depth)).connect(target.gain);
    lfo.start();
    nodes.push(lfo);
  }
  const g: Graph = { ctx, master, bed, thunderBus, nodes, timer: 0, nextDrip: 0 };
  g.timer = window.setInterval(scheduleDrips, 200);
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
    g.master.gain.setTargetAtTime(opts.on ? levelFor() : 0, g.ctx.currentTime, document.hidden ? 0.15 : 0.7);
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
      graph.master.gain.setTargetAtTime(0, graph.ctx.currentTime, 0.25);
      window.clearTimeout(killTimer);
      killTimer = window.setTimeout(teardown, 1600);
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
  if (!graph) {
    try {
      graph = build(ctx);
    } catch {
      return;
    }
  }
  const t = ctx.currentTime;
  graph.bed.gain.setTargetAtTime(bedLevel(), t, 0.8);
  graph.master.gain.cancelScheduledValues(t);
  graph.master.gain.setTargetAtTime(levelFor(), t, 0.9);
}

/** Thunder, arriving `delay` seconds from now. Nearer strikes crack before they roll. */
export function thunder({ delay, power }: { delay: number; power: number }) {
  const g = graph;
  if (!g || !opts.on || !buffers || document.hidden || g.ctx.state !== "running") return;
  const { ctx } = g;
  const at = ctx.currentTime + delay;
  const near = power >= 0.95;
  const dur = 3.2 + power * 3 + Math.random() * 1.5;
  const peak = 0.3 + power * 0.9;

  const src = ctx.createBufferSource();
  src.buffer = buffers.brown;
  src.loop = true;
  const lp = filter(ctx, "lowpass", near ? 1300 : 420, 0.5);
  lp.frequency.setValueAtTime(near ? 1300 : 420, at);
  lp.frequency.exponentialRampToValueAtTime(85, at + dur);
  const body = ctx.createGain();
  body.gain.setValueAtTime(0.0001, at);
  body.gain.exponentialRampToValueAtTime(peak * (near ? 1 : 0.55), at + (near ? 0.05 : 0.6));
  // It rolls: a few swells as it echoes back off clouds and buildings.
  let tt = at + (near ? 0.25 : 0.75);
  for (let i = 0; i < 4; i++) {
    body.gain.setTargetAtTime(peak * (0.35 + Math.random() * 0.6) * (1 - i * 0.16), tt, 0.16);
    tt += 0.35 + Math.random() * 0.7;
  }
  body.gain.setTargetAtTime(0.0001, tt, dur * 0.2);
  src.connect(lp).connect(body).connect(g.thunderBus);
  src.start(at, Math.random() * 8);
  src.stop(tt + dur);
  // …and enough of it in the low mids that small speakers carry it too.
  const mid = filter(ctx, "bandpass", near ? 320 : 220, 0.9);
  const midLevel = gainNode(ctx, near ? 2.2 : 1.6);
  lp.connect(mid).connect(midLevel).connect(body);

  if (near) {
    const crack = ctx.createBufferSource();
    crack.buffer = buffers.white;
    const hp = filter(ctx, "highpass", 1100, 0.6);
    const e = ctx.createGain();
    e.gain.setValueAtTime(0.0001, at - 0.02);
    e.gain.exponentialRampToValueAtTime(0.16 * power, at);
    e.gain.exponentialRampToValueAtTime(0.0001, at + 0.45);
    crack.connect(hp).connect(e).connect(g.thunderBus);
    crack.start(at - 0.02, Math.random() * 0.8);
    crack.stop(at + 0.5);
  }
}
