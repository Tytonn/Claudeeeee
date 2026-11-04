import type { FxEngine, FxLevel } from "../../fx/engine";
import type { SceneController } from "../../fx/scene";
import { mixRgb, to255 } from "../../fx/color";
import { easeOut, rand, type C255, type Timed } from "../../fx/util";

type Mote = { x: number; y: number; z: number; vx: number; vy: number; size: number; phase: number };
/** A coronal mass ejection: a loop of plasma erupting off the panel's edge. */
type Cme = Timed & { x: number; y: number; nx: number; ny: number; tx: number; ty: number; span: number; height: number; tilt: number };
/** A shooting star; fireballs leave a lingering wake and shed glowing fragments. */
type Meteor = Timed & { x: number; y: number; vx: number; vy: number; size: number; color: C255; flareAt: number; wake: boolean; fireball: boolean };
type Wake = Timed & { x0: number; y0: number; x1: number; y1: number; bend: number; width: number; color: C255 };
type Frag = { x: number; y: number; vx: number; vy: number; life: number; max: number; size: number; color: C255 };

/**
 * The galaxy (the eclipse): the note is the moon, and the corona streams out from behind it —
 * or, with the Eclipse setting, a moon of its own hangs in the sky beside your writing and the
 * corona pours out round that instead. Its sky is the engine's own; what's its alone is the life
 * behind the interface — dust drifting through the corona light, coronal mass ejections off the
 * panel's edges (or the moon's limb), and shooting stars (now and then a shower of them, or a
 * fireball).
 */
export class GalaxyScene implements SceneController {
  readonly id = "eclipse" as const;
  /** How far the engine may lower the sky's resolution to keep up (the eclipse's crisp edge needs more). */
  get floor() {
    return this.eclipseShown ? 0.6 : 0.35;
  }
  /** Full detail on a small screen too, while the eclipse is up (its fine rays and edge). */
  get detailOnSmall() {
    return this.eclipseShown;
  }
  readonly drops = false;
  readonly flashK = 1;

  constructor(private fx: FxEngine) {}

  private motes: Mote[] = [];
  private cmes: Cme[] = [];
  private nextCme = 5000;
  private meteors: Meteor[] = [];
  private wakes: Wake[] = [];
  private frags: Frag[] = [];
  private nextMeteor = 2600;
  private showerLeft = 0;

  private spawnCme() {
    const p = this.fx.panel;
    if (p.circle) {
      // off the moon's limb: a loop of plasma standing up from a point on its edge (mostly up top)
      const r = p.w / 2;
      const a = -Math.PI / 2 + rand(-1.25, 1.25);
      const nx = Math.cos(a);
      const ny = Math.sin(a);
      const base = { x: p.x + r + nx * r, y: p.y + r + ny * r, nx, ny, tx: -ny, ty: nx };
      const k = Math.min(1, r / 90);
      this.cmes.push({ ...base, span: rand(10, 20) * k, height: rand(18, 38) * k, tilt: rand(-0.5, 0.5), t0: this.fx.clock, dur: 2800 });
      this.fx.diamond.x = base.x;
      this.fx.diamond.y = base.y;
      this.fx.flareUp(0.35);
      return;
    }
    const edges: [string, number][] = [
      ["top", p.w * 0.8],
      ["right", p.h],
      ["left", p.h],
    ];
    let pick = Math.random() * edges.reduce((a, e) => a + e[1], 0);
    let edge = "top";
    for (const [name, w] of edges) {
      pick -= w;
      if (pick <= 0) {
        edge = name;
        break;
      }
    }
    const f = rand(0.15, 0.85);
    const base =
      edge === "top"
        ? { x: p.x + p.w * f, y: p.y, nx: 0, ny: -1, tx: 1, ty: 0 }
        : edge === "right"
          ? { x: p.x + p.w, y: p.y + p.h * f, nx: 1, ny: 0, tx: 0, ty: 1 }
          : { x: p.x, y: p.y + p.h * f, nx: -1, ny: 0, tx: 0, ty: 1 };
    this.cmes.push({ ...base, span: rand(16, 34), height: rand(26, 58), tilt: rand(-0.5, 0.5), t0: this.fx.clock, dur: 2800 });
    // Light the corona around the eruption.
    this.fx.diamond.x = base.x;
    this.fx.diamond.y = base.y;
    this.fx.flareUp(0.4);
  }

