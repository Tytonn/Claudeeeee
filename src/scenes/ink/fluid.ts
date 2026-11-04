import { INK_COMMON } from "./shaders";

/**
 * Ink, in real water: a fluid simulation (where the device can run one — else the lighter
 * "fluid-style" ink in shaders.ts).
 *
 * The water has a current of its own that carries itself along and keeps its swirls: it's
 * pushed (by its own slow churn, by drops plunging in, by blooms turning, by ink sinking, by the
 * cursor), its swirls are kept from blurring away (vorticity confinement), and it's kept from
 * piling up or tearing apart (a pressure solve) — so a drop plunging in from the surface rolls
 * up into a mushroom of curling ink, ink sinks and spreads along the bottom, and a stir of the
 * cursor leaves eddies that carry on turning after it's gone.
 *
 * The ink (three of them: charcoal, indigo, and the accent's) rides that current at a finer
 * scale, with a finer churn of its own on top that tears it into tendrils, and each bloom opening
 * out as its ink pours in.
 *
 * Space: x 0..aspect, y 0..1 (screen heights, y up); velocities in screen heights per second.
 */

/** Up to this many drops and blooms under way at once. */
export const FLUID_BLOOMS = 8;

/** A drop plunging in (a bloom's seed carries its kind in its thousands: past 1000 a splash, past 2000 a drop). */
export const KIND_DROP = 2000;

const N = FLUID_BLOOMS;

/** Shared by the passes: where this texel is, and the walls. */
const HEAD = /* glsl */ `${INK_COMMON}
uniform vec2 uRes;      // this pass's size, texels
uniform vec2 uH;        // a texel's size, in screen heights (x, y)
`;

export const FL_FORCE_UNIFORMS = ["uVel", "uDye", "uRes", "uH", "uAspect", "uTime", "uDt", "uBloomA", "uBloomB", "uStir", "uFlow", "uBuoy", "uKick"];

/* The water is pushed: by its own slow churn, by drops plunging in, blooms turning and splashes
   curling, by ink (heavier than water) sinking, and by the cursor dragging it along. */
