import type { FxEngine } from "../../fx/engine";
import type { SceneController } from "../../fx/scene";
import { rand, WATER } from "../../fx/util";

/** A lightning strike: its flickers (pulses), where the bolt is, its shape, and whether it shows. */
type Strike = { t0: number; pulses: { at: number; amp: number; tau: number }[]; x: number; seed: number; bolt: boolean };
export type RainOptions = { lightning: boolean; city: boolean; amount: number; blur: number };

/**
 * The rain: the weather — how hard it rains and how wet the glass is, the city's lights, the
 * blur, lightning now and then (never while you're writing) and the room lighting up with it —
 * and every effect turned to water: drops, splashes, a bolt for a new note.
 */
export class RainScene implements SceneController {
  readonly id = "rain" as const;
  readonly floor = 0.5;
  readonly detailOnSmall = true;
  readonly drops = true;
  readonly flashK = 1;

  constructor(private fx: FxEngine) {}

  private rainOpts: RainOptions = { lightning: true, city: true, amount: 0.5, blur: 1 };
  private blurK = 1;
  private wet = 1;
  private sceneFade = 1;
  private cityK = 1;
  private amountK = 0.5;
  private strikes: Strike[] = [];
  private nextStrike = 9000;
  private roomFlash = 0;
  /** A veil of light over everything, for the instant lightning lights up the room. */
  private room: HTMLDivElement | null = null;

  setRain(o: Partial<RainOptions>) {
    this.rainOpts = { ...this.rainOpts, ...o };
    if (!this.fx.started) {
      this.cityK = this.rainOpts.city ? 1 : 0;
      this.amountK = this.rainOpts.amount;
      this.blurK = this.rainOpts.blur;
    }
    if (!this.lightningOn) this.strikes = this.strikes.filter((s) => this.fx.clock - s.t0 < 900);
  }

  /** Whether lightning may flash at all (never with reduced motion — it's a flashing light). */
  get lightningOn() {
    return this.fx.rain && this.rainOpts.lightning && !this.fx.reduced && this.fx.effective !== "off";
  }

  /** Lightning brightness this frame. */
  private flashNow = 0;

  private stepRain(now: number, dt: number, idle: boolean) {
    this.wet += (1 - this.wet) * Math.min(1, dt * 0.32);
    this.sceneFade += (1 - this.sceneFade) * Math.min(1, dt * 1.6);
    this.cityK += ((this.rainOpts.city ? 1 : 0) - this.cityK) * Math.min(1, dt * 1.4);
    this.amountK += (this.rainOpts.amount - this.amountK) * Math.min(1, dt * 0.8);
    this.blurK += (this.rainOpts.blur - this.blurK) * Math.min(1, dt * 6);

    // Now and then, lightning — but never while you're writing.
    if (this.lightningOn && !this.fx.calm && !document.hidden && now > this.nextStrike) {
      const bolt = Math.random() < 0.38;
      this.strike({ bolt, power: bolt ? rand(0.6, 0.95) : rand(0.25, 0.45) });
      this.nextStrike = now + rand(11000, 34000) * (idle ? 0.6 : 1) * (1.25 - this.amountK * 0.5);
    }

    let f = 0;
    this.strikes = this.strikes.filter((s) => {
      const t = now - s.t0;
      let v = 0;
      let alive = false;
      for (const p of s.pulses) {
        const d = t - p.at;
        if (d < 0) {
          alive = true;
          continue;
        }
        const e = d < 28 ? d / 28 : Math.exp(-(d - 28) / p.tau);
        if (e > 0.002) alive = true;
        v += p.amp * e;
      }
      f = Math.max(f, v);
      return alive;
    });
    this.flashNow = f;
    // The room lights up too, just a little.
    this.setRoomFlash(Math.min(1, f));
  }

  private setRoomFlash(v: number) {
    const q = Math.round(v * 200) / 200;
    if (q === this.roomFlash || !this.room) return;
    this.roomFlash = q;
    this.room.style.display = q > 0 ? "" : "none";
    this.room.style.opacity = (q * 0.075).toFixed(4);
  }

  /**
   * A lightning strike. Distant ones are a flicker in the clouds; nearer ones show the bolt
   * itself. Flickers are kept slow and few (never more than three in a second).
   */
  strike(o: { bolt?: boolean; power?: number; x?: number } = {}) {
    if (!this.lightningOn) return false;
    const power = o.power ?? 0.8;
    const bolt = o.bolt ?? true;
    const aspect = this.fx.W / Math.max(1, this.fx.H);
    const x = o.x !== undefined ? o.x / Math.max(1, this.fx.H) : rand(0.12, 0.88) * aspect;
    const pulses = [{ at: 0, amp: power * rand(0.45, 0.7), tau: 90 }];
    pulses.push({ at: rand(170, 260), amp: power, tau: bolt ? 150 : 210 });
    if (Math.random() < 0.6) pulses.push({ at: rand(520, 700), amp: power * rand(0.3, 0.55), tau: 260 });
    this.strikes.push({ t0: this.fx.clock, pulses, x, seed: Math.random() * 100, bolt });
    if (this.strikes.length > 3) this.strikes.shift();
    return true;
  }