  private drawCmes(ctx: CanvasRenderingContext2D) {
    const now = this.fx.clock;
    const hot = this.fx.accentHot.join(",");
    this.cmes = this.cmes.filter((c) => {
      const k = (now - c.t0) / c.dur;
      if (k >= 1) return false;
      const grow = easeOut(Math.min(1, k * 1.5));
      const fade = k < 0.5 ? 1 : 1 - (k - 0.5) / 0.5;
      for (const [scale, w, a] of [
        [1, 7, 0.12],
        [1, 1.8, 0.75],
        [0.62, 1.2, 0.5],
      ] as const) {
        const span = c.span * scale;
        const h = c.height * grow * scale * 1.7;
        const p0x = c.x - c.tx * span;
        const p0y = c.y - c.ty * span;
        const p2x = c.x + c.tx * span;
        const p2y = c.y + c.ty * span;
        const cx = c.x + c.nx * h + c.tx * c.tilt * h;
        const cy = c.y + c.ny * h + c.ty * c.tilt * h;
        ctx.strokeStyle = `rgba(${hot},${a * fade})`;
        ctx.lineWidth = w;
        ctx.beginPath();
        ctx.moveTo(p0x, p0y);
        ctx.quadraticCurveTo(cx, cy, p2x, p2y);
        ctx.stroke();
      }
      return true;
    });
  }

  private seedMotes() {
    const n = this.fx.small ? 34 : this.fx.effective === "subtle" ? 30 : 90;
    this.motes = Array.from({ length: n }, () => this.newMote(true));
  }

  private newMote(anywhere: boolean): Mote {
    const z = Math.random() * 0.8 + 0.2;
    return {
      x: Math.random() * this.fx.W,
      y: anywhere ? Math.random() * this.fx.H : this.fx.H + 10,
      z,
      vx: rand(-5, 5) * z,
      vy: -rand(3, 13) * z,
      size: rand(0.5, 1.9) * (0.5 + z),
      phase: Math.random() * Math.PI * 2,
    };
  }

  private drawDust(dt: number) {
    const ctx = this.fx.dctx;
    if (!ctx) return;
    this.fx.wipe(ctx);
    ctx.globalCompositeOperation = "lighter";
    const tint = to255(mixRgb(this.fx.a, [1, 1, 1], 0.55));
    const sprite = this.fx.sprite(tint);
    const p = this.fx.panel;
    const px = (this.fx.smouse.x / Math.max(1, this.fx.W) - 0.5) * 24;
    const py = (this.fx.smouse.y / Math.max(1, this.fx.H) - 0.5) * 24;
    const speed = 0.3 + 0.7 * this.fx.energy;
    for (const m of this.motes) {
      m.x += m.vx * dt * speed;
      m.y += m.vy * dt * speed;
      m.phase += dt * (0.6 + m.z);
      if (m.y < -12 || m.x < -12 || m.x > this.fx.W + 12) Object.assign(m, this.newMote(false));
      const x = m.x - px * m.z;
      const y = m.y - py * m.z;
      // Brighter where the corona light falls.
      const dx = Math.max(p.x - x, 0, x - (p.x + p.w));
      const dy = Math.max(p.y - y, 0, y - (p.y + p.h));
      const inside = dx === 0 && dy === 0 && !p.circle;
      if (inside && !this.fx.open) continue;
      // (round a moon, how far from its limb; behind the galaxy's own moon, none)
      const fromLimb = p.circle ? Math.hypot(x - (p.x + p.w / 2), y - (p.y + p.h / 2)) - p.w / 2 : 0;
      if (p.circle && fromLimb < 0 && this.eclipseK > 0.5) continue;
      const edge = p.circle ? Math.max(0, fromLimb) : Math.hypot(dx, dy);
      const lit = Math.exp(-edge / 140) * (1 + this.fx.flare * 2);
      const tw = 0.55 + 0.45 * Math.sin(m.phase * 2.1);
      const alpha = (0.1 + lit * 0.55) * tw * (0.4 + 0.6 * m.z);
      if (alpha < 0.01) continue;
      const s = m.size * (2.6 + lit * 2);
      ctx.globalAlpha = Math.min(1, alpha);
      ctx.drawImage(sprite, x - s, y - s, s * 2, s * 2);
    }
    ctx.globalAlpha = 1;
    if (this.cmes.length) this.drawCmes(ctx);
    if (this.meteors.length || this.wakes.length || this.frags.length) this.drawMeteors(ctx, dt);
    ctx.globalCompositeOperation = "source-over";
  }