export const FL_FORCE_FRAG = /* glsl */ `${HEAD}
uniform sampler2D uVel;
uniform sampler2D uDye;
uniform float uAspect;
uniform float uTime;
uniform float uDt;
uniform vec4 uBloomA[${N}]; // xy where, z size, w age (s; < 0: none)
uniform vec4 uBloomB[${N}]; // x how much ink, y its colours, z push, w seed (+1000 a splash, +2000 a drop)
uniform vec4 uStir;         // the cursor: where, and how it's moving (per s)
uniform float uFlow;        // how lively the water's own churn is
uniform float uBuoy;        // how heavily ink sinks
uniform float uKick;        // how hard blooms and splashes turn the water

vec2 vortex(vec2 d, float gamma, float core) {
  return vec2(-d.y, d.x) * gamma / (dot(d, d) + core * core);
}

void main() {
  vec2 uv = gl_FragCoord.xy / uRes;
  vec2 S = vec2(uAspect, 1.);
  vec2 p = uv * S;
  vec2 v = texture2D(uVel, uv).xy;
  float t = uTime;
  // the water's own slow churn: eddies evolving in place, never sliding off or repeating
  vec3 n1 = fnoise(p * 1.25 + vec2(3.1, 7.7), t * .045);
  vec3 n2 = fnoise(p * 2.9 + vec2(11.3, 1.9), t * .08);
  vec2 f = (vec2(n1.z, -n1.y) * .0042 + vec2(n2.z, -n2.y) * .0026) * uFlow;
  // ink is heavier than water: where there's a lot of it, it sinks (the ink around this coarse
  // texel, averaged)
  vec2 e = .25 / uRes;
  vec3 ink = texture2D(uDye, uv + vec2(-e.x, -e.y)).rgb + texture2D(uDye, uv + vec2(e.x, -e.y)).rgb
           + texture2D(uDye, uv + vec2(-e.x, e.y)).rgb + texture2D(uDye, uv + e).rgb;
  f.y -= uBuoy * (ink.r + ink.g + ink.b) * .25;
  for (int i = 0; i < ${N}; i++) {
    vec4 A = uBloomA[i];
    vec4 B = uBloomB[i];
    if (A.w < 0. || A.w > 14.) continue;
    vec2 d = p - A.xy;
    float R = max(A.z, 1e-3);
    float kind = floor(B.w / 1000.);
    float seed = B.w - 1000. * kind;
    if (kind > 1.5) {
      // a drop plunging in from the surface: a jet of momentum, downward (never quite straight),
      // for its first moments — the water rolls it up into a mushroom as it goes
      if (A.w > 5.) continue;
      vec2 q = d / R;
      float env = exp(-A.w / .6) * smoothstep(0., .05, A.w);
      vec2 dir = normalize(vec2(sin(seed * 3.7) * .16, -1.));
      f += dir * B.z * env * exp(-dot(q, q) * 1.3) * 2.;
      continue;
    }
    float r = length(d) / R;
    if (r > 7.) continue;
    float splash = kind;
    // a bloom turns as it opens (one way or the other), winding its ragged edge into spirals
    float spin = (fract(seed * 7.31) < .5 ? -1. : 1.) * (.5 + .5 * fract(seed * 3.17));
    f += vortex(d, spin * .0024 * exp(-A.w / 4.) * (1. - .6 * splash), R * .9) * uKick;
    if (splash > .5 && A.w < 6.) {
      // a drop landing: the ring of ink it throws out breaks into fingers as it runs, each
      // finger's tip rolling over into a cap of curls (whirls turning opposite ways, side by side)
      float ring = R * (.9 + 2.9 * (1. - exp(-A.w / 1.2)));
      float g = .0027 * exp(-A.w / 1.6);
      vec2 lean = vec2(cos(seed * 4.1), sin(seed * 4.1)) * R * .35 * min(A.w, 2.);
      for (int j = 0; j < 12; j++) {
        float fj = float(j);
        float h1 = fract(seed * 5.3 + fj * .37);
        float h2 = fract(seed * 2.9 + fj * .61);
        float aj = seed * 1.7 + fj * .523599 + .42 * sin(seed * 3. + fj * 2.1);
        vec2 at = A.xy + lean + vec2(cos(aj), sin(aj)) * ring * (.66 + .62 * h1);
        float sgn = mod(fj, 2.) < .5 ? 1. : -1.;
        f += vortex(p - at, sgn * g * (.35 + 1.15 * h2 * h2), R * (.17 + .12 * h1)) * uKick;
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
      f += vortex(p - at, sgn * spin * .0011 * exp(-A.w / 3.), R * .45) * uKick;
    }
  }
  // the cursor drags the water along as it passes
  vec2 sd = p - uStir.xy;
  f += uStir.zw * exp(-dot(sd, sd) / (.075 * .075)) * 2.4;
  gl_FragColor = vec4(v + f * uDt, 0., 1.);
}
`;

export const FL_CURL_UNIFORMS = ["uVel", "uRes", "uH"];

/* How the water turns, everywhere (per second). */
export const FL_CURL_FRAG = /* glsl */ `${HEAD}
uniform sampler2D uVel;
void main() {
  vec2 uv = gl_FragCoord.xy / uRes;
  vec2 e = 1. / uRes;
  float L = texture2D(uVel, uv - vec2(e.x, 0.)).y;
  float R = texture2D(uVel, uv + vec2(e.x, 0.)).y;
  float B = texture2D(uVel, uv - vec2(0., e.y)).x;
  float T = texture2D(uVel, uv + vec2(0., e.y)).x;
  gl_FragColor = vec4(.5 * ((R - L) / uH.x - (T - B) / uH.y), 0., 0., 1.);
}
`;

export const FL_VORT_UNIFORMS = ["uVel", "uCurl", "uRes", "uH", "uDt", "uConfine"];

/* Its swirls are kept turning (vorticity confinement): the grid would otherwise blur them away. */
export const FL_VORT_FRAG = /* glsl */ `${HEAD}
uniform sampler2D uVel;
uniform sampler2D uCurl;
uniform float uDt;
uniform float uConfine;
void main() {
  vec2 uv = gl_FragCoord.xy / uRes;
  vec2 e = 1. / uRes;
  float L = abs(texture2D(uCurl, uv - vec2(e.x, 0.)).x);
  float R = abs(texture2D(uCurl, uv + vec2(e.x, 0.)).x);
  float B = abs(texture2D(uCurl, uv - vec2(0., e.y)).x);
  float T = abs(texture2D(uCurl, uv + vec2(0., e.y)).x);
  float C = texture2D(uCurl, uv).x;
  vec2 g = vec2(R - L, T - B);
  vec2 n = g / (length(g) + 1e-5);
  vec2 force = vec2(n.y, -n.x) * C * uConfine * uH.y;
  gl_FragColor = vec4(texture2D(uVel, uv).xy + force * uDt, 0., 1.);
}
`;

