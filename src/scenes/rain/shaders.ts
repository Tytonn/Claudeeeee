/**
 * Rain: a night city seen through a rain-streaked window.
 *
 * Two passes. The first paints the world outside — out of focus, as if your eyes were on
 * the glass: bokeh from windows, streetlamps, signs and traffic, wet reflections, mist and
 * lightning in the clouds. It changes slowly, so it's drawn at about screen resolution into
 * a mipmapped texture, at most 30 times a second.
 *
 * The second pass is the glass, at full resolution, every frame. Rain falls past outside in
 * fine, sharp streaks that catch the light behind them. Beads of rain stick to the pane and
 * come and go; now and then a drop gathers, breaks free and runs down in fits and starts,
 * leaving a clear, beaded trail. Every drop is a tiny lens: it shows the city upside down,
 * sharp and small. A light veil of mist hangs on the glass and the lights bloom softly
 * through it. Your cursor is a warm light near the glass — drops glint as it passes — and
 * lightning lights them all at once.
 */

const NOISE = /* glsl */ `
float hash11(float p) {
  p = fract(p * .1031);
  p *= p + 33.33;
  p *= p + p;
  return fract(p);
}
float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * .1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3. - 2. * f);
  float a = hash12(i);
  float b = hash12(i + vec2(1., 0.));
  float c = hash12(i + vec2(0., 1.));
  float d = hash12(i + vec2(1., 1.));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
/** Smooth 1D noise (wandering paths). */
float noise1(float x) {
  float i = floor(x);
  float f = fract(x);
  return mix(hash11(i), hash11(i + 1.), f * f * (3. - 2. * f));
}
/** Straight-segment 1D noise (jagged lightning). */
float lnoise(float x) {
  float i = floor(x);
  return mix(hash11(i), hash11(i + 1.), fract(x));
}
float fbm(vec2 p) {
  float v = 0.;
  float a = .5;
  mat2 r = mat2(.8, .6, -.6, .8);
  for (int i = 0; i < 4; i++) {
    v += a * vnoise(p);
    p = r * p * 2.03 + 11.7;
    a *= .5;
  }
  return v;
}
`;

/* ── pass 1: the city outside ─────────────────────────────────────────────── */

