/**
 * The sky: a vivid day, the way skies are painted in anime films — a deep blue overhead melting
 * into bright cyan at the horizon, the sun low and blazing, its rays fanning out across the sky,
 * and clouds everywhere: great towers of cumulus heaped up at the sides, white where the sun
 * catches them and lavender in their own shade, blushing pink along their edges; small fluffy
 * clouds drifting across the middle of the sky; long wisps of cirrus combed out up high; and a
 * hazy bank along the horizon. They all drift on the wind, each at its own depth, and keep
 * changing shape as they go.
 *
 * Two passes. The clouds are soft, so they're drawn at lower resolution into a texture first;
 * then the sky, the sun, its rays and the clouds over them at full resolution.
 *
 * Every colour comes from the palette (palettes.ts): the same sky in azure, pastel, gold,
 * sunset or twilight.
 */

const PALETTE = ["uZenith", "uMid", "uHorizon", "uHaze", "uSunCore", "uSunGlow", "uLit", "uShade", "uRim", "uSunAt"];
export const SKY_CLOUD_UNIFORMS = ["uRes", "uView", "uTime", "uDrift", "uCover", "uPar", "uGust", "uPart", "uQuality", ...PALETTE];
export const SKY_VIEW_UNIFORMS = ["uRes", "uTime", "uClouds", "uRays", "uFade", "uIntro", "uMouse", "uCursor", "uBurst", "uTrail", "uTrailAge", ...PALETTE];

const COMMON = /* glsl */ `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
uniform vec3 uZenith;    // the sky overhead
uniform vec3 uMid;       // halfway down
uniform vec3 uHorizon;   // at the horizon
uniform vec3 uHaze;      // the low haze
uniform vec3 uSunCore;   // the sun itself
uniform vec3 uSunGlow;   // the light round it
uniform vec3 uLit;       // a cloud in sunlight
uniform vec3 uShade;     // a cloud in its own shade
uniform vec3 uRim;       // the glow along a cloud's edges toward the sun
uniform vec3 uSunAt;     // where the sun is (x across 0..1, y up 0..1), and how many stars are out

const float TAU = 6.2831853;

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
const mat2 ROT = mat2(.8, .6, -.6, .8);
float fbm(vec2 p) {
  float v = 0.;
  float a = .5;
  for (int i = 0; i < 5; i++) {
    v += a * vnoise(p);
    p = ROT * p * 2.03 + 11.7;
    a *= .5;
  }
  return v;
}
float fbm3(vec2 p) {
  float v = 0.;
  float a = .5;
  for (int i = 0; i < 3; i++) {
    v += a * vnoise(p);
    p = ROT * p * 2.03 + 11.7;
    a *= .5;
  }
  return v / .875;
}
/* Billowing noise: round lumps heaped on lumps (the way a cumulus boils). */
float billow(vec2 p) {
  float v = 0.;
  float a = .5;
  for (int i = 0; i < 4; i++) {
    v += a * (1. - abs(vnoise(p) * 2. - 1.));
    p = ROT * p * 2.07 + 5.3;
    a *= .5;
  }
  return v / .9375;
}
`;