export const FL_DIV_UNIFORMS = ["uVel", "uRes", "uH"];

/* Where the water would pile up or tear apart (walls at the screen's edges: none flows out). */
export const FL_DIV_FRAG = /* glsl */ `${HEAD}
uniform sampler2D uVel;
void main() {
  vec2 uv = gl_FragCoord.xy / uRes;
  vec2 e = 1. / uRes;
  vec2 C = texture2D(uVel, uv).xy;
  float L = texture2D(uVel, uv - vec2(e.x, 0.)).x;
  float R = texture2D(uVel, uv + vec2(e.x, 0.)).x;
  float B = texture2D(uVel, uv - vec2(0., e.y)).y;
  float T = texture2D(uVel, uv + vec2(0., e.y)).y;
  if (uv.x - e.x < 0.) L = -C.x;
  if (uv.x + e.x > 1.) R = -C.x;
  if (uv.y - e.y < 0.) B = -C.y;
  if (uv.y + e.y > 1.) T = -C.y;
  gl_FragColor = vec4(.5 * ((R - L) / uH.x + (T - B) / uH.y), 0., 0., 1.);
}
`;

export const FL_PRESSURE_UNIFORMS = ["uPressure", "uDiv", "uRes", "uH", "uKeep"];

/* The pressure that keeps it so (one Jacobi step; uKeep < 1 on the first, to start from what was). */
export const FL_PRESSURE_FRAG = /* glsl */ `${HEAD}
uniform sampler2D uPressure;
uniform sampler2D uDiv;
uniform float uKeep;
void main() {
  vec2 uv = gl_FragCoord.xy / uRes;
  vec2 e = 1. / uRes;
  float L = texture2D(uPressure, uv - vec2(e.x, 0.)).x;
  float R = texture2D(uPressure, uv + vec2(e.x, 0.)).x;
  float B = texture2D(uPressure, uv - vec2(0., e.y)).x;
  float T = texture2D(uPressure, uv + vec2(0., e.y)).x;
  float div = texture2D(uDiv, uv).x;
  gl_FragColor = vec4((L + R + B + T) * .25 * uKeep - div * uH.x * uH.y * .25, 0., 0., 1.);
}
`;

export const FL_GRAD_UNIFORMS = ["uPressure", "uVel", "uRes", "uH"];

/* …taken away from the current: what's left neither piles up nor tears. */
export const FL_GRAD_FRAG = /* glsl */ `${HEAD}
uniform sampler2D uPressure;
uniform sampler2D uVel;
void main() {
  vec2 uv = gl_FragCoord.xy / uRes;
  vec2 e = 1. / uRes;
  float L = texture2D(uPressure, uv - vec2(e.x, 0.)).x;
  float R = texture2D(uPressure, uv + vec2(e.x, 0.)).x;
  float B = texture2D(uPressure, uv - vec2(0., e.y)).x;
  float T = texture2D(uPressure, uv + vec2(0., e.y)).x;
  vec2 v = texture2D(uVel, uv).xy - .5 * vec2((R - L) / uH.x, (T - B) / uH.y);
  gl_FragColor = vec4(v, 0., 1.);
}
`;

export const FL_ADVECT_UNIFORMS = ["uVel", "uRes", "uH", "uAspect", "uDt", "uDrag"];

/* The current carries itself along (and slowly gives up its motion: water is a little viscous). */
export const FL_ADVECT_FRAG = /* glsl */ `${HEAD}
uniform sampler2D uVel;
uniform float uAspect;
uniform float uDt;
uniform float uDrag;
void main() {
  vec2 uv = gl_FragCoord.xy / uRes;
  vec2 S = vec2(uAspect, 1.);
  vec2 v = texture2D(uVel, uv).xy;
  vec2 mid = uv - v * uDt * .5 / S;
  vec2 from = uv - texture2D(uVel, mid).xy * uDt / S;
  vec2 nv = texture2D(uVel, from).xy * exp(-uDrag * uDt);
  // (nothing flows through the walls)
  vec2 e = 1. / uRes;
  if (uv.x < e.x || uv.x > 1. - e.x) nv.x *= .2;
  if (uv.y < e.y || uv.y > 1. - e.y) nv.y *= .2;
  gl_FragColor = vec4(nv, 0., 1.);
}
`;