const SCENE = /* glsl */ `
uniform vec2 uRes;       // target size, texels
uniform float uAspect;   // screen width / height
uniform float uTime;
uniform vec3 uA;         // accent: one of the neon signs is yours
uniform float uCity;     // city lights 0..1
uniform float uAmount;   // how hard it's raining 0..1
uniform float uWet;      // 0 → 1 as the rain sets in
uniform vec4 uFlash;     // lightning: brightness, bolt x (layout units), seed, bolt visibility
uniform float uWind;     // rain slant (x per y)
uniform float uDim;
uniform float uQuality;
uniform float uBlur;     // how out of focus the city is, 0..1

${NOISE}

vec3 cityColor(float h) {
  if (h < .26) return vec3(1., .76, .5);    // warm windows
  if (h < .44) return vec3(1., .55, .22);   // sodium lamps
  if (h < .62) return vec3(.72, .83, 1.);   // cold LED
  if (h < .72) return vec3(.12, .8, .95);   // teal neon
  if (h < .8) return vec3(.95, .3, .72);    // magenta neon
  if (h < .89) return uA * 1.1;             // your accent, in neon
  if (h < .96) return vec3(1., .16, .12);   // red signals
  return vec3(.28, 1., .55);                // green signals
}

/* Out-of-focus lights on a jittered grid. Bigger cells read as nearer: bigger, softer,
   fewer. Each light is a disc of light with a brighter rim and a faint colour fringe,
   the way real bokeh looks. */
vec3 bokeh(vec2 p, float cell, float rMin, float rMax, float dens, float seed, float lo, float hi, float gain, float softK) {
  vec3 acc = vec3(0.);
  vec2 id0 = floor(p / cell);
  for (int j = -1; j <= 1; j++) {
    for (int i = -1; i <= 1; i++) {
      vec2 id = id0 + vec2(float(i), float(j));
      float h = hash12(id + seed);
      vec2 c = (id + .15 + .7 * vec2(hash12(id + seed + 3.1), hash12(id + seed + 5.9))) * cell;
      float band = smoothstep(lo - .08, lo + .06, c.y) * (1. - smoothstep(hi - .16, hi + .1, c.y));
      if (h > dens * band) continue;
      // Defocus: each light spreads into a bigger, softer disc, dimmer as its light spreads out.
      float r = mix(rMin, rMax, hash12(id + seed + 8.2)) * (1. + uBlur * .35);
      float d = length(p - c);
      if (d > r * 1.5) continue;
      float hue = hash12(id + seed + 17.3);
      vec3 col = cityColor(hue);
      float kind = hash12(id + seed + 23.1);
      float bright = mix(.28, 1., pow(hash12(id + seed + 11.7), 2.2)) / (1. + uBlur * .42);
      // Neon buzzes and stutters now and then; windows go dark and light up again, slowly.
      if (hue > .69 && hue < .91) bright *= .55 + .45 * step(.16, vnoise(vec2(uTime * 7. + kind * 40., kind * 9.)));
      bright *= .5 + .5 * smoothstep(.22, .5, vnoise(vec2(uTime * .045 + kind * 31., kind * 5.)));
      float soft = r * (softK + uBlur * .8) + .0009;
      vec3 rr = r * vec3(1.03, 1., .97);
      vec3 disc = smoothstep(rr + soft * .5, rr - soft, vec3(d));
      float rim = smoothstep(r * .4, r, d) * disc.g * (1. - uBlur * .75);
      // fine grain inside the disc, like dust on a lens
      disc *= .9 + .1 * vnoise((p - c) / r * 3. + id);
      float halo = exp(-max(d - r, 0.) / (r * (.3 + uBlur * .3))) * (1. - disc.g) * smoothstep(r * 1.5, r * 1.1, d);
      acc += col * bright * gain * (disc * .5 + rim * .4 + halo * .14);
    }
  }
  return acc;
}

/* Rooftops: blocks of random width and height (overlapping rows read as a skyline). */
float roofs(float x, float w, float hMin, float hMax, float seed) {
  float id = floor(x / w);
  float h = hash11(id * 1.37 + seed);
  float top = mix(hMin, hMax, h);
  float tower = step(.86, hash11(id * 3.11 + seed));
  return top + tower * mix(.08, .2, hash11(id * 7.7 + seed));
}

/* Traffic on the wet street: headlights one way, tail-lights the other — and their
   reflections smeared down the road. */
vec3 traffic(vec2 p) {
  vec3 acc = vec3(0.);
  for (int lane = 0; lane < 2; lane++) {
    float fl = float(lane);
    float ly = .2 - fl * .028;
    float dir = 1. - 2. * fl;
    float x = p.x - dir * uTime * (.055 - fl * .017);
    float cell = .32;
    float id0 = floor(x / cell);
    vec3 c = fl < .5 ? vec3(1., .86, .66) : vec3(1., .13, .1);
    for (int k = -1; k <= 1; k++) {
      float id = id0 + float(k);
      if (hash11(id * 1.71 + fl * 13.) > .5) continue;
      float cx = (id + .2 + .6 * hash11(id * 2.93 + fl * 7.)) * cell;
      float r = .015;
      for (int s = 0; s < 2; s++) {
        vec2 dv = vec2(x, p.y) - vec2(cx + (float(s) - .5) * .026, ly);
        float d = length(dv);
        acc += c * (smoothstep(r * (1. + uBlur * .5), r * max(.1, .7 - uBlur * .55), d) * .5 / (1. + uBlur * .6) + exp(-d / (r * (1.4 + uBlur))) * .09) * (.95 - fl * .2);
        if (dv.y < 0.) {
          float wob = sin(p.y * 260. + uTime * 4. + id) * .0018;
          float dr = length(vec2((dv.x + wob) * 1.5, (dv.y + .01) * .2));
          acc += c * smoothstep(r * 1.2, r * .2, dr) * .17 * exp(dv.y * 8.);
        }
      }
    }
  }
  return acc;
}

/* Streetlamps along the far pavement. Returns their light; \`cone\` says how much lamplight
   the air is full of here (rain falling through it shows up). */
vec3 lamps(vec2 p, out float cone) {
  vec3 acc = vec3(0.);
  cone = 0.;
  float sp = .52;
  float x = p.x + .17;
  float id0 = floor(x / sp);
  for (int k = -1; k <= 1; k++) {
    float id = id0 + float(k);
    vec2 c = vec2((id + .5) * sp - .17 + (hash11(id * 3.1) - .5) * .16, .3 + hash11(id * 5.7) * .045);
    vec3 lc = hash11(id * 7.3) < .72 ? vec3(1., .58, .24) : vec3(.84, .9, 1.);
    float d = length(p - c);
    float r = .024;
    acc += lc * (smoothstep(r * (1. + uBlur * .5), r * max(.1, .72 - uBlur * .55), d) * .55 / (1. + uBlur * .6) + exp(-d / (.045 + uBlur * .02)) * .16 + exp(-d / .16) * .05);
    // the pool of light under it, on the wet pavement
    vec2 pd = (p - vec2(c.x, .12)) * vec2(1., 4.);
    acc += lc * exp(-dot(pd, pd) / .012) * .05;
    // the cone of light spreading down from it
    float below = max(c.y - p.y, 0.);
    float under = smoothstep(c.y + .05, c.y - .02, p.y) * exp(-abs(p.x - c.x) / (.05 + below * .35));
    cone += exp(-d / .1) * .9 + under * .5;
  }
  return acc;
}

/* A lightning bolt: a jagged main channel from the clouds down behind the rooftops,
   with a few forks. */
float boltX(float y, float x0, float seed) {
  float x = x0;
  float a = .075;
  float f = 3.5;
  for (int i = 0; i < 5; i++) {
    x += a * (lnoise(y * f + seed * 17.3 + float(i) * 7.1) * 2. - 1.);
    a *= .5;
    f *= 2.35;
  }
  return x;
}
float bolt(vec2 p, float seed, float x0) {
  float bottom = .3 + hash11(seed * 1.3) * .12;
  if (p.y < bottom - .03) return 0.;
  float d = abs(p.x - boltX(p.y, x0, seed));
  float bw = 1. + uBlur * 8.;
  float b = exp(-d * d / (.000014 * bw)) + exp(-d / (.018 * (1. + uBlur))) * .3 + exp(-d / .08) * .1;
  b *= smoothstep(bottom - .03, bottom + .05, p.y);
  for (int k = 0; k < 3; k++) {
    float fk = float(k);
    float y0 = mix(.52, .9, hash11(seed + fk * 3.3));
    float len = mix(.07, .2, hash11(seed + fk * 5.1));
    if (p.y > y0 || p.y < y0 - len) continue;
    float side = hash11(seed + fk * 9.7) < .5 ? -1. : 1.;
    float xb = boltX(y0, x0, seed) + side * (y0 - p.y) * mix(.35, 1.1, hash11(seed + fk * 2.3));
    xb += (lnoise(p.y * 38. + seed * 3. + fk * 11.) - .5) * .022 + (lnoise(p.y * 120. + fk * 5. + seed) - .5) * .006;
    float db = abs(p.x - xb);
    float along = 1. - (y0 - p.y) / len;
    b += (exp(-db * db / .000007) + exp(-db / .014) * .22) * along * .65;
  }
  return b;
}

void main() {
  vec2 uv = gl_FragCoord.xy / uRes;
  vec2 p = vec2(uv.x * uAspect, uv.y);
  float t = uTime;
  float flash = uFlash.x;
  float hz = .4;

  // Sky: stormy and low, glowing from beneath with the city's light.
  vec3 col = mix(vec3(.026, .032, .048), vec3(.008, .01, .018), smoothstep(.25, 1., uv.y));
  float glowY = exp(-max(uv.y - hz + .1, 0.) * 3.6);
  vec3 haze = vec3(.072, .046, .052) * uCity + vec3(.012, .017, .026);
  col += haze * glowY;
  vec2 cp = vec2(p.x * .55 + t * .006, p.y * 1.3 - t * .0015);
  float warp = fbm(cp * 1.3 + vec2(0., t * .008));
  float cl = fbm(cp * 2.5 + warp * 1.25);
  float clouds = smoothstep(.34, .84, cl) * smoothstep(hz - .05, hz + .3, uv.y);
  float under = exp(-max(uv.y - hz, 0.) * 2.2);
  col += clouds * (haze * (.35 + under * 1.3) + vec3(.012, .014, .022));
  // Lightning lights the clouds from inside, brightest around the strike.
  float nearBolt = exp(-abs(p.x - uFlash.y) * 1.5);
  col += flash * vec3(.48, .54, .86) * (.06 + clouds * (.35 + .95 * nearBolt) + .12 * nearBolt) * smoothstep(hz - .15, hz + .25, uv.y);
  if (uFlash.w > .01) col += vec3(.82, .86, 1.) * bolt(p, uFlash.z, uFlash.y) * uFlash.w * 1.8 / (1. + uBlur * 1.5);

  // The skyline, softly out of focus: a far row of blocks, then a nearer, taller one —
  // lit a little from below by the street.
  float farTop = max(roofs(p.x, .11, hz - .02, hz + .1, 3.7), roofs(p.x + .05, .07, hz - .04, hz + .07, 5.3));
  float nearTop = max(roofs(p.x + 3., .17, hz + .03, hz + .3, 9.1), roofs(p.x + 1.3, .11, hz - .02, hz + .16, 12.7));
  float eb = uBlur * .05;
  float mFar = smoothstep(farTop + .016 + eb, farTop - .016 - eb, uv.y);
  float mNear = smoothstep(nearTop + .013 + eb, nearTop - .013 - eb, uv.y);
  float street = smoothstep(.55, .1, uv.y);
  col = mix(col, vec3(.022, .025, .034) + haze * (.25 + street * .5) + flash * vec3(.04, .045, .07), mFar * .8);
  col = mix(col, vec3(.011, .012, .017) + haze * street * .55 + flash * vec3(.014, .016, .024), mNear * .82);

  // Mist hanging in the street.
  float mist = fbm(vec2(p.x * 1.1 - t * .012, p.y * 3.2 + t * .004));
  col += (haze * 1.4 + vec3(.012)) * mist * smoothstep(.7, .12, uv.y) * .6;

  // The lights.
  float cone = 0.;
  vec3 lights = vec3(0.);
  if (uCity > .001) {
    // Windows, only where there are buildings to hold them.
    lights += bokeh(p, .03, .0055, .0105, .46, 1., .16, .8, .5, .2) * max(mFar * .55, mNear);
    lights += bokeh(p + vec2(t * .0012, 0.), .075, .015, .03, .4, 7., .1, .66, .85, .08);
    if (uQuality > .5) lights += bokeh(p - vec2(t * .0025, 0.), .19, .045, .088, .32, 13., .02, .72, .5, .1);
    lights += traffic(p);
    lights += lamps(p, cone);
    // Red warning lights on the tallest towers, blinking slowly.
    float tid = floor((p.x + 3.) / .16);
    if (step(.88, hash11(tid * 3.11 + 9.1)) > 0.) {
      vec2 tc = vec2((tid + .5) * .16 - 3., nearTop + .012);
      float on = smoothstep(.15, .05, abs(fract(t * .55 + hash11(tid)) - .1));
      float d = length(p - tc);
      lights += vec3(1., .14, .1) * (smoothstep(.009, .006, d) * .6 + exp(-d / .02) * .2) * on;
    }
    lights *= uCity;
    cone *= uCity;
  }
  col += lights;
  // The air under the lamps is bright with rain (the streaks themselves are drawn on the glass pass).
  col += vec3(.5, .55, .65) * cone * .012 * (.4 + uAmount) * uWet;

  col *= 1. - uDim * .6;
  col = col / (1. + col * .3);
  // Stored as sqrt: far more precision in the darks, where all of this lives.
  col = sqrt(max(col, 0.));
  col += (hash12(gl_FragCoord.xy + fract(t * 7.)) - .5) / 255.;
  FRAG_COLOR = vec4(col, 1.);
}
`;

