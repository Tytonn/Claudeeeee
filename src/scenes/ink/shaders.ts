/**
 * Ink: real ink drifting through clear water, over warm paper.
 *
 * Two passes. The first is a small fluid-style simulation: ink (two dyes — charcoal, and a deep
 * indigo) is carried along by a slowly churning current, so it curls, stretches into tendrils,
 * thins and fades on its own, and never repeats. The current is a field of eddies (the curl of
 * an evolving noise, so it never piles ink up or tears it apart), plus the push of each new
 * bloom as it opens, and the gentle stir of the cursor. Ink is carried with cubic sampling, which
 * keeps the fine tendrils from blurring away. New clouds bloom now and then, mostly low and
 * along the edges; ink that wanders behind the note thins away.
 *
 * The second pass paints: paper with its grain and fibres, the ink soaking the light out of it
 * (charcoal where it's dense, a hint of indigo where it's thin), the ripples of a drop, and the
 * drop itself falling through the dark, when Ink first arrives.
 */

export const INK_COMMON = /* glsl */ `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * .1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

/* Gradient noise whose gradients slowly turn (flow noise), with its derivatives: the eddies
   evolve in place instead of sliding across the screen. */
vec2 grad2(vec2 i, float t) {
  float a = hash12(i) * 6.2831853 + t * (hash12(i + 17.31) * 2. - 1.);
  return vec2(cos(a), sin(a));
}
vec3 fnoise(vec2 p, float t) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * f * (f * (f * 6. - 15.) + 10.);
  vec2 du = 30. * f * f * (f * (f - 2.) + 1.);
  vec2 ga = grad2(i, t);
  vec2 gb = grad2(i + vec2(1., 0.), t);
  vec2 gc = grad2(i + vec2(0., 1.), t);
  vec2 gd = grad2(i + vec2(1., 1.), t);
  float va = dot(ga, f);
  float vb = dot(gb, f - vec2(1., 0.));
  float vc = dot(gc, f - vec2(0., 1.));
  float vd = dot(gd, f - vec2(1., 1.));
  float k = va - vb - vc + vd;
  float v = va + u.x * (vb - va) + u.y * (vc - va) + u.x * u.y * k;
  vec2 d = ga + u.x * (gb - ga) + u.y * (gc - ga) + u.x * u.y * (ga - gb - gc + gd) + du * (u.yx * k + vec2(vb, vc) - va);
  return vec3(v, d);
}

float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3. - 2. * f);
  return mix(mix(hash12(i), hash12(i + vec2(1., 0.)), u.x), mix(hash12(i + vec2(0., 1.)), hash12(i + vec2(1., 1.)), u.x), u.y);
}
float fbm(vec2 p) {
  float s = 0.;
  float a = .5;
  for (int i = 0; i < 4; i++) {
    s += a * vnoise(p);
    p = p * 2.03 + vec2(17.1, 9.2);
    a *= .5;
  }
  return s;
}
`;

/** Up to this many blooms open at once. */
export const INK_BLOOMS = 6;

export const INK_SIM_UNIFORMS = ["uDye", "uRes", "uAspect", "uTime", "uDt", "uBloomA", "uBloomB", "uPanel", "uStir", "uEncode", "uClear", "uFlow"];