export const FL_DYE_UNIFORMS = ["uDye", "uVel", "uRes", "uH", "uAspect", "uTime", "uDt", "uBloomA", "uBloomB", "uPanel", "uClear", "uFlow", "uFade", "uSoften"];

/* The ink: carried by the current (and a finer churn the coarse current can't hold, and each
   bloom opening out as its ink pours in), new ink pouring in, and old ink slowly giving itself
   to the water. r charcoal, g indigo, b the accent's. */
export const FL_DYE_FRAG = /* glsl */ `${HEAD}
uniform sampler2D uDye;
uniform sampler2D uVel;
uniform float uAspect;
uniform float uTime;
uniform float uDt;
uniform vec4 uBloomA[${N}];
uniform vec4 uBloomB[${N}];
uniform vec4 uPanel;   // the words' column, kept a little clearer (x0, y0, x1, y1)
uniform float uClear;
uniform float uFlow;
uniform float uFade;   // how quickly ink gives itself to the water (per s)
uniform float uSoften; // how quickly it diffuses (its edges softening as it ages; per s)

const float MAXD = 4.;

vec4 tex(vec2 uv) {
  return texture2D(uDye, uv);
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
  vec2 b = (c + .5) / uRes;
  vec2 e = 1. / uRes;
  vec4 a0 = tex(b);
  vec4 a1 = tex(b + vec2(e.x, 0.));
  vec4 a2 = tex(b + vec2(0., e.y));
  vec4 a3 = tex(b + e);
  return clamp(r, min(min(a0, a1), min(a2, a3)), max(max(a0, a1), max(a2, a3)));
}

float panelMask(vec2 p) {
  vec2 c = (uPanel.xy + uPanel.zw) * .5;
  vec2 h = max((uPanel.zw - uPanel.xy) * .5, vec2(.001));
  vec2 q = abs(p - c) - h;
  float d = length(max(q, 0.)) + min(max(q.x, q.y), 0.);
  return 1. - smoothstep(-.04, .08, d);
}

/* Its colours: [0, 1] how much is indigo (the rest charcoal); [2, 3] how much is the accent's. */
vec3 colours(float c) {
  float acc = step(1.5, c);
  float s = clamp(c - 2. * acc, 0., 1.);
  return acc > .5 ? vec3(1. - s, 0., s) : vec3(1. - s, s, 0.);
}

/* What moves the ink besides the water's current: the finer churn (tearing it into tendrils,
   all the more near young ink) and each bloom opening out. */
vec2 extra(vec2 p) {
  float t = uTime;
  vec3 n3 = fnoise(p * 6.6 + vec2(5.9, 13.1), t * .16);
  vec3 n4 = fnoise(p * 14.3 + vec2(1.3, 4.1), t * .27);
  vec2 v = (vec2(n3.z, -n3.y) * .0046 + vec2(n4.z, -n4.y) * .0018) * uFlow;
  float young = 0.;
  for (int i = 0; i < ${N}; i++) {
    vec4 A = uBloomA[i];
    vec4 B = uBloomB[i];
    if (A.w < 0. || A.w > 14.) continue;
    vec2 d = p - A.xy;
    float R = max(A.z, 1e-3);
    float r = length(d) / R;
    float kind = floor(B.w / 1000.);
    if (kind > 1.5) {
      // (a drop's ink is torn finely along its curling cap)
      young += exp(-A.w / 5.) * .6;
      continue;
    }
    if (r > 7.) continue;
    young += exp(-A.w / 3.5) * exp(-r * r * .18) * (1. + kind);
    // it opens out (hard at first, then easing off), most strongly just inside its edge — a
    // drop's splash further and faster
    float push = B.z * exp(-A.w / mix(1.5, 1.05, kind)) * r * exp(-r * r * mix(.55, .3, kind));
    v += d / max(length(d), 1e-4) * push;
  }
  if (young > .01) {
    vec3 n5 = fnoise(p * 22.7 + vec2(7.7, 2.2), t * .45);
    v += vec2(n5.z, -n5.y) * .0026 * min(young, 1.5) * uFlow;
  }
  return v;
}

void main() {
  vec2 uv = gl_FragCoord.xy / uRes;
  vec2 S = vec2(uAspect, 1.);
  vec2 p = uv * S;
  // carried along: where this ink was a moment ago (two half-steps, for curved paths; the finer
  // churn barely changes over half a step, so it's worked out once)
  vec2 ex = extra(p);
  vec2 v1 = texture2D(uVel, uv).xy + ex;
  vec2 mid = p - v1 * uDt * .5;
  vec2 v2 = texture2D(uVel, mid / S).xy + ex;
  vec2 from = (p - v2 * uDt) / S;
  vec4 d = cubic(from);
  // and it diffuses a little, so its edges soften as it ages (new ink stays crisp)
  vec2 tx = 1. / uRes;
  vec3 around = (tex(from + vec2(tx.x, 0.)).rgb + tex(from - vec2(tx.x, 0.)).rgb + tex(from + vec2(0., tx.y)).rgb + tex(from - vec2(0., tx.y)).rgb) * .25;
  d.rgb = mix(d.rgb, around, clamp(uSoften * uDt, 0., 1.));

  for (int i = 0; i < ${N}; i++) {
    vec4 A = uBloomA[i];
    vec4 B = uBloomB[i];
    if (A.w < 0. || A.w > 1.6) continue;
    vec2 q = (p - A.xy) / max(A.z, 1e-3);
    float r2 = dot(q, q);
    if (r2 > 9.) continue;
    float kind = floor(B.w / 1000.);
    float seed = B.w - 1000. * kind;
    vec3 ink = colours(B.y);
    if (kind > 1.5) {
      // a drop: its ink pours in where it plunges, and the jet carries it down
      float rate = smoothstep(0., .04, A.w) * (1. - smoothstep(.3, 1., A.w));
      float rag = fbm(q * 2.6 + seed * 13.7);
      d.rgb += ink * B.x * rate * exp(-r2 * 1.5) * (.55 + .9 * rag) * 4.5 * uDt;
      continue;
    }
    float splash = kind;
    // a bloom: its ink enters near the middle (in ragged lobes) and its own push opens it out
    float rate = mix(smoothstep(0., .15, A.w) * (1. - smoothstep(.45, 1.3, A.w)), 2.2 * (1. - smoothstep(.12, .5, A.w)), splash);
    float r = sqrt(r2);
    float ang = atan(q.y, q.x);
    float lobes = fbm(vec2(cos(ang), sin(ang)) * 1.9 + seed * 7.9);
    float reach = .42 + .38 * lobes;
    float rr = r / reach;
    float core = exp(-rr * rr * 2.2);
    float ringAt = .72 + .3 * (lobes - .5);
    float ru = (r - ringAt) / .2;
    if (splash > .5) core = exp(-ru * ru) + .22 * core;
    float rag = fbm(q * 3.4 + seed * 13.7);
    d.rgb += ink * B.x * rate * core * (.45 + 1.1 * smoothstep(.3, .7, rag)) * 1.35 * uDt;
  }

  // ink slowly gives itself to the water (a little sooner behind the words); thin ink first,
  // so what's left breaks into wisps as it goes
  float pm = panelMask(p);
  // (and once it has sunk to the bottom it dissolves there, rather than piling up)
  float floorK = 1. - smoothstep(.015, .22, p.y);
  d.rgb *= exp(-(uFade + .2 * pm * uClear + .06 * floorK) * uDt);
  d.rgb = max(d.rgb - (.0008 + .012 * pm * uClear) * uDt, 0.);
  vec2 e = min(uv, 1. - uv);
  d.rgb *= mix(.985, 1., smoothstep(0., .01, min(e.x, e.y)));
  gl_FragColor = vec4(clamp(d.rgb, 0., MAXD), 1.);
}
`;