/* ── pass 2: the glass ────────────────────────────────────────────────────── */

const GLASS = /* glsl */ `
uniform sampler2D uScene;
uniform vec2 uRes;       // buffer px
uniform float uDpr;      // buffer px per CSS px
uniform float uTime;
uniform vec2 uMouse;     // buffer px, y up
uniform float uCursor;   // the cursor's light, 0..1 (it can be turned off)
uniform vec4 uFlash;
uniform float uAmount;
uniform float uWet;
uniform float uFog;
uniform vec3 uA;
uniform float uDim;
uniform float uQuality;
uniform float uLodBase;
uniform float uScale;    // min(uRes)
uniform vec4 uShock0;
uniform vec4 uShock1;
uniform vec4 uShock2;    // ripples: xy, age 0..1, strength
uniform float uFade;     // fades the scene in when it first appears
uniform vec2 uSceneSize; // the city texture, texels
uniform float uWind;     // rain slant (x per y)
uniform float uBlur;     // how out of focus the world outside is (rain softens a little less)

${NOISE}

/** Anti-aliasing width for edges drawn on the glass, in CSS px (about one device pixel). */
float AA;

vec3 scene(vec2 uv, float lod) {
  vec3 c = TEXLOD(uScene, uv, lod).rgb;
  return c * c;
}

/* A smooth, round blur: one mip level read through a cubic B-spline (four bilinear taps).
   A plain lookup of a small mip looks blocky and jumps as lights move; this doesn't. */
vec3 sceneSoft(vec2 uv, float level) {
  vec2 size = max(floor(uSceneSize / exp2(level)), vec2(1.));
  vec2 p = uv * size - .5;
  vec2 i = floor(p);
  vec2 f = p - i;
  vec2 f2 = f * f;
  vec2 f3 = f2 * f;
  vec2 w0 = (-f3 + 3. * f2 - 3. * f + 1.) / 6.;
  vec2 w1 = (3. * f3 - 6. * f2 + 4.) / 6.;
  vec2 w2 = (-3. * f3 + 3. * f2 + 3. * f + 1.) / 6.;
  vec2 w3 = f3 / 6.;
  vec2 g0 = w0 + w1;
  vec2 g1 = w2 + w3;
  vec2 h0 = (i - .5 + w1 / g0) / size;
  vec2 h1 = (i + 1.5 + w3 / g1) / size;
  vec3 a = TEXLOD(uScene, vec2(h0.x, h0.y), level).rgb;
  vec3 b = TEXLOD(uScene, vec2(h1.x, h0.y), level).rgb;
  vec3 c = TEXLOD(uScene, vec2(h0.x, h1.y), level).rgb;
  vec3 d = TEXLOD(uScene, vec2(h1.x, h1.y), level).rgb;
  vec3 v = g0.y * (g0.x * a + g1.x * b) + g1.y * (g0.x * c + g1.x * d);
  return v * v;
}

/* Rain falling past outside, drawn sharp at screen resolution: fine streaks on slanted
   columns (CSS px). Near ones are longer, faster and softer; far ones short and fine. */
float streaks(vec2 P, float colW, float speed, float len, float dens, float w, float seed) {
  vec2 q = P;
  q.x += q.y * uWind;
  float cx = q.x / colW;
  float ci = floor(cx);
  float fx = (fract(cx) - .5) * colW;
  float hc = hash11(ci * 1.37 + seed);
  float cell = len * 2.4;
  float y = (q.y + uTime * speed * (.8 + .4 * hc)) / cell + hc * 37.;
  float ri = floor(y);
  float fy = fract(y) * cell;
  vec2 g = vec2(ci, ri) + seed;
  if (hash12(g) > dens) return 0.;
  float l = len * (.55 + .9 * hash12(g + 5.3));
  float s = fy - hash12(g + 7.9) * (cell - l);
  if (s < 0. || s > l) return 0.;
  float along = smoothstep(0., l * .18, s) * (1. - smoothstep(l * .35, l, s));
  float d = abs(fx - (hash12(g + 2.7) - .5) * colW * .55);
  return along * exp(-d * d / (w * w)) * (.55 + .45 * hash12(g + 9.1));
}

/* Beads: rain that hit the glass and stuck. Each cell's bead is replaced every so often
   by a fresh one somewhere else — new rain landing — while the old one slowly shrinks. */
void beads(vec2 P, float cell, float dens, float rMin, float rMax, float life, float seed, float wiped, inout vec4 D) {
  vec2 id = floor(P / cell);
  float h0 = hash12(id + seed);
  float k = uTime / (life * (.6 + .8 * h0)) + h0 * 7.;
  float gen = floor(k);
  float t = fract(k);
  vec2 sid = id + gen * vec2(17.13, 31.71) + seed;
  if (hash12(sid) > dens) return;
  vec2 c = (id + .5 + (vec2(hash12(sid + 3.1), hash12(sid + 5.7)) - .5) * .5) * cell;
  float r = mix(rMin, rMax, pow(hash12(sid + 9.2), 2.6));
  r *= smoothstep(0., .025, t) * (1. - .45 * smoothstep(.55, 1., t));
  float vis = (1. - smoothstep(.88, 1., t)) * (1. - wiped);
  vec2 q = P - c;
  q.y *= q.y > 0. ? 1.1 : .95;
  float d = length(q);
  if (d >= r || vis <= 0.) return;
  float m = smoothstep(r, r - AA, d) * vis;
  if (m > D.w) D = vec4(q / r, r, m);
}

/* A drop that runs down the glass: it gathers, breaks free, and lurches and stalls its way
   down, faster as it collects water, leaving a clear trail dotted with tiny beads. */
float pathX(float y, float x0, float w, float seed) {
  return x0 + (noise1(y / 115. + seed) - .5) * w * .34 + (noise1(y / 23. + seed * 3.) - .5) * 4. + (noise1(y / 6. + seed * 5.) - .5) * 1.2;
}
void runner(vec2 P, float W, float seed, float H, inout vec4 D, inout float clear, inout float trail, inout float rim) {
  float col = floor(P.x / W);
  float hc = hash11(col * 1.31 + seed);
  float period = mix(9., 19., hash11(col * 2.17 + seed)) / mix(.65, 1.5, uAmount);
  float k = uTime / period + hc * 17.;
  float gen = floor(k);
  float t = fract(k);
  vec2 g = vec2(col, gen) + seed;
  if (hash12(g) > mix(.3, .8, uAmount) * smoothstep(.25, .85, uWet)) return;
  float r = mix(5.5, 12., pow(hash12(g + 1.7), 1.4));
  float y0 = H * mix(.3, 1.05, hash12(g + 3.3));
  float x0 = (col + .5 + (hash12(g + 5.1) - .5) * .45) * W;
  float ps = hash12(g + 6.6) * 40.;
  float form = .1;
  float s = clamp((t - form) / (1. - form), 0., 1.);
  float wob = 6.2832 * mix(5., 9., hash12(g + 7.9));
  float ph = hash12(g + 8.8) * 6.;
  float jerk = s - .88 * (sin(s * wob + ph) - sin(ph)) / wob;
  float travel = (jerk * .5 + jerk * jerk * .8) * (y0 + 90.);
  float yh = y0 - travel;
  float speed = (1. - .88 * cos(s * wob + ph)) * (.5 + 1.6 * jerk);
  float endFade = 1. - smoothstep(.82, 1., t);

  // the trail
  if (P.y > yh && P.y < y0 + r) {
    float xt = pathX(P.y, x0, W, ps);
    float tw = r * .8 * (.55 + .45 * exp(-(P.y - yh) / 300.));
    float dx = abs(P.x - xt);
    float life = endFade * smoothstep(y0 + r, y0 - r * 2., P.y);
    float tm = smoothstep(tw, tw * .35, dx) * life;
    trail = max(trail, tm);
    clear = max(clear, tm * (.5 + .35 * exp(-(P.y - yh) / 500.)));
    // the water's edge on either side catches a little light
    float glisten = .35 + .65 * noise1(P.y / 9. + col * 5.3 + gen);
    rim = max(rim, smoothstep(tw * .55, tw * .85, dx) * smoothstep(tw * 1.1, tw * .85, dx) * life * glisten * exp(-(P.y - yh) / 700.));
    // tiny beads left behind
    float step_ = r * 2.3;
    float ci = floor(P.y / step_);
    float yc = (ci + .5) * step_;
    vec2 bg = vec2(ci, gen) + seed + col * 7.;
    if (yc > yh + r * 1.6 && yc < y0 && hash12(bg) < .62) {
      vec2 bc = vec2(pathX(yc, x0, W, ps) + (hash12(bg + 1.9) - .5) * tw * 1.2, yc + (hash12(bg + 2.9) - .5) * step_ * .5);
      float br = r * mix(.16, .36, hash12(bg + 4.4)) * endFade;
      vec2 q = P - bc;
      float d = length(q);
      if (d < br) {
        float m = smoothstep(br, br - AA, d);
        if (m > D.w) D = vec4(q / br, br, m);
      }
    }
  }

  // the drop itself: a rounded head, tapering up into its trail, stretched as it speeds
  vec2 hp = vec2(pathX(yh, x0, W, ps), yh);
  vec2 q = P - hp;
  float rr = r * smoothstep(0., form, t);
  if (abs(q.x) > rr * 1.4 || q.y < -rr * 1.2 || q.y > rr * 4.) return;
  float stretch = 1. + .35 * clamp(speed, 0., 2.5);
  vec2 qs = q;
  qs.y = q.y > 0. ? q.y / (stretch * 1.35) : q.y / 1.06;
  qs.x *= 1. + max(q.y, 0.) / (rr * 2.6);
  float d = length(qs);
  if (d < rr) {
    float m = smoothstep(rr, rr - AA, d) * endFade;
    if (m > D.w) D = vec4(qs / rr, rr, m);
  }
}

/* Splash ripples: rings of waves spreading through the glass. */
vec2 ripple(vec4 s, vec2 frag, inout float light) {
  if (s.w <= 0.) return vec2(0.);
  vec2 dv = frag - s.xy;
  float d = length(dv);
  float R = s.z * uScale * .85;
  float k = (d - R) / (uScale * .022);
  float env = exp(-k * k * .08) * pow(1. - s.z, 1.6) * s.w;
  float w = sin(k * 2.4) * env;
  light += max(w, 0.) * env;
  return dv / max(d, 1.) * w * uScale * .0065;
}

void main() {
  vec2 frag = gl_FragCoord.xy;
  vec2 uv = frag / uRes;
  vec2 P = frag / uDpr;
  float H = uRes.y / uDpr;
  AA = 1.2 / uDpr;

  float rl = 0.;
  vec2 rip = ripple(uShock0, frag, rl) + ripple(uShock1, frag, rl) + ripple(uShock2, frag, rl);
  vec2 Pd = P + rip / uDpr;

  vec4 D = vec4(0.);
  float clear = 0.;
  float trail = 0.;
  float rim = 0.;
  runner(Pd, 76., 1., H, D, clear, trail, rim);
  if (uQuality > .5) runner(Pd + vec2(38., 0.), 120., 7., H, D, clear, trail, rim);
  float dens = mix(.38, .85, uAmount) * smoothstep(0., .7, uWet);
  beads(Pd, 24., dens, 1.1, 3.8, 9., 1., trail, D);
  beads(Pd + vec2(11., 5.), 54., dens * .7, 2.6, 9.5, 17., 2., trail, D);
  if (uQuality > .5) {
    beads(Pd + vec2(29., 17.), 36., dens * .75, 1.5, 6., 12., 3., trail, D);
    beads(Pd + vec2(47., 31.), 100., dens * .4, 6., 15., 26., 4., trail, D);
  }

  // A light veil of mist on the glass, except where water has run.
  float fn = vnoise(P / 420. + vec2(uTime * .006, 0.)) * .6 + vnoise(P / 130. - uTime * .01) * .4;
  float fog = uFog * mix(.55, 1.15, fn) * (1. - clear) * mix(.35, 1., uWet);
  vec2 suv = uv + rip / uRes;
  vec3 back = scene(suv, .2 + fog * 2.2);
  // the lights bloom softly through the wet glass
  vec3 bloom = sceneSoft(suv, 4.) * .65 + sceneSoft(suv, 6.) * .35;
  back += bloom * (.1 + fog * .3);
  back = mix(back, back * .9 + vec3(.011, .013, .018), fog * .45);
  // where a drop has run, the glass is clean and wet: clearer, a touch brighter
  back *= 1. + trail * .1;

  // Rain falling past outside, lit by whatever light is behind it.
  float rd = mix(.18, .62, uAmount) * uWet;
  float sb = 1. + uBlur * 1.6;
  float rain = streaks(P, 9., 950., 22., rd, .55 * sb, 1.) * .5;
  rain += streaks(P + vec2(4.3, 0.), 17., 1400., 44., rd * .8, .75 * sb, 5.) * .7;
  if (uQuality > .5) rain += streaks(P + vec2(11.7, 0.), 43., 2100., 120., rd * .5, 1.7 * sb, 9.) * .45;
  rain /= 1. + uBlur * .9;
  float lum = dot(back, vec3(.3, .5, .2)) * 1.6 + dot(bloom, vec3(.3, .5, .2)) * 1.4;
  back += vec3(.76, .82, .95) * rain * (.01 + lum * .9 + uFlash.x * .6) * (1. - fog * .35);

  vec3 lampCol = mix(vec3(1., .86, .7), uA, .3);
  float mnear = 1. / (1. + dot((uMouse - frag) / uDpr, (uMouse - frag) / uDpr) / (300. * 300.));
  vec3 col = back + (bloom * .55 + vec3(.008, .01, .014) + lampCol * mnear * .12 * uCursor) * rim;
  if (D.w > 0.) {
    vec2 n = D.xy;
    float r = D.z;
    float l2 = min(dot(n, n), 1.);
    // a little lens: the city, upside down, small and sharp
    vec2 off = -n * r * (1. + 6. * (1. + .7 * l2));
    vec3 img = scene((Pd + off) * uDpr / uRes, 1.);
    vec3 N = normalize(vec3(n * .92, sqrt(max(1. - l2 * .85, .0))));
    float rim = smoothstep(.45, 1., sqrt(l2));
    // tiny beads read as specks of light, not dark dots: less shadow at their edges
    float tiny = 1. - smoothstep(2.5, 7., r);
    vec3 dc = img * (1.3 - rim * rim * 1.15 * (1. - tiny * .7)) + vec3(.004, .005, .008) + bloom * tiny * .25;
    // the cursor is a warm light held near the glass; a faint one from above, always
    vec3 L = vec3((uMouse - frag) / uDpr, 240.);
    vec3 hv = normalize(normalize(L) + vec3(0., 0., 1.));
    float near = 1. / (1. + dot(L.xy, L.xy) / (320. * 320.));
    float spec = pow(max(dot(N, hv), 0.), 70.) * near * 1.5 * uCursor;
    float amb = pow(max(dot(N, normalize(vec3(-.3, .62, 1.))), 0.), 36.) * (.14 + tiny * .16);
    dc += lampCol * spec + vec3(.75, .82, 1.) * amb;
    dc += lampCol * near * .05 * (1. - rim) * uCursor;
    // lightning catches the top of every drop
    dc += uFlash.x * vec3(.7, .77, 1.) * (pow(max(N.y, 0.), 2.) * .55 + .06);
    col = mix(col, dc, D.w);
  }

  // The cursor's light spills into the fog around it.
  float md = length((uMouse - frag) / uDpr);
  col += lampCol * exp(-md * md / (280. * 280.)) * .026 * (.35 + fog) * uCursor;
  col += mix(vec3(.78, .88, 1.), uA, .3) * rl * .1;
  // Lightning: the whole pane lights up for an instant.
  col += uFlash.x * vec3(.045, .05, .066) * (.4 + fog);

  col *= 1. - uDim * .5;
  col *= 1. - .3 * pow(length(uv - .5) * 1.25, 2.4);
  col *= uFade;
  col += (hash12(frag + fract(uTime * 7.3)) - .5) / 255.;
  FRAG_COLOR = vec4(max(col, 0.), 1.);
}
`;