  /**
   * New note, in the rain: lightning, close — the bolt, the flash, the room lit up for an
   * instant, the glass shivering. Without lightning, a big drop hits the glass instead.
   */
  private thunderclap() {
    const p = this.fx.panel;
    const x = p.circle ? p.x + p.w / 2 : p.x + p.w * rand(0.55, 0.9);
    const y = p.circle ? Math.min(this.fx.H * 0.4, Math.max(40, p.y + p.h)) : Math.max(30, p.y + 1);
    if (this.strike({ bolt: true, power: 1, x: x + rand(-80, 80) })) {
      this.fx.shockwave(x, y, 0.9, 1800);
      if (this.fx.full) this.fx.burst(x, y, { count: 26, speed: 260, size: 1.6, life: 1, angle: -Math.PI / 2, spread: Math.PI * 0.9 });
      return;
    }
    this.fx.splash(x, y, 1.6);
  }

  /** The room behind you, lit by the lightning (a layer over everything). */
  init() {
    this.room = document.createElement("div");
    this.room.className = "fx-room";
    this.room.setAttribute("aria-hidden", "true");
    this.room.style.display = "none";
    document.body.append(this.room);
  }

  supported() {
    const sky = this.fx.sky;
    return !sky || sky.rainReady();
  }

  enter(instant: boolean) {
    this.wet = instant ? 1 : 0.15;
    this.sceneFade = instant ? 1 : 0.6;
    this.nextStrike = this.fx.clock + rand(4000, 9000);
  }

  leave() {
    this.strikes = [];
    this.flashNow = 0;
    this.setRoomFlash(0);
  }

  clear() {
    this.leave();
  }

  skyScale() {
    // Drops and falling rain need real resolution: up to 2x (1.6x on phones), within a pixel budget.
    const fx = this.fx;
    const dpr = devicePixelRatio || 1;
    const budget = Math.sqrt(4.2e6 / Math.max(1, fx.W * fx.H));
    return Math.min(dpr, fx.small ? 1.6 : 2, budget) * (fx.effective === "subtle" ? 0.75 : 1);
  }

  timeRate() {
    // rain never slows down: falling drops stutter visibly at anything less than every frame
    return 1;
  }

  step(now: number, dt: number, idle: boolean) {
    this.stepRain(now, dt, idle);
  }

  busy() {
    return true;
  }

  mustRender() {
    return this.flashNow > 0.004;
  }

  drawsSky() {
    return true;
  }

  behind() {
    this.fx.clearBehind();
  }

  /** Its part of the sky's frame. */
  frame() {
    const bolt = this.strikes[this.strikes.length - 1];
    const t = this.fx.time;
    return {
      flash: this.flashNow,
      boltX: bolt ? bolt.x : 0,
      boltSeed: bolt ? bolt.seed : 0,
      bolt: bolt?.bolt ? Math.min(1, this.flashNow * 2.2) : 0,
      amount: this.amountK,
      wet: this.wet,
      fog: 0.24 + this.amountK * 0.3,
      city: this.cityK,
      wind: 0.13 + 0.05 * Math.sin(t * 0.07) + 0.035 * Math.sin(t * 0.23 + 1),
      fade: this.sceneFade,
      blur: this.blurK,
    };
  }

  /** A new note: lightning, close. */
  newNote() {
    this.thunderclap();
    return true;
  }

  /** Checking off a to-do: a splash. */
  checked(x: number, y: number) {
    this.fx.splash(x, y);
    return true;
  }

  /** Sharing: it calls down the lightning. */
  beam(x: number, y: number) {
    this.strike({ bolt: true, power: 0.85, x: x + rand(-140, 140) });
    this.fx.splash(x, y, 1.3);
    return true;
  }

  /** A small eclipse's prominence, in the rain: a drop and its rings. */
  prominence(x: number, y: number, r: number) {
    const fx = this.fx;
    fx.ring(x, y, r * 0.8, r * 2.6, { dur: 950, color: WATER, width: 1, alpha: 0.6 });
    fx.ring(x, y, r * 0.6, r * 3.6, { dur: 1250, delay: 160, color: WATER, width: 0.8, alpha: 0.3 });
    fx.burst(x, y - r * 0.5, { count: 7, speed: 85, size: 1.1, life: 0.7, angle: -Math.PI / 2, spread: 1.4 });
    return true;
  }
}