export const FL_MIX_UNIFORMS = ["uA", "uB", "uMix", "uRes"];

/* The ink as it is this frame: between the simulation's last two steps. */
export const FL_MIX_FRAG = /* glsl */ `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
uniform sampler2D uA;
uniform sampler2D uB;
uniform float uMix;
uniform vec2 uRes;
void main() {
  vec2 uv = gl_FragCoord.xy / uRes;
  gl_FragColor = vec4(max(mix(texture2D(uA, uv).rgb, texture2D(uB, uv).rgb, clamp(uMix, 0., 1.)), 0.), 1.);
}
`;

export const FL_BLUR_UNIFORMS = ["uSrc", "uRes", "uDir"];

/* The ink, softly blurred (one direction at a time, at a low resolution): how it looks through
   frosted paper, and the shape its shadows and light follow. (Read from a smaller target, the
   ink's mipmaps give an even average to start from: nothing blocky, nothing flickering.) */
export const FL_BLUR_FRAG = /* glsl */ `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
uniform sampler2D uSrc;
uniform vec2 uRes;
uniform vec2 uDir;  // a step along the blur, in this target's texels
void main() {
  vec2 uv = gl_FragCoord.xy / uRes;
  vec2 d = uDir / uRes;
  vec3 c = texture2D(uSrc, uv).rgb * .2270270270;
  c += (texture2D(uSrc, uv + d * 1.3846153846).rgb + texture2D(uSrc, uv - d * 1.3846153846).rgb) * .3162162162;
  c += (texture2D(uSrc, uv + d * 3.2307692308).rgb + texture2D(uSrc, uv - d * 3.2307692308).rgb) * .0702702703;
  gl_FragColor = vec4(c, 1.);
}
`;