/** Pass 1: the clouds — towers, puffs, wisps and the far bank — lit, in a small texture. */
export const SKY_CLOUD_FRAG = /* glsl */ `${COMMON}
uniform vec2 uRes;       // this pass's size, px
uniform vec2 uView;      // the sky buffer, px
uniform float uTime;
uniform vec4 uDrift;     // how far the wind has carried each layer (screen heights): towers, puffs, wisps, far bank
uniform float uCover;    // how cloudy, 0..1
uniform vec2 uPar;       // the cursor, -.5..+.5 across the screen: the near clouds shift with it a little (depth)
uniform vec4 uGust;      // the cursor's gust: where (sky px), and how hard it pushes (screen heights)
uniform vec4 uPart;      // the clouds parting round a point: where (sky px), how wide (screen heights), how much
uniform float uQuality;

/* ── the towers: great heaps of cumulus rising from below ─────────────────── */

/* How tall the towers grow along the screen: highest at the sides, low in the middle (where
   the note is), and their own ups and downs as they drift. */
float towerTop(float xs, float xd, float aspect) {
  float u = xs / aspect;
  float env = mix(.16, .62, smoothstep(.58, .98, u)) + .3 * smoothstep(.34, .0, u);
  float g = smoothstep(.2, .85, vnoise(vec2(xd * 2.1, 3.7)));
  float g2 = vnoise(vec2(xd * 5.7, 9.1));
  return env * (.45 + .55 * g) * (.75 + .4 * g2) * (.55 + .45 * uCover);
}

/* One round puff of cloud, melted into the others (the nearest surface wins, softly). "under"
   squashes its underside (cumulus sit on a level base). */
void puffF(vec2 p, vec2 ctr, float rad, float z0, float under, inout vec4 acc, inout float best, inout float cover) {
  vec2 d = (p - ctr) / rad;
  if (d.y < 0.) d.y /= under;
  float dd = dot(d, d);
  if (dd >= 1.) return;
  float zn = sqrt(1. - dd);
  float w = exp((z0 + zn * rad) * 40.) * smoothstep(1., .7, dd);
  acc += vec4(d / max(zn, .18), zn, 1.) * w;
  best = max(best, w);
  cover = max(cover, smoothstep(1., .45, dd));
}
void puff(vec2 p, vec2 ctr, float rad, float z0, inout vec4 acc, inout float best, inout float cover) {
  vec2 d = (p - ctr) / rad;
  float dd = dot(d, d);
  if (dd >= 1.) return;
  float zn = sqrt(1. - dd);
  float w = exp((z0 + zn * rad) * 40.) * smoothstep(1., .7, dd);
  acc += vec4(d / max(zn, .18), zn, 1.) * w;
  best = max(best, w);
  cover = max(cover, smoothstep(1., .45, dd));
}

/* The towers at p (screen heights; pd drifts): the surface's slope (xy), how upright it faces
   you (z), how folded it is (w); and how much cloud is there. */
vec4 towers(vec2 p, float pdx, float aspect, bool hq, out float cover) {
  vec4 acc = vec4(0.);
  float best = 0.;
  cover = 0.;
  float cell = .2;
  float xd = p.x + pdx;
  float ci = floor(xd / cell);
  for (int k = -1; k <= 1; k++) {
    float i = ci + float(k);
    float x = (i + .5 + (hash11(i * 7.3) - .5) * .5) * cell;
    float xs = x - pdx;
    float H = towerTop(xs, x, aspect);
    float z0 = hash11(i * 1.9) * cell * .4;
    float rad = cell * mix(.6, .85, hash11(i * 5.1));
    // the tower: a big dome on top, shoulders either side, a broad base
    puff(vec2(xd, p.y), vec2(x, H - rad * .8), rad, z0, acc, best, cover);
    float side = hash11(i * 2.3) > .5 ? 1. : -1.;
    float r2 = cell * mix(.4, .58, hash11(i * 8.9));
    puff(vec2(xd, p.y), vec2(x + side * cell * .5, H * .66 - r2 * .4), r2, z0 + cell * .1, acc, best, cover);
    puff(vec2(xd, p.y), vec2(x - side * cell * .42, H * .4 - r2 * .3), r2 * .9, z0 + cell * .05, acc, best, cover);
    puff(vec2(xd, p.y), vec2(x, H * .12 - cell * .5), cell * .95, z0 - cell * .1, acc, best, cover);
  }
  // and smaller puffs boiling up all over them
  float cb = cell * .42;
  float cj = floor(xd / cb);
  for (int k = -1; k <= 1; k++) {
    float j = cj + float(k);
    float x = (j + .5 + (hash11(j * 3.1 + 5.) - .5) * .6) * cb;
    float H = towerTop(x - pdx, x, aspect);
    float rad = cb * mix(.35, .8, pow(hash11(j * 6.7), 1.5));
    float sink = mix(.4, 2.2, hash11(j * 4.3));
    puff(vec2(xd, p.y), vec2(x, H - rad * sink), rad, cell * .28 + hash11(j * 9.1) * cell * .2, acc, best, cover);
    if (hq) {
      float r3 = rad * mix(.4, .75, hash11(j * 2.9));
      float x3 = x + (hash11(j * 1.3) - .5) * cb;
      puff(vec2(xd, p.y), vec2(x3, towerTop(x3 - pdx, x3, aspect) - r3 * mix(.5, 2.6, hash11(j * 7.7))), r3, cell * .36, acc, best, cover);
    }
  }
  if (acc.w <= 0.) return vec4(0., 0., 1., 0.);
  return vec4(acc.xy / acc.w, acc.z / acc.w, 1. - best / acc.w);
}

/* A cloud's edge: crisp, but bumpy, and here and there fraying into a wisp. */
float fray(float cover, vec2 p) {
  float n = billow(p * 46. + vec2(uTime * .01, 0.));
  float w = fbm3(p * 22. + vec2(uTime * .012, 3.));
  return smoothstep(.16, .42, cover + (n - .55) * .22 - smoothstep(.55, .9, w) * .12);
}

/* A cloud's colour from its shade (0) to full sunlight (1), by way of a lilac blush between
   (so the light and shade never meet in a muddy middle). */
vec3 ramp(float k) {
  vec3 mid = mix(mix(uShade, uLit, .5), uRim, .3);
  return mix(mix(uShade, mid, smoothstep(.0, .5, k)), uLit, smoothstep(.5, 1., k));
}

/* Lights a tower: sunlit white on the side toward the sun and on top, its own shade lavender
   underneath and away from it, and a pink glow along the edges where the light grazes. */
vec3 lightCloud(vec4 s, vec2 p, vec2 toSun, float near, float height, bool hq) {
  vec2 bump = (vec2(vnoise(p * 26.), vnoise(p * 26. + 5.3)) - .5) * .7;
  if (hq) bump += (vec2(vnoise(p * 75.), vnoise(p * 75. + 2.1)) - .5) * .3;
  vec3 N = normalize(vec3(s.xy * .55 + bump, 1.));
  vec3 L = normalize(vec3(toSun, .8));
  float sun = clamp((dot(N, L) + .55) / 1.55, 0., 1.);
  float up = .5 + .5 * N.y;
  // mostly how high up the cloud this is (its crown in sunlight, its underside in shade),
  // shaped a little by each puff's roundness
  float lit = clamp(height * .72 + sun * .38 + up * .22 - .2, 0., 1.);
  // and lumpy all over: each little bulge catches the light (the cauliflower look)
  float lump = billow(p * 34. + 1.7);
  lit = clamp(lit + (lump - .58) * .24 * (.3 + .7 * height), 0., 1.);
  vec3 c = ramp(smoothstep(.04, .8, lit));
  // the grazing light along its edges, warmest near the sun
  float edge = pow(1. - N.z, 1.4);
  float facing = clamp(dot(normalize(N.xy + 1e-4), toSun) * .5 + .5, 0., 1.);
  c = mix(c, uRim, clamp(edge * facing * (.3 + .45 * near) + (1. - lit) * (1. - height) * .28 * near, 0., 1.));
  // the creases between puffs sit a little deeper in shade
  c = mix(c, uShade, s.w * .22 * (1. - lit * .6));
  return c;
}

/* ── the cumulus: little heaps of cloud floating across the middle of the sky ─── */

/* One cumulus — the one in cell "id" of the sky, if that cell has one (some are empty): a few
   puffs side by side on a level base, a crown heaped on top, each cloud a little different
   (lopsided, taller or flatter). Gives its surface at p (as towers does), how much of it is
   there, and how far up it this point is ("height": 0 at its base, 1 at its crown). */
bool cumulusAt(vec2 p, vec2 id, vec2 cell, out vec4 s, out float cover, out float height) {
  s = vec4(0., 0., 1., 0.);
  cover = 0.;
  height = 0.;
  if (hash12(id * 1.7 + 3.1) > .2 + uCover * .55) return false;
  vec2 o = (id + vec2(.15 + .7 * hash12(id + 5.3), .2 + .45 * hash12(id + 9.1))) * cell;
  float w = cell.x * mix(.12, .4, pow(hash12(id + 2.2), 1.3));
  float r = w * .5;
  vec2 rel = p - o;
  if (rel.x < -w * 1.3 || rel.x > w * 1.45 || rel.y < -r * .4 || rel.y > r * 3.) return false;
  vec4 acc = vec4(0.);
  float best = 0.;
  float z = hash12(id + 4.4) * .02;
  float lean = (hash12(id + 6.6) - .5) * .5;
  float tall = mix(.75, 1.3, hash12(id + 7.2));
  puffF(p, o + vec2(-w * .62, r * .28), r * .82, z, .6, acc, best, cover);
  puffF(p, o + vec2(w * .6, r * .24), r * .78, z, .6, acc, best, cover);
  puffF(p, o + vec2(0., r * .5), r * 1.08, z + .01, .62, acc, best, cover);
  puff(p, o + vec2(w * (-.24 + lean), r * 1.2 * tall), r * .72, z + .02, acc, best, cover);
  puff(p, o + vec2(w * (.28 + lean), r * 1.08 * tall), r * .64, z + .02, acc, best, cover);
  puff(p, o + vec2(w * (-.62 + lean * .5), r * .85), r * .5, z + .015, acc, best, cover);
  puff(p, o + vec2(w * (.66 + lean * .5), r * .72), r * .46, z + .015, acc, best, cover);
  if (hash12(id + 8.8) > .4) puff(p, o + vec2(w * (.02 + lean * 1.4), r * 1.75 * tall), r * .52, z + .03, acc, best, cover);
  if (hash12(id + 3.9) > .55) puff(p, o + vec2(w * 1.05, r * .3), r * .5, z, acc, best, cover);
  if (acc.w <= 0. || cover <= 0.) return false;
  s = vec4(acc.xy / acc.w, acc.z / acc.w, 1. - best / acc.w);
  height = clamp((rel.y + r * .15) / (r * 2.2), 0., 1.);
  return true;
}

/* ── the scraps: little torn wisps of cumulus, here and there ─────────────── */

float puffs(vec2 q) {
  float gather = fbm3(q * vec2(.85, 1.7) + vec2(4.1, 1.3));
  float body = billow(q * vec2(3.1, 4.6) + vec2(0., uTime * .006));
  return gather * 1.1 + body * .6 - (1.66 - uCover * .5);
}

/* ── the wisps: cirrus combed out high up ─────────────────────────────────── */

float wisps(vec2 q) {
  vec2 v = mat2(.88, -.47, .47, .88) * q;
  v *= vec2(1.1, 5.2);
  float n = fbm(v + vec2(fbm3(v * .45 + 3.) * 2.2, 0.));
  float patches = smoothstep(.42, .72, fbm3(q * .9 + 7.3));
  return smoothstep(.56, .92, n) * patches;
}

void main() {
  vec2 frag = gl_FragCoord.xy / uRes * uView;
  vec2 uv = frag / uView;
  float aspect = uView.x / uView.y;
  vec2 c = frag / uView.y;
  bool hq = uQuality > .5;
  vec2 sunC = vec2(uSunAt.x * aspect, uSunAt.y);

  // the cursor's gust pushes the clouds near it along; a new page parts them round it
  vec2 g = (frag - uGust.xy) / uView.y;
  vec2 push = uGust.zw * exp(-dot(g, g) / (.16 * .16));
  vec2 pp = (frag - uPart.xy) / uView.y;
  float part = uPart.w * exp(-dot(pp, pp) / max(uPart.z * uPart.z, 1e-4));

  vec3 rgb = vec3(0.);
  float a = 0.;

  // ── wisps, high up (furthest away: barely shift with the cursor) ──
  if (c.y > .38) {
    vec2 q = c + vec2(uDrift.z, 0.) - uPar * .004 - push * .3;
    float w = wisps(q) * smoothstep(.38, .7, c.y) * (.45 + .55 * uCover) * (1. - part);
    if (w > 0.) {
      float near = exp(-length(c - sunC) / .5);
      vec3 col = mix(uLit, uRim, .25 + .35 * near);
      col = mix(col, uHaze, .2);
      float al = w * .55;
      rgb = col * al + rgb * (1. - al);
      a = al + a * (1. - al);
    }
  }

  // ── the far bank, low along the horizon (hazy with distance) ──
  if (c.y < .2) {
    vec2 q = c + vec2(uDrift.w, 0.) - uPar * .006;
    float d = billow(q * vec2(7., 12.) + 2.1) * .7 + fbm3(q * vec2(2.2, 6.)) * .55 - .64;
    d -= smoothstep(.04, .17, c.y) * .45;
    if (d > 0.) {
      float top = vnoise(q * 9.) * .5;
      vec3 col = ramp(smoothstep(.0, .3, d + top * .2));
      col = mix(col, uHaze, .5);
      float al = smoothstep(0., .12, d) * .85;
      rgb = col * al + rgb * (1. - al);
      a = al + a * (1. - al);
    }
  }

  // ── scraps, here and there across the middle of the sky ──
  if (c.y > .12 && c.y < .95) {
    vec2 q = c + vec2(uDrift.y, 0.) - uPar * .012 - push * .7;
    float band = smoothstep(.12, .3, c.y) * smoothstep(.95, .7, c.y);
    float d = puffs(q) * band - part * .5 - (1. - band) * .3;
    if (d > -.02) {
      // lit from the sun's side, and from above
      vec2 toSun = normalize(sunC - c);
      float e = .018;
      float ds = puffs(q + toSun * e) * band;
      float du = puffs(q + vec2(0., e)) * band;
      float lit = clamp(.62 + (d - ds) * 7. + (d - du) * 6., 0., 1.);
      float near = exp(-length(c - sunC) / .45);
      vec3 col = ramp(smoothstep(.12, .95, lit));
      // their thin edges glow where the light grazes them
      float thin = 1. - smoothstep(0., .14, d);
      col = mix(col, uRim, thin * (.25 + .5 * near) * (.4 + .6 * lit));
      col += uZenith * .05 * (1. - lit);
      float al = smoothstep(-.02, .07, d) * .9;
      rgb = col * al + rgb * (1. - al);
      a = al + a * (1. - al);
    }
  }

  // ── cumulus, floating across the middle of the sky (the lower ones are further off, so
  //    they go behind: each cloud passes cleanly in front of the next) ──
  if (c.y > .14 && c.y < 1.02) {
    vec2 p = c + vec2(uDrift.y * 1.3, 0.) - uPar * .018 - push * .8;
    p += (vec2(vnoise(p * 34.), vnoise(p * 34. + 7.)) - .5) * .008;
    vec2 cell = vec2(.5, .21);
    vec2 ci = floor(p / cell);
    vec2 toSun = normalize(sunC - c);
    float near = exp(-length(sunC - c) / .5);
    float keep = (1. - part * .95) * smoothstep(.14, .26, c.y);
    for (int j = 1; j >= 0; j--) {
      for (int i = -1; i <= 1; i++) {
        vec4 s;
        float cover;
        float height;
        if (!cumulusAt(p, ci + vec2(float(i), -float(j)), cell, s, cover, height)) continue;
        vec3 col = lightCloud(s, p, toSun, near, height, hq);
        float al = fray(cover * keep, p * 1.3);
        rgb = col * al + rgb * (1. - al);
        a = al + a * (1. - al);
      }
    }
  }

  // ── the towers, nearest of all ──
  if (c.y < .75) {
    vec2 p = c - uPar * .03 - push;
    p += (vec2(vnoise(p * 28.), vnoise(p * 28. + 7.)) - .5) * .01;
    float cover;
    vec4 s = towers(p, uDrift.x, aspect, hq, cover);
    cover *= 1. - part * .9;
    if (cover > 0.) {
      vec2 toSun = normalize(sunC - p);
      float near = exp(-length(sunC - p) / .5);
      float height = clamp(p.y / max(towerTop(p.x, p.x + uDrift.x, aspect), .05), 0., 1.);
      vec3 col = lightCloud(s, p, toSun, near, height, hq);
      // the lowest of them fade into the haze
      col = mix(col, uHaze, smoothstep(.12, .0, p.y) * .35);
      float al = fray(cover, p);
      rgb = col * al + rgb * (1. - al);
      a = al + a * (1. - al);
    }
  }

  gl_FragColor = vec4(clamp(rgb, 0., 1.), clamp(a, 0., 1.));
}
`;