  /** Spawns one meteor, mostly where it can be seen: through the side glass or around the panel. */
  meteor(o: { fireball?: boolean } = {}) {
    if (!this.fx.full || this.fx.rain || this.fx.solar) return;
    const p = this.fx.panel;
    const left = Math.max(0, p.x);
    const right = Math.max(0, this.fx.W - (p.x + p.w));
    let x: number;
    const r = Math.random() * (left + right + this.fx.W * 0.25);
    if (p.circle || r > left + right) x = Math.random() * this.fx.W;
    else if (r < left) x = Math.random() * left;
    else x = p.x + p.w + Math.random() * right;
    const y = rand(0.02, 0.62) * this.fx.H;
    // Every meteor in a shower streams away from the same radiant, high up and off to the right.
    const rx = this.fx.W * 1.15;
    const ry = -this.fx.H * 0.4;
    let dx = x - rx;
    let dy = y - ry;
    const d = Math.hypot(dx, dy) || 1;
    const jitter = rand(-0.08, 0.08);
    dx = dx / d;
    dy = dy / d;
    const ux = dx * Math.cos(jitter) - dy * Math.sin(jitter);
    const uy = dx * Math.sin(jitter) + dy * Math.cos(jitter);
    const fireball = o.fireball ?? Math.random() < 0.06;
    const speed = fireball ? rand(380, 560) : rand(520, 980);
    const dur = fireball ? rand(1300, 1700) : rand(450, 1050);
    const hue = Math.random();
    const color: C255 = hue < 0.55 ? this.fx.accentHot : hue < 0.8 ? to255(mixRgb(this.fx.bTo, [1, 1, 1], 0.45)) : [255, 236, 214];
    this.meteors.push({
      x,
      y,
      vx: ux * speed,
      vy: uy * speed,
      size: fireball ? rand(2.2, 2.8) : rand(0.9, 1.7),
      color,
      flareAt: rand(0.55, 0.85),
      wake: fireball || Math.random() < 0.3,
      fireball,
      t0: this.fx.clock,
      dur,
    });
  }

  private drawMeteors(ctx: CanvasRenderingContext2D, dt: number) {
    const now = this.fx.clock;
    ctx.lineCap = "round";

    // Wakes, beneath: they linger, widen and twist as the wind takes them.
    this.wakes = this.wakes.filter((w) => {
      const k = (now - w.t0) / w.dur;
      if (k >= 1) return false;
      const a = Math.pow(1 - k, 1.6) * 0.2 * Math.min(1, k * 8);
      const dx = w.x1 - w.x0;
      const dy = w.y1 - w.y0;
      const b = w.bend * easeOut(k);
      const c = w.color.join(",");
      const g = ctx.createLinearGradient(w.x0, w.y0, w.x1, w.y1);
      g.addColorStop(0, `rgba(${c},0)`);
      g.addColorStop(0.55, `rgba(${c},${a})`);
      g.addColorStop(0.9, `rgba(${c},${a * 0.6})`);
      g.addColorStop(1, `rgba(${c},0)`);
      ctx.strokeStyle = g;
      ctx.lineWidth = w.width * (1 + k * 3);
      ctx.beginPath();
      ctx.moveTo(w.x0, w.y0);
      ctx.quadraticCurveTo((w.x0 + w.x1) / 2 - dy * b, (w.y0 + w.y1) / 2 + dx * b, w.x1, w.y1);
      ctx.stroke();
      return true;
    });

    this.meteors = this.meteors.filter((m) => {
      const k = (now - m.t0) / m.dur;
      const t = (Math.min(1, k) * m.dur) / 1000;
      const hx = m.x + m.vx * t;
      const hy = m.y + m.vy * t;
      if (k >= 1) {
        if (m.wake) {
          const from = 0.2 * t;
          this.wakes.push({
            x0: m.x + m.vx * from,
            y0: m.y + m.vy * from,
            x1: hx,
            y1: hy,
            bend: rand(-0.08, 0.08),
            width: m.fireball ? 2.4 : 1.4,
            color: m.color,
            t0: now,
            dur: m.fireball ? 3200 : rand(1600, 2400),
          });
        }
        return false;
      }
      // Brightens, flares near the end of its life, then gutters out.
      let b = Math.pow(Math.sin(Math.PI * k), 0.55);
      b *= 1 + (m.fireball ? 2.2 : 1.4) * Math.exp(-Math.pow((k - m.flareAt) / 0.07, 2));
      const speed = Math.hypot(m.vx, m.vy);
      const len = Math.min(speed * t, speed * (m.fireball ? 0.3 : 0.17));
      const ux = m.vx / speed;
      const uy = m.vy / speed;
      const tx = hx - ux * len;
      const ty = hy - uy * len;
      const c = m.color.join(",");
      const g = ctx.createLinearGradient(hx, hy, tx, ty);
      g.addColorStop(0, `rgba(255,255,255,${Math.min(1, b * 0.95)})`);
      g.addColorStop(0.22, `rgba(${c},${Math.min(1, b * 0.6)})`);
      g.addColorStop(1, `rgba(${c},0)`);
      ctx.strokeStyle = g;
      ctx.beginPath();
      ctx.moveTo(tx, ty);
      ctx.lineTo(hx, hy);
      ctx.lineWidth = m.size * 4;
      ctx.globalAlpha = 0.28;
      ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.lineWidth = m.size;
      ctx.stroke();
      const s = m.size * (3.5 + 4.5 * Math.min(2, b));
      ctx.globalAlpha = Math.min(1, b);
      ctx.drawImage(this.fx.sprite(m.color), hx - s, hy - s, s * 2, s * 2);
      ctx.globalAlpha = 1;
      // Fireballs shed glowing fragments.
      if (m.fireball && Math.random() < dt * 45) {
        const life = rand(0.35, 0.8);
        this.frags.push({ x: hx, y: hy, vx: m.vx * rand(0.1, 0.3) + rand(-20, 20), vy: m.vy * rand(0.1, 0.3) + rand(-20, 20), life, max: life, size: rand(0.8, 1.6), color: m.color });
      }
      return true;
    });

    this.frags = this.frags.filter((f) => {
      f.life -= dt;
      if (f.life <= 0) return false;
      f.x += f.vx * dt;
      f.y += f.vy * dt;
      f.vx *= 0.96;
      f.vy *= 0.96;
      const s = f.size * 3;
      ctx.globalAlpha = (f.life / f.max) * 0.85;
      ctx.drawImage(this.fx.sprite(f.color), f.x - s, f.y - s, s * 2, s * 2);
      return true;
    });
    ctx.globalAlpha = 1;
  }