export const FL_VIEW_UNIFORMS = [
  "uInk",
  "uBlur",
  "uPaper",
  "uRes",
  "uTime",
  "uPanel",
  "uPanelR",
  "uColumn",
  "uBehind",
  "uRipple0",
  "uRipple1",
  "uRipple2",
  "uIntro",
  "uDrop",
  "uFade",
  "uA",
  "uLight",
  "uPaperK",
  "uCausticK",
];

/*
 * The picture: the paper at the back of the water, light from the surface playing over it; the
 * ink in front of it, in billows lit from above, each casting a soft shadow on the paper behind;
 * and where your words are, the ink seen through a frosted sheet, so they read clearly. Then the
 * ripples of a drop, and the arrival.
 */
export const FL_VIEW_FRAG = /* glsl */ `${INK_COMMON}
uniform sampler2D uInk;   // the ink now: r charcoal, g indigo, b the accent's
uniform sampler2D uBlur;  // …and softly blurred (as seen through frosted paper; for its shadows and light)
uniform sampler2D uPaper; // the paper, painted once
uniform vec2 uRes;        // this canvas, px
uniform float uTime;
uniform vec4 uPanel;      // the note: x0, y0, x1, y1, px (y up)
uniform float uPanelR;
uniform vec4 uColumn;     // the words: x0, y0, x1, y1, px (y up)
uniform float uBehind;    // how much ink shows behind the words (1: all of it, as a drop arrives)
uniform vec4 uRipple0;
uniform vec4 uRipple1;
uniform vec4 uRipple2;
uniform vec4 uIntro;      // darkness, how far the paper has opened (screen heights), the drop falling 0..1, the flash of its landing
uniform vec2 uDrop;       // where the drop lands, px
uniform float uFade;
uniform vec3 uA;          // the accent: the third ink's colour
uniform float uLight;     // how much light from the surface plays on the paper
uniform float uPaperK;    // how deep the paper is (1: as painted)
uniform float uCausticK;  // how brightly that light shows on it

vec3 inkAt(vec2 uv) {
  return max(texture2D(uInk, uv).rgb, 0.);
}
float softAt(vec2 uv) {
  vec3 b = max(texture2D(uBlur, uv).rgb, 0.);
  return b.r + b.g + b.b;
}

float roundedBox(vec2 p, vec2 c, vec2 h, float r) {
  vec2 q = abs(p - c) - h + r;
  return length(max(q, 0.)) + min(max(q.x, q.y), 0.) - r;
}

vec2 ripple(vec4 R, vec2 frag, float H, inout float shade) {
  if (R.w <= 0.) return vec2(0.);
  float rr = R.z * H * .55;
  vec2 d = frag - R.xy;
  float dist = length(d);
  float w = H * (.03 + R.z * .05);
  float x = (dist - rr) / w;
  float env = exp(-x * x) * R.w * exp(-R.z * 1.5) * smoothstep(0., .08, R.z);
  float wave = sin(x * 2.3) * env;
  shade += wave * .02;
  return d / max(dist, 1.) * wave * H * .0055;
}

/* Light from the water's surface, gathered into a slowly shifting net on the paper behind. */
float caustics(vec2 p, float t) {
  vec2 q = mod(p * 6.2831853, 6.2831853) - 250.;
  vec2 i = q;
  float c = 1.;
  for (int n = 0; n < 4; n++) {
    float tt = t * (1. - 3.5 / float(n + 1));
    i = q + vec2(cos(tt - i.x) + sin(tt + i.y), sin(tt - i.y) + cos(tt + i.x));
    c += 1. / length(vec2(q.x / (sin(i.x + tt) / .005), q.y / (cos(i.y + tt) / .005)));
  }
  c /= 4.;
  c = 1.17 - pow(c, 1.4);
  return pow(abs(c), 3.);
}

/* How strongly the words keep the ink at a distance: 1 in their column (soft at its sides), and
   a little along the note's top, where its tools are. */
float words(vec2 frag, float H) {
  float m = 0.;
  if (uColumn.z > uColumn.x) {
    float soft = H * .07;
    float dx = max(uColumn.x - frag.x, frag.x - uColumn.z);
    float dy = max(uColumn.y - frag.y, frag.y - uColumn.w);
    m = 1. - smoothstep(-soft * .35, soft, max(dx, dy));
  }
  if (uPanel.z > uPanel.x) {
    float top = H * .06;
    float inX = smoothstep(uPanel.x - 4., uPanel.x + 12., frag.x) * (1. - smoothstep(uPanel.z - 12., uPanel.z + 4., frag.x));
    float band = smoothstep(uPanel.w - top * 1.6, uPanel.w - top * .6, frag.y) * (1. - smoothstep(uPanel.w, uPanel.w + 6., frag.y));
    m = max(m, band * inX * .7);
  }
  return m;
}

void main() {
  vec2 frag = gl_FragCoord.xy;
  vec2 uv = frag / uRes;
  float H = uRes.y;
  float aspect = uRes.x / uRes.y;

  float shade = 0.;
  vec2 off = ripple(uRipple0, frag, H, shade) + ripple(uRipple1, frag, H, shade) + ripple(uRipple2, frag, H, shade);
  vec2 iuv = uv + off / uRes;

  // behind the words, the ink is seen through a frosted sheet: softer, and fainter
  float wm = words(frag, H) * (1. - uBehind);
  vec3 k = inkAt(iuv);
  if (wm > .001) k = mix(k, max(texture2D(uBlur, iuv).rgb, 0.), min(1., wm * 1.2));
  float D = k.r + k.g + k.b;

  // the billows' shape, for the light (read from the soft ink)
  vec2 hs = vec2(H * .009) / uRes;
  float dl = softAt(iuv - vec2(hs.x, 0.));
  float dr = softAt(iuv + vec2(hs.x, 0.));
  float db = softAt(iuv - vec2(0., hs.y));
  float dt = softAt(iuv + vec2(0., hs.y));
  vec2 g = vec2(dr - dl, dt - db);
  vec2 L = normalize(vec2(-.38, 1.));
  float lit = dot(g, L) / (length(g) + .12);
  // ink above this point (toward the light) shades it: the billows' undersides are deeper
  float above = softAt(iuv + vec2(-.38, 1.) * H * .011 / uRes);
  float self = smoothstep(.1, 2.2, above - D * .6);

  // the paper at the back of the water, and light from the surface playing over it
  // (a shade deeper than the lighter ink's paper, so the light from the surface shows on it)
  vec3 paper = texture2D(uPaper, uv).rgb * uPaperK + shade;
  vec2 cp = vec2(uv.x * aspect, uv.y) * 1.9 + vec2(.13 * sin(uTime * .021), .1 * uTime * .006);
  float cz = caustics(cp, uTime * .27 + 23.);
  float cz2 = caustics(cp * 1.7 + 3.7, uTime * .32 + 7.);
  // (it falls off with depth: brightest near the surface)
  float depth = mix(.55, 1., smoothstep(.05, .95, uv.y));
  // the ink's shadow on the paper: the light comes from above, so it falls a little below
  float sh = 1. - exp(-softAt(iuv + vec2(.25, -1.) * H * .02 / uRes) * .3);
  float light = (cz * .8 + cz2 * .45) * depth * uLight * (1. - sh) * (1. - .4 * wm);
  // (where the light gathers, the paper is lit to white)
  paper = mix(paper, vec3(1., .994, .982), clamp(light * uCausticK, 0., 1.));
  paper *= 1. - .17 * sh * (1. - .75 * wm);

  // the ink: charcoal and indigo soak the light out of it; the accent's takes its colour
  k *= mix(1., .3, wm);
  vec3 sigC = vec3(1.02, 1.0, .95);
  vec3 sigI = vec3(2.05, 1.62, .82);
  vec3 a = clamp(uA, .02, 1.);
  vec3 sigA = (1. - a) * 1.55 + .1;
  vec3 sig = k.r * sigC + k.g * sigI + k.b * sigA;
  float body = smoothstep(.04, .8, D);
  // lit from above: a touch lighter toward the light, deeper underneath
  float deep = smoothstep(.4, 1.6, D);
  sig *= 1. - .06 * lit * deep;
  sig *= 1. + .16 * self * body * (1. - wm);
  vec3 T = exp(-sig * .95);
  // where it's dense, a deep, faintly blue black
  vec3 floorC = vec3(.045, .046, .062);
  vec3 col = paper * T + floorC * (1. - T) * (1. - T.g);

  // the arrival: the dark, a single drop falling through it, and the paper opening from where it lands
  vec2 vc = uv - .5;
  if (uIntro.x > 0.) {
    vec2 rel = (frag - uDrop) / H;
    float dist = length(rel);
    vec3 night = vec3(.028, .028, .034) + vec3(.01, .012, .02) * (1. - length(vc));
    night += vec3(.016, .017, .022) * exp(-dist * dist / .05);
    float open = 1.;
    if (uIntro.y > 0.) {
      vec2 w = rel * 2.6 + vec2(fbm(rel * 1.7 + 4.2), fbm(rel * 1.7 + 9.6)) * 1.5;
      float lobes = fbm(w + 1.3) - .5;
      float wisps = fbm(rel * 10. + w * .8 + 6.1) - .5;
      float edge = dist + lobes * .5 + wisps * .13;
      open = smoothstep(uIntro.y - .32, uIntro.y + .06, edge);
      night = mix(night, vec3(.075, .074, .085), (1. - open) * .6 * smoothstep(uIntro.y - .32, uIntro.y, edge));
    }
    col = mix(col, night, uIntro.x * open);
    float ringR = (1. - uIntro.w) * .5 * H + H * .02;
    float ru = (dist * H - ringR) / (H * .018);
    float ring = exp(-ru * ru) * uIntro.w;
    col += vec3(.7, .7, .76) * ring * .13 * uIntro.x * open;
    col += vec3(.62, .63, .7) * exp(-dist * dist / .0009) * uIntro.w * uIntro.w * .35 * uIntro.x;
    if (uIntro.z > 0. && uIntro.z < 1.) {
      float z = uIntro.z;
      float y = mix(H * 1.08, uDrop.y, z * z);
      vec2 q = frag - vec2(uDrop.x, y);
      float stretch = 1. + 1.5 * z * z;
      float rad = H * .0135;
      q.y /= stretch;
      q.y += (q.y > 0. ? q.y * .55 : 0.);
      float s = length(q) / rad;
      float bead = 1. - smoothstep(.85, 1.05, s);
      vec2 lp = q / rad - vec2(-.32, .38);
      float spec = exp(-dot(lp, lp) * 9.) * .9;
      float rim = smoothstep(.62, 1.0, s) * bead * .35;
      vec3 c = vec3(.012, .012, .02) + vec3(.55, .56, .66) * rim + vec3(1.) * spec;
      col = mix(col, c, bead);
      col += vec3(.5, .52, .6) * exp(-s * 1.6) * .05;
    }
  }

  col *= uFade;
  col += (hash12(frag + fract(uTime * 7.)) + hash12(frag.yx + fract(uTime * 5.3) + 17.) - 1.) / 255.;
  gl_FragColor = vec4(clamp(col, 0., 1.), 1.);
}
`;

export const FL_COPY_UNIFORMS = ["uSrc", "uRes"];

/* Copies one texture into another of a new size (the ink, when the window changes). */
export const FL_COPY_FRAG = /* glsl */ `
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