export const INK_SIM_FRAG = /* glsl */ `${INK_COMMON}
uniform sampler2D uDye;   // the ink so far: r charcoal, g indigo
uniform vec2 uRes;        // the simulation's size, texels
uniform float uAspect;    // width / height
uniform float uTime;      // the current's own clock (s)
uniform float uDt;        // this step (s)
uniform vec4 uBloomA[${INK_BLOOMS}]; // xy where (x 0..aspect, y 0..1 up), z radius, w age (s; < 0: none)
uniform vec4 uBloomB[${INK_BLOOMS}]; // x how much ink, y indigo share, z push, w seed (+1000: a drop's splash)
uniform vec4 uPanel;      // the note, kept clear: x0, y0, x1, y1 (same space)
uniform vec4 uStir;       // the cursor: where, and how it's moving (per s)
uniform float uEncode;    // 1: stored in 8 bits (square-root encoded)
uniform float uClear;     // how firmly the note's area is kept clear
uniform float uFlow;      // how lively the current is

const float MAXD = 4.;

vec4 decode(vec4 t) {
  return uEncode > .5 ? t * t * MAXD : t;
}
vec4 tex(vec2 uv) {
  return decode(texture2D(uDye, uv));
}

/* Catmull-Rom (nine bilinear taps): far less blurring than bilinear, so tendrils stay fine. */
vec4 cubic(vec2 uv) {
  vec2 pos = uv * uRes - .5;
  vec2 c = floor(pos);
  vec2 f = pos - c;
  vec2 w0 = f * (-.5 + f * (1. - .5 * f));
  vec2 w1 = 1. + f * f * (-2.5 + 1.5 * f);
  vec2 w2 = f * (.5 + f * (2. - 1.5 * f));
  vec2 w3 = f * f * (-.5 + .5 * f);
  vec2 w12 = w1 + w2;
  vec2 t0 = (c - .5) / uRes;
  vec2 t3 = (c + 2.5) / uRes;
  vec2 t12 = (c + .5 + w2 / w12) / uRes;
  vec4 r = tex(vec2(t0.x, t0.y)) * w0.x * w0.y + tex(vec2(t12.x, t0.y)) * w12.x * w0.y + tex(vec2(t3.x, t0.y)) * w3.x * w0.y
         + tex(vec2(t0.x, t12.y)) * w0.x * w12.y + tex(vec2(t12.x, t12.y)) * w12.x * w12.y + tex(vec2(t3.x, t12.y)) * w3.x * w12.y
         + tex(vec2(t0.x, t3.y)) * w0.x * w3.y + tex(vec2(t12.x, t3.y)) * w12.x * w3.y + tex(vec2(t3.x, t3.y)) * w3.x * w3.y;
  // never overshoot what's around it (cubic rings otherwise)
  vec2 b = (c + .5) / uRes;
  vec2 e = 1. / uRes;
  vec4 a0 = tex(b);
  vec4 a1 = tex(b + vec2(e.x, 0.));
  vec4 a2 = tex(b + vec2(0., e.y));
  vec4 a3 = tex(b + e);
  return clamp(r, min(min(a0, a1), min(a2, a3)), max(max(a0, a1), max(a2, a3)));
}

/* The softness of the note's rectangle (1 inside, fading out around it). */
float panelMask(vec2 p) {
  vec2 c = (uPanel.xy + uPanel.zw) * .5;
  vec2 h = max((uPanel.zw - uPanel.xy) * .5, vec2(.001));
  vec2 q = abs(p - c) - h;
  float d = length(max(q, 0.)) + min(max(q.x, q.y), 0.);
  return 1. - smoothstep(-.06, .1, d);
}

/* A small whirlpool (soft-cored), turning ink around it. */
vec2 vortex(vec2 d, float gamma, float core) {
  return vec2(-d.y, d.x) * gamma / (dot(d, d) + core * core);
}

/* The current: big slow eddies and smaller, quicker ones; each new bloom opening out, turning
   as it goes and rolling its edge over in curls; a drift away from the note; and the stir of the
   cursor. Screen heights per second. */
vec2 flow(vec2 p) {
  float t = uTime;
  vec3 n1 = fnoise(p * 1.1 + vec2(3.1, 7.7), t * .05);
  vec3 n2 = fnoise(p * 2.9 + vec2(11.3, 1.9), t * .09);
  vec3 n3 = fnoise(p * 6.3 + vec2(5.9, 13.1), t * .16);
  vec3 n4 = fnoise(p * 13.1 + vec2(1.3, 4.1), t * .27);
  vec2 v = vec2(n1.z, -n1.y) * .016 + vec2(n2.z, -n2.y) * .011 + vec2(n3.z, -n3.y) * .0075 + vec2(n4.z, -n4.y) * .0038;
  // near a young bloom the water churns finely, tearing its edge into tendrils
  vec3 n5 = fnoise(p * 21.7 + vec2(7.7, 2.2), t * .45);
  float young = 0.;
  v *= uFlow;
  // ink is a little heavier than water: it drifts down, slowly, and spreads along the bottom
  v.y -= .0035 * smoothstep(.03, .35, p.y);
  // a gentle drift away from the note
  vec2 c = (uPanel.xy + uPanel.zw) * .5;
  v += normalize(p - c + 1e-4) * .007 * panelMask(p) * uClear;
  for (int i = 0; i < ${INK_BLOOMS}; i++) {
    vec4 A = uBloomA[i];
    vec4 B = uBloomB[i];
    if (A.w < 0. || A.w > 14.) continue;
    vec2 d = p - A.xy;
    float R = max(A.z, 1e-3);
    float r = length(d) / R;
    if (r > 7.) continue;
    float splash = step(999., B.w);
    float seed = B.w - 1000. * splash;
    young += exp(-A.w / 3.5) * exp(-r * r * .18) * (1. + splash);
    // it opens out (hard at first, then easing off), most strongly just inside its edge — a
    // drop's splash further and faster
    float push = B.z * exp(-A.w / mix(1.5, 1.05, splash)) * r * exp(-r * r * mix(.55, .3, splash));
    v += d / max(length(d), 1e-4) * push;
    // and turns (one way or the other), winding its ragged edge into spirals
    float spin = (fract(seed * 7.31) < .5 ? -1. : 1.) * (.5 + .5 * fract(seed * 3.17));
    v += vortex(d, spin * .0024 * exp(-A.w / 7.) * (1. - .6 * splash), R * .9);
    if (splash > .5 && A.w < 8.) {
      // a drop landing in water: the ring of ink it throws out breaks into fingers as it runs,
      // and each finger's tip rolls over into a cap of curls (whirls turning opposite ways, side
      // by side), the way ink really opens in still water
      float ring = R * (.9 + 2.9 * (1. - exp(-A.w / 1.2)));
      float g = .0027 * exp(-A.w / 3.);
      // (never quite even: the fingers run out unequally, some curling hard, some barely)
      vec2 lean = vec2(cos(seed * 4.1), sin(seed * 4.1)) * R * .35 * min(A.w, 2.);
      for (int j = 0; j < 12; j++) {
        float fj = float(j);
        float h1 = fract(seed * 5.3 + fj * .37);
        float h2 = fract(seed * 2.9 + fj * .61);
        float aj = seed * 1.7 + fj * .523599 + .42 * sin(seed * 3. + fj * 2.1);
        vec2 at = A.xy + lean + vec2(cos(aj), sin(aj)) * ring * (.66 + .62 * h1);
        float sgn = mod(fj, 2.) < .5 ? 1. : -1.;
        v += vortex(p - at, sgn * g * (.35 + 1.15 * h2 * h2), R * (.17 + .12 * h1));
      }
    }
    // two smaller whirls on its rim roll the edge over in curls
    float a0 = seed * 2.399;
    float sweep = min(A.w, 6.) * .08;
    for (int j = 0; j < 2; j++) {
      float aj = a0 + float(j) * 3.14159 + sweep;
      float rim = R * (1. + .35 * min(A.w, 4.));
      vec2 at = A.xy + vec2(cos(aj), sin(aj)) * rim;
      float sgn = j == 0 ? 1. : -1.;
      v += vortex(p - at, sgn * spin * .0011 * exp(-A.w / 5.), R * .45);
    }
  }
  v += vec2(n5.z, -n5.y) * .0042 * min(young, 1.5) * uFlow;
  vec2 sd = p - uStir.xy;
  v += uStir.zw * exp(-dot(sd, sd) / (.11 * .11)) * .55;
  return v;
}

void main() {
  vec2 uv = gl_FragCoord.xy / uRes;
  vec2 S = vec2(uAspect, 1.);
  vec2 p = uv * S;
  // carried along: where this ink was a moment ago (two half-steps, for curved paths)
  vec2 v1 = flow(p);
  vec2 mid = p - v1 * uDt * .5;
  vec2 v2 = flow(mid);
  vec2 from = (p - v2 * uDt) / S;
  vec4 d = cubic(from);

  // new ink, blooming in quickly (ragged at the edges, so it breaks up into tendrils as it spreads)
  for (int i = 0; i < ${INK_BLOOMS}; i++) {
    vec4 A = uBloomA[i];
    vec4 B = uBloomB[i];
    if (A.w < 0. || A.w > 1.6) continue;
    vec2 q = (p - A.xy) / max(A.z, 1e-3);
    float r2 = dot(q, q);
    if (r2 > 9.) continue;
    float splash = step(999., B.w);
    float seed = B.w - 1000. * splash;
    // (a drop's ink is all there the moment it lands)
    float rate = mix(smoothstep(0., .15, A.w) * (1. - smoothstep(.45, 1.3, A.w)), 2.2 * (1. - smoothstep(.12, .5, A.w)), splash);
    float r = sqrt(r2);
    float ang = atan(q.y, q.x);
    // ink enters near the middle (in ragged lobes) and the bloom's own push opens it out: the
    // ring, the fingers and the dense heart all come from the water, not from a stamp
    float lobes = fbm(vec2(cos(ang), sin(ang)) * 1.9 + seed * 7.9);
    float reach = .42 + .38 * lobes;
    float rr = r / reach;
    float core = exp(-rr * rr * 2.2);
    // a drop's splash: thrown out in a ragged ring (and only a little left in the middle)
    float ringAt = .72 + .3 * (lobes - .5);
    float ru = (r - ringAt) / .2;
    if (splash > .5) core = exp(-ru * ru) + .22 * core;
    float rag = fbm(q * 3.4 + seed * 13.7);
    float amount = B.x * rate * core * (.45 + 1.1 * smoothstep(.3, .7, rag)) * 1.35 * uDt;
    d.r += amount * (1. - B.y);
    d.g += amount * B.y;
  }

  // ink slowly gives itself to the water; behind the note it fades much faster
  float pm = panelMask(p);
  float lambda = .0055 + .85 * pm * uClear;
  d.rg *= exp(-lambda * uDt);
  // (thin ink wears away first: what's left behind the note breaks into wisps as it goes)
  d.rg = max(d.rg - (.0006 + .09 * pm * uClear) * uDt, 0.);
  // and a whisker off the very edge of the screen
  vec2 e = min(uv, 1. - uv);
  d.rg *= mix(.985, 1., smoothstep(0., .01, min(e.x, e.y)));
  d = clamp(d, 0., MAXD);

  if (uEncode > .5) {
    // 8 bits: square-root encoded, dithered so faint ink doesn't stall or band
    vec4 enc = sqrt(d / MAXD);
    enc += (hash12(gl_FragCoord.xy + fract(uTime * 13.7) * 91.) - .5) / 255.;
    gl_FragColor = vec4(enc.rg, 0., 1.);
  } else {
    gl_FragColor = vec4(d.rg, 0., 1.);
  }
}
`;