  init() {
    this.seedMotes();
  }

  supported() {
    return true;
  }

  enter() {}

  leave() {
    this.cmes = [];
    this.meteors = [];
    this.wakes = [];
    this.frags = [];
  }

  clear() {
    this.meteors = [];
    this.wakes = [];
    this.frags = [];
  }

  skyScale() {
    const fx = this.fx;
    // (the nebula is soft, so a phone draws it small — but the eclipse's moon has a crisp edge and a
    // thin ring of fire round it, so while it's up a phone draws as sharply as the solar eclipse does)
    if (fx.small) return this.eclipseShown ? Math.min(devicePixelRatio || 1, 1.25) * (fx.effective === "subtle" ? 0.7 : 1) : 0.55;
    return Math.min(devicePixelRatio || 1, 1.25) * (fx.effective === "subtle" ? 0.6 : 1);
  }

  /** Whether its own eclipse is up (or on its way). */
  private get eclipseShown() {
    return this.eclipseOn || this.showing;
  }

  timeRate(lvl: FxLevel) {
    // the eclipse slows and holds its breath while you write
    return (0.25 + 0.75 * this.fx.energy) * (lvl === "subtle" ? 0.35 : 1);
  }

  // ── its own eclipse ───────────────────────────────────────────────────────

  /** The Eclipse setting: a moon hanging in the sky beside your writing, the corona pouring out round it. */
  private eclipseOn = false;
  /** Whether its moon is where the corona pours from right now (it hands over from the page, and back, gently). */
  private showing = false;
  /** How far its moon has grown in, 0..1 (it swells out of a point of light). */
  private eclipseK = 0;
  /** How bright the corona is, 0..1: handing over, it dims away from where it is, then blooms round the other. */
  private coronaK = 1;
  private moon = { x: 0, y: 0, r: 0 };
  private moonPlaced = false;

  /** Right in the middle of the screen (behind your words), rather than beside them. */
  private eclipseMiddle = false;

  setEclipse(on: boolean, middle = false) {
    // (moving it from one spot to the other, it glides there)
    this.eclipseMiddle = middle;
    if (on === this.eclipseOn) return;
    this.eclipseOn = on;
    this.fx.refreshSky();
    // Off-screen (or before the first frame), it's simply there — or not — next time.
    if (!this.fx.started || this.fx.scene !== "eclipse" || !this.fx.active) {
      this.showing = on;
      this.eclipseK = on ? 1 : 0;
      this.coronaK = 1;
      this.moonPlaced = false;
    }
  }