/** Pass 2: the sky, the sun and its rays, the clouds over them, and the arrival through cloud. */
export const SKY_VIEW_FRAG = /* glsl */ `${COMMON}
uniform vec2 uRes;       // this canvas, px
uniform float uTime;
uniform sampler2D uClouds;
uniform float uRays;     // how strongly the rays fan out (they swell when the sun breaks through)
uniform float uFade;
uniform vec4 uIntro;     // arriving through cloud: x how much mist, y how far it has opened (screen heights), z how fast we're rising
uniform vec2 uMouse;     // px, y up
uniform float uCursor;   // how much the cursor lights things, 0..1
uniform float uBurst;    // a burst of sunlight (a new page), 0..1
uniform vec4 uTrail;     // a contrail: where it starts (screen heights), its heading (radians), how fast it's drawn (screen heights a second)
uniform float uTrailAge; // how long ago it began (s; 0: there isn't one)

void main() {
  vec2 frag = gl_FragCoord.xy;
  vec2 uv = frag / uRes;
  float H = uRes.y;
  float aspect = uRes.x / uRes.y;
  vec2 c = frag / H;
  vec2 sunC = vec2(uSunAt.x * aspect, uSunAt.y);

  // the sky: deep overhead, bright toward the horizon
  float h = uv.y;
  vec3 col = mix(uHorizon, uMid, smoothstep(.0, .5, h));
  col = mix(col, uZenith, smoothstep(.3, 1.05, h));
  // a breath of haze along the horizon, and the sky a little deeper away from the sun
  col = mix(col, uHaze, exp(-h * 7.) * .45);
  vec2 d = c - sunC;
  float r = length(d);
  col *= .9 + .1 * exp(-r * .9);
  // the sky whitens toward the sun (the light scattered round it)
  col += uSunGlow * (exp(-r * 3.4) * .2 + exp(-r * 12.) * .3) * (1. + uBurst * .8);

  // stars, when it's late enough
  if (uSunAt.z > .01) {
    vec2 sg = frag / 3.;
    vec2 id = floor(sg / 9.);
    float st = hash12(id);
    if (st > .985) {
      vec2 sp = (fract(sg / 9.) - vec2(hash12(id + 3.1), hash12(id + 7.7)) * .6 - .2) * 9.;
      float tw = .6 + .4 * sin(uTime * (1. + st * 3.) + st * 50.);
      col += vec3(1., .96, .9) * exp(-dot(sp, sp) * 1.4) * tw * uSunAt.z * smoothstep(.35, .8, h) * (st - .985) * 66.;
    }
  }

  // the sun's rays, fanning out across the sky (they turn slowly, and shimmer)
  float ang = atan(d.y, d.x);
  float t = uTime;
  float rays = pow(.5 + .5 * sin(ang * 11. + sin(ang * 5. + t * .07) * 1.6 + t * .03), 3.) * .55
             + pow(.5 + .5 * sin(ang * 23. - t * .045 + sin(ang * 3. - t * .05) * 2.), 4.) * .45;
  float reach = exp(-r * 1.7) * smoothstep(.0, .06, r);
  col += uSunGlow * rays * reach * uRays * .17;

  // a contrail, high over everything: a plane too far off to see but for a glint, drawing a
  // fine white line across the sky that slowly spreads, frays into puffs and fades
  if (uTrailAge > 0.) {
    vec2 dir = vec2(cos(uTrail.z), sin(uTrail.z));
    vec2 q = c - uTrail.xy;
    float along = dot(q, dir);
    float len = uTrail.w * uTrailAge;
    if (along > 0. && along < len + .01) {
      // how long ago this stretch of it was laid down
      float age = max(0., uTrailAge - along / uTrail.w);
      float across = dot(q, vec2(-dir.y, dir.x)) + sin(along * 21. + 1.7) * age * .0003;
      float w = .0011 + age * .00042;
      float body = exp(-across * across / (w * w));
      float clump = mix(1., .3 + .95 * vnoise(vec2(along * 64., 3.1)), smoothstep(3., 26., age));
      float tr = body * clump * exp(-age / 48.) * smoothstep(0., .003, len - along) * smoothstep(0., .03, along) * .62;
      col = mix(col, mix(uLit, uHaze, .25), clamp(tr, 0., 1.));
    }
    vec2 hp = c - uTrail.xy - dir * len;
    col += uSunCore * exp(-dot(hp, hp) / 1.6e-6) * .9;
  }

  // the clouds
  vec4 cl = texture2D(uClouds, uv);
  col = col * (1. - cl.a) + cl.rgb;

  // the sun, blazing through (dimmed by cloud in front of it), and its bloom over the cloud edges
  float sunR = .028;
  float disc = smoothstep(sunR * 1.15, sunR * .85, r);
  float clear = 1. - cl.a * .9;
  col += uSunCore * (disc * 1.3 + exp(-r * 40.) * .7) * clear;
  col += uSunGlow * exp(-r * 6.5) * .12 * (1. + uBurst * 1.4);
  // a soft lens glow where the cursor is (a hand shading the light)
  vec2 m = (frag - uMouse) / H;
  col += uSunGlow * exp(-dot(m, m) / .02) * .035 * uCursor;

  // arriving: rising up through the clouds — the mist streams down past, then opens out
  if (uIntro.x > 0.) {
    vec2 fq = c * vec2(1.6, 2.2) + vec2(0., uIntro.z);
    float mm = fbm(fq) * .62 + fbm(fq * 2.6 + 5.1) * .38;
    vec3 mist = mix(mix(uShade, uLit, .7), uLit, smoothstep(.35, .78, mm));
    mist = mix(mist, vec3(1.), .25);
    vec2 cc = c - vec2(aspect * .5, .5);
    float edge = length(cc * vec2(.8, 1.)) + (mm - .5) * .55;
    float open = smoothstep(uIntro.y - .22, uIntro.y + .06, edge);
    col = mix(col, mist, uIntro.x * open);
  }

  col *= uFade;
  col += (hash12(frag + fract(uTime * 7.)) + hash12(frag.yx + fract(uTime * 5.3) + 17.) - 1.) / 255.;
  gl_FragColor = vec4(clamp(col, 0., 1.), 1.);
}
`;