export const INK_VIEW_UNIFORMS = [
  "uDye0",
  "uDye1",
  "uMix",
  "uRes",
  "uTime",
  "uEncode",
  "uPanel",
  "uPanelR",
  "uBehind",
  "uRipple0",
  "uRipple1",
  "uRipple2",
  "uIntro",
  "uDrop",
  "uFade",
  "uQuality",
  "uA",
  "uPaper",
];

export const INK_VIEW_FRAG = /* glsl */ `${INK_COMMON}
uniform sampler2D uDye0;  // the ink a moment ago
uniform sampler2D uDye1;  // and now (the simulation steps less often than the screen redraws)
uniform float uMix;       // how far between them
uniform vec2 uRes;        // this canvas, px
uniform float uTime;      // s
uniform float uEncode;
uniform vec4 uPanel;      // the note: x0, y0, x1, y1, px (y up)
uniform float uPanelR;    // its corner radius, px
uniform float uBehind;    // how much ink shows behind the note
uniform vec4 uRipple0;    // ripples: x, y px, age s, strength
uniform vec4 uRipple1;
uniform vec4 uRipple2;
uniform vec4 uIntro;      // x: darkness, y: how far the paper has opened (screen heights), z: the drop falling 0..1, w: the flash of its landing
uniform vec2 uDrop;       // where the drop lands, px
uniform float uFade;      // the scene fading in
uniform float uQuality;
uniform vec3 uA;          // the accent (a whisper of it, in the thinnest ink)
uniform sampler2D uPaper; // the paper, painted once

const float MAXD = 4.;

vec4 dye(sampler2D t, vec2 uv) {
  vec4 s = texture2D(t, uv);
  return uEncode > .5 ? s * s * MAXD : s;
}
vec2 ink(vec2 uv) {
  // (between the last two steps: never beyond them, or the ink would be extrapolated)
  return max(mix(dye(uDye0, uv), dye(uDye1, uv), clamp(uMix, 0., 1.)).rg, 0.);
}

float roundedBox(vec2 p, vec2 c, vec2 h, float r) {
  vec2 q = abs(p - c) - h + r;
  return length(max(q, 0.)) + min(max(q.x, q.y), 0.) - r;
}

/* A ripple: a ring running outward, bending what's under it. */
vec2 ripple(vec4 R, vec2 frag, float H, inout float shade) {
  if (R.w <= 0.) return vec2(0.);
  float rr = R.z * H * .55;              // radius, px
  vec2 d = frag - R.xy;
  float dist = length(d);
  float w = H * (.03 + R.z * .05);
  float x = (dist - rr) / w;
  float env = exp(-x * x) * R.w * exp(-R.z * 1.5) * smoothstep(0., .08, R.z);
  float wave = sin(x * 2.3) * env;
  shade += wave * .02;
  return d / max(dist, 1.) * wave * H * .0055;
}

void main() {
  vec2 frag = gl_FragCoord.xy;
  vec2 uv = frag / uRes;
  float H = uRes.y;

  // ripples bend the paper and the ink a little
  float shade = 0.;
  vec2 off = ripple(uRipple0, frag, H, shade) + ripple(uRipple1, frag, H, shade) + ripple(uRipple2, frag, H, shade);
  vec2 iuv = uv + off / uRes;

  vec2 k = ink(iuv);
  // the water scatters a little light around dense ink: a soft halo
  vec2 hs = vec2(H * .014) / uRes;
  vec2 kx1 = ink(iuv + vec2(hs.x, 0.));
  vec2 kx0 = ink(iuv - vec2(hs.x, 0.));
  vec2 ky1 = ink(iuv + vec2(0., hs.y));
  vec2 ky0 = ink(iuv - vec2(0., hs.y));
  vec2 halo = (kx1 + kx0 + ky1 + ky0) * .25;
  // the billows are lit softly from above: a little lighter on the side toward the light
  vec2 g = vec2(kx1.r + kx1.g - kx0.r - kx0.g, ky1.r + ky1.g - ky0.r - ky0.g);
  float lit = dot(g, normalize(vec2(-.45, .9))) / (length(g) + .08);
  float body = smoothstep(.05, .6, k.r + k.g);

  // behind the note, only faint wisps
  vec2 c = (uPanel.xy + uPanel.zw) * .5;
  vec2 h = (uPanel.zw - uPanel.xy) * .5;
  float pd = roundedBox(frag, c, h, uPanelR);
  float inside = 1. - smoothstep(-H * .02, H * .05, pd);
  k *= mix(1., uBehind, inside * step(1., h.x));

  // the paper (painted once, see INK_PAPER_FRAG), a little brighter at the top
  vec3 paper = texture2D(uPaper, uv).rgb;
  paper += shade;
  vec2 vc = uv - .5;

  // the ink soaks the light out of it: charcoal where it's dense, with a hint of deep indigo
  // where it's thin, as ink is in water
  vec3 sigC = vec3(1.0, .985, .93);
  vec3 sigI = vec3(1.12, 1.03, .78);
  vec3 sig = k.r * sigC + k.g * sigI;
  sig += (halo.r * sigC + halo.g * sigI) * .22;
  float thin = 1. - smoothstep(0., .6, k.r + k.g);
  sig += (k.r + k.g) * thin * vec3(.07, .03, -.04);
  sig *= 1. - .16 * lit * body;
  vec3 T = exp(-sig * 1.05);
  vec3 floorC = vec3(.11, .11, .128);
  vec3 col = paper * T + floorC * (1. - T) * (1. - T.g);

  // the arrival: the dark, a single drop falling through it, and the paper opening from where it lands
  if (uIntro.x > 0.) {
    vec2 rel = (frag - uDrop) / H;
    float dist = length(rel);
    vec3 night = vec3(.028, .028, .034) + vec3(.01, .012, .02) * (1. - length(vc));
    // a faint pool of light where the drop will land, so it can be seen falling into it
    night += vec3(.016, .017, .022) * exp(-dist * dist / .05);
    float open = 1.;
    if (uIntro.y > 0.) {
      // The dark clears the way ink thins in water: not a circle opening but a slow, lobed
      // front with fine wisps along it, the last of the dark lingering in long tendrils.
      vec2 w = rel * 2.6 + vec2(fbm(rel * 1.7 + 4.2), fbm(rel * 1.7 + 9.6)) * 1.5;
      float lobes = fbm(w + 1.3) - .5;
      float wisps = fbm(rel * 10. + w * .8 + 6.1) - .5;
      float edge = dist + lobes * .5 + wisps * .13;
      open = smoothstep(uIntro.y - .32, uIntro.y + .06, edge);
      // a thinner, inkier dark near the front: it greys a little before it lifts
      night = mix(night, vec3(.075, .074, .085), (1. - open) * .6 * smoothstep(uIntro.y - .32, uIntro.y, edge));
    }
    col = mix(col, night, uIntro.x * open);
  }

  col *= uFade;
  // dither: no banding in the soft grays
  col += (hash12(frag + fract(uTime * 7.)) + hash12(frag.yx + fract(uTime * 5.3) + 17.) - 1.) / 255.;
  gl_FragColor = vec4(clamp(col, 0., 1.), 1.);
}
`;