  /** The middle of the screen: centred behind your writing, a little above halfway down. */
  private middle() {
    const fx = this.fx;
    const page = fx.pageRect;
    const m = Math.min(fx.W, fx.H);
    const fit = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
    if (fx.small) return { x: fx.W / 2, y: fx.H * 0.42, r: fit(fx.W * 0.14, 34, 90) };
    const x = page.w > 0 ? page.x + page.w / 2 : fx.W / 2;
    return { x, y: fx.H * 0.45, r: fit(m * 0.1, 40, 130) };
  }

  /** The moon of its own eclipse (CSS px), while it's where the corona pours from. */
  moonNow(): { x: number; y: number; r: number } | null {
    if (!this.showing || !this.moonPlaced) return null;
    const e = easeOut(this.eclipseK);
    // it swells out of a point of light (never quite nothing, so the corona has a centre)
    return { x: this.moon.x, y: this.moon.y, r: Math.max(1.5, this.moon.r * e) };
  }

  /** How solid its moon is, 0..1 (for the sky): it fades with its corona as it goes. */
  get eclipseNow() {
    return this.showing && this.moonPlaced ? Math.min(1, this.eclipseK * 1.6) * this.coronaNow : 0;
  }

  /** How bright the corona is right now, 0..1 (eased). */
  get coronaNow() {
    const k = this.coronaK;
    return k * k * (3 - 2 * k);
  }

  step(_now: number, dt: number) {
    if (this.showing !== this.eclipseOn) {
      // handing over: the light dims away from where it is now (the moon fading with it, where it stays)…
      this.coronaK = Math.max(0, this.coronaK - dt / (this.showing ? 0.6 : 0.35));
      if (this.coronaK <= 0) {
        // …and blooms round the other: the moon swells out of a point of light, or the page's
        // corona flares back up round its edges
        this.showing = this.eclipseOn;
        this.eclipseK = 0;
        this.moonPlaced = false;
        this.fx.refreshSky();
        this.fx.flareUp(this.showing ? 0.6 : 0.5);
      }
    } else if (this.coronaK < 1) {
      this.coronaK = Math.min(1, this.coronaK + dt / 0.9);
    }
    if (this.showing && this.eclipseK < 1) {
      this.eclipseK += (1 - this.eclipseK) * Math.min(1, dt * 1.5);
      if (1 - this.eclipseK < 0.003) this.eclipseK = 1;
    }
    if (!this.showing || !this.fx.panelEl) {
      this.moonPlaced = false;
      return;
    }
    const home = this.eclipseMiddle ? this.middle() : this.fx.eclipseHome();
    if (!this.moonPlaced) {
      this.moon = { ...home };
      this.moonPlaced = true;
    } else {
      // it glides to a new spot when the layout changes
      const k = Math.min(1, dt * 2.2);
      this.moon.x += (home.x - this.moon.x) * k;
      this.moon.y += (home.y - this.moon.y) * k;
      this.moon.r += (home.r - this.moon.r) * k;
    }
  }

  busy() {
    // (while the corona hands over, or the moon swells in)
    return this.showing !== this.eclipseOn || this.coronaK < 1 || (this.showing && this.eclipseK < 1);
  }

  mustRender() {
    return false;
  }

  drawsSky() {
    return true;
  }

  behind(now: number, dt: number, idle: boolean) {
    const fx = this.fx;
    const lvl = fx.effective;
    if (lvl === "cosmic" && !fx.calm && !fx.open && fx.panelEl && now > this.nextCme) {
      this.spawnCme();
      this.nextCme = now + rand(7000, 15000) * (idle ? 0.55 : 1);
    }

    // Shooting stars — now and then a little shower of them.
    if (lvl === "cosmic" && !fx.calm && now > this.nextMeteor) {
      this.meteor();
      if (this.showerLeft > 0) {
        this.showerLeft--;
        this.nextMeteor = now + rand(160, 520);
      } else if (Math.random() < 0.1) {
        this.showerLeft = 3 + ((Math.random() * 4) | 0);
        this.nextMeteor = now + rand(200, 420);
      } else this.nextMeteor = now + rand(2200, 6500) * (fx.small ? 2 : 1) * (idle ? 0.45 : 1);
    }

    this.drawDust(dt);
  }
}