export type RainShaders = { vert: string; scene: string; glass: string };

/** GLSL for WebGL2 (explicit LOD) or WebGL1 (with or without the LOD extension). */
export function rainShaders(gl2: boolean, lodExt: boolean): RainShaders {
  const precision = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
`;
  if (gl2) {
    const head = `#version 300 es\nprecision highp float;\nout vec4 fragOut;\n#define FRAG_COLOR fragOut\n#define TEXLOD(s, uv, l) textureLod(s, uv, l)\n`;
    return {
      vert: `#version 300 es\nin vec2 aPos;\nvoid main() { gl_Position = vec4(aPos, 0.0, 1.0); }\n`,
      scene: head + SCENE,
      glass: head + GLASS,
    };
  }
  const lod = lodExt
    ? `#extension GL_EXT_shader_texture_lod : enable\n${precision}#define TEXLOD(s, uv, l) texture2DLodEXT(s, uv, l)\n`
    : `${precision}#define TEXLOD(s, uv, l) texture2D(s, uv, (l) - uLodBase)\n`;
  return {
    vert: `attribute vec2 aPos;\nvoid main() { gl_Position = vec4(aPos, 0.0, 1.0); }\n`,
    scene: `${precision}#define FRAG_COLOR gl_FragColor\n#define TEXLOD(s, uv, l) texture2D(s, uv)\n` + SCENE,
    glass: `${lod}#define FRAG_COLOR gl_FragColor\n` + GLASS,
  };
}