export const INK_PAPER_UNIFORMS = ["uRes"];

/* The paper, painted once (and again only when the window changes size): warm, with a soft
   mottle, a fine tooth and the odd long fibre; a little brighter at the top, deeper toward the
   corners. */
export const INK_PAPER_FRAG = /* glsl */ `${INK_COMMON}
uniform vec2 uRes;
void main() {
  vec2 frag = gl_FragCoord.xy;
  vec2 uv = frag / uRes;
  float H = uRes.y;
  vec3 paper = vec3(.958, .944, .914);
  vec2 pp = uv * vec2(uRes.x / H, 1.);
  float mottle = fbm(pp * 6. + 3.7) - .5;
  float tooth = (fbm(pp * 260.) - .5) + (hash12(floor(frag)) - .5) * .6;
  vec2 fr = mat2(.8, -.6, .6, .8) * pp;
  float fibre = pow(max(0., 1. - abs(fbm(vec2(fr.x * 3., fr.y * 46.) + 9.1) - .5) * 9.), 6.) * .5
              + pow(max(0., 1. - abs(fbm(vec2(fr.y * 2.6, fr.x * 40.) + 2.3) - .5) * 9.), 6.) * .5;
  paper *= 1. + mottle * .022 + tooth * .016 - fibre * .012;
  paper *= mix(.962, 1.012, smoothstep(-.1, 1.05, uv.y));
  vec2 vc = uv - .5;
  paper *= 1. - .14 * pow(length(vc * vec2(1.05, 1.15)), 2.4);
  gl_FragColor = vec4(paper, 1.);
}
`;

export const INK_COPY_UNIFORMS = ["uSrc", "uRes"];

/* Copies the ink into a texture of a new size (when the window changes), so none of it is lost. */
export const INK_COPY_FRAG = /* glsl */ `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
uniform sampler2D uSrc;
uniform vec2 uRes;
void main() {
  gl_FragColor = texture2D(uSrc, gl_FragCoord.xy / uRes);
}
`;
