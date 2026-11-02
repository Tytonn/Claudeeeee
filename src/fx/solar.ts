/**
 * The solar eclipse: totality, seen from the ground.
 *
 * The real thing, the way it looks in the photographs: a black moon rimmed with fire, the pearly
 * corona streaming out around it in long blades, pink prominences licking at its edge, and a
 * dusky sky with a sunset glowing all the way round the horizon. Clouds drift past below — dark
 * in the moon's shadow, warm where the horizon lights them — and thin veils of high cloud
 * sometimes cross the sun and catch its light.
 *
 * The moon can be nudged off-center (uMoon). By a whisker, and sunlight breaks through the
 * valleys along its edge — Baily's beads — then all at once at one blinding point: the diamond
 * ring. Further, and it's a partial eclipse (the intro starts there).
 *
 * Two passes. The clouds are soft, so they're drawn at lower resolution into a texture first;
 * then the sky, the stars and the eclipse are drawn at full resolution, with the clouds laid
 * over them, and the glare of the sun in the lens over everything.
 */

const SHARED = ["uRes", "uView", "uTime", "uScale", "uQuality", "uSun", "uLight", "uGlare", "uCorona", "uMouse", "uA", "uB"];
export const SOLAR_CLOUD_UNIFORMS = [...SHARED, "uCloudy"];
export const SOLAR_SKY_UNIFORMS = [...SHARED, "uMoon", "uErupt", "uCursor", "uDim", "uFade", "uClouds"];

const HELPERS = /* glsl */ `
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
vec2 hash22(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * vec3(.1031, .103, .0973));
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.xx + p3.yz) * p3.zy);
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
/* Noise that wraps around every per units in x — for things that go all the way round the sun. */
float pnoise(vec2 p, float per) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3. - 2. * f);
  float i0 = mod(i.x, per);
  float i1 = mod(i.x + 1., per);
  float a = hash12(vec2(i0, i.y));
  float b = hash12(vec2(i1, i.y));
  float c = hash12(vec2(i0, i.y + 1.));
  float d = hash12(vec2(i1, i.y + 1.));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
float pfbm(vec2 p, float per) {
  float v = 0.;
  float a = .5;
  for (int i = 0; i < 4; i++) {
    v += a * pnoise(p, per);
    p = p * 2. + vec2(0., 17.3);
    per *= 2.;
    a *= .5;
  }
  return v / .9375;
}
/* The shortest way round from angle b to angle a. */
float adiff(float a, float b) {
  float d = a - b;
  return d - TAU * floor((d + 3.1415927) / TAU);
}

/* The moon's edge isn't smooth: mountains and valleys, a few thousandths of its radius high. */
float limb(vec2 u) {
  return (vnoise(u * 7. + 3.1) * .5 + vnoise(u * 19. + 8.3) * .32 + vnoise(u * 53. + 1.7) * .18) * 2. - 1.;
}
const float MOON = 1.026;   // the moon's radius, in sun radii — just big enough to cover it
const float CRAGS = .012;   // how high its mountains stand

/* ── the sky ───────────────────────────────────────────────────────────── */

vec3 skyColor(vec2 uv) {
  float h = uv.y;
  // Totality: a deep twilight overhead, and a sunset glowing all the way round the horizon.
  vec3 zen = mix(vec3(.016, .028, .07), uB * .1, .3);
  vec3 mid = mix(vec3(.095, .066, .082), uA * .11, .2);
  vec3 low = vec3(.26, .13, .08);
  vec3 hor = vec3(.5, .25, .1);
  vec3 c = mix(hor, low, smoothstep(0., .17, h));
  c = mix(c, mid, smoothstep(.08, .56, h));
  c = mix(c, zen, smoothstep(.5, 1.08, h));
  // Before totality it's daylight still — a strange, dimming kind.
  vec3 day = mix(vec3(.6, .57, .55), vec3(.2, .33, .6), smoothstep(0., .95, h));
  return mix(c, day, clamp(uLight * 1.6, 0., 1.));
}

vec3 starField(vec2 p, float cell, float thresh, float seed) {
  vec2 g = p / cell;
  vec2 id = floor(g);
  vec2 f = fract(g);
  float h = hash12(id + seed);
  if (h < thresh) return vec3(0.);
  vec2 pos = vec2(hash12(id + seed + 3.1), hash12(id + seed + 7.7)) * .6 + .2;
  vec2 d = (f - pos) * cell;
  float mag = (h - thresh) / (1. - thresh);
  float size = mix(.6, 1.5, mag * mag);
  float tw = .6 + .4 * sin(uTime * (1.3 + h * 4.) + h * 60.);
  vec3 tint = mix(vec3(1., .92, .82), vec3(.8, .88, 1.), hash12(id + seed + 9.));
  return tint * exp(-dot(d, d) / (size * size)) * tw * (.3 + .7 * mag);
}

`;

/** Pass 1: the clouds — banks of cumulus low down, veils of cirrus up by the sun. */
export const SOLAR_CLOUD_FRAG = /* glsl */ `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
uniform vec2 uRes;        // this pass's size, px
uniform vec2 uView;       // the screen's sky buffer, px (the same as uRes for the sky pass)
uniform float uTime;
uniform float uScale;     // min(uView)
uniform float uQuality;   // 1 = full, 0 = light
uniform vec3 uSun;        // the sun: center (screen buffer px, y up) and radius (px)
uniform float uLight;     // sunlight getting past the moon: 0 at totality, 1 with no eclipse at all
uniform vec3 uGlare;      // the diamond ring: where on the rim (a unit vector), and how bright
uniform float uCorona;    // how much of the corona shows, 0..1 (sunlight drowns it out)
uniform vec2 uMouse;      // screen buffer px, y up
uniform vec3 uA;          // accent
uniform vec3 uB;          // second hue
uniform float uCloudy;    // 1 = clouds, 0 = a clear sky (they can be turned off)
${HELPERS}
/* ── clouds ────────────────────────────────────────────────────────────── */

/* Cumulus, built the way they grow: a ridge of cloud that heaps up into towers here and there,
   made of round puffs — big ones, with smaller ones bubbling up all over their tops. The puffs
   melt into one smooth surface (each is a ball of cloud; where they meet, the nearest wins,
   softly), and that surface is what gets lit. */
/* Where the clouds lie low: under the sun, so they frame it rather than hide it (x, in the
   bank's own drifting coordinates, and how deep the dip is). */
vec2 gDip = vec2(0.);

float ridge(float x, float tall, float seed) {
  float g = smoothstep(.15, .85, vnoise(vec2(x * 2. + seed, seed * 1.7)));
  float g2 = vnoise(vec2(x * 5.3 + seed * 3., seed));
  float dip = 1. - gDip.y * exp(-pow((x - gDip.x) / .32, 2.));
  return tall * (.3 + .7 * g) * (.7 + .5 * g2) * dip;
}

/* One puff: adds its bit of surface into the blend. */
void puff(vec2 p, vec2 ctr, float rad, float z0, float zref, inout vec4 acc, inout float best, inout float cover) {
  vec2 d = (p - ctr) / rad;
  float dd = dot(d, d);
  if (dd >= 1.) return;
  float zn = sqrt(1. - dd);
  float w = exp((z0 + zn * rad - zref) * 48.) * smoothstep(1., .72, dd);
  acc += vec4(d / max(zn, .18), zn, 1.) * w;
  best = max(best, w);
  cover = max(cover, smoothstep(1., .5, dd));
}

/* The bank of cloud at p (screen heights; x drifts). Returns the surface's slope (xy), how
   upright it faces you (z) and how folded it is (w); cover says how much cloud is there. */
vec4 bank(vec2 p, float cell, float tall, float seed, bool hq, out float cover) {
  vec4 acc = vec4(0.);
  float best = 0.;
  cover = 0.;
  float zref = tall;
  // the big puffs that make each tower
  float ci = floor(p.x / cell);
  for (int k = -1; k <= 1; k++) {
    float i = ci + float(k);
    float x = (i + .5 + (hash11(i * 7.3 + seed) - .5) * .5) * cell;
    float H = ridge(x, tall, seed);
    float z0 = hash11(i * 1.9 + seed) * cell * .5;
    float rad = cell * mix(.55, .78, hash11(i * 5.1 + seed));
    puff(p, vec2(x, H - rad * .85), rad, z0, zref, acc, best, cover);
    float side = hash11(i * 2.3 + seed) > .5 ? 1. : -1.;
    float r2 = cell * mix(.38, .55, hash11(i * 8.9 + seed));
    puff(p, vec2(x + side * cell * .48, H * .62 - r2 * .45), r2, z0 + cell * .12, zref, acc, best, cover);
    puff(p, vec2(x - side * cell * .2, H * .2 - cell * .45), cell * .85, z0 - cell * .1, zref, acc, best, cover);
  }
  // smaller puffs bubbling up all over them, some standing proud, some half sunk in
  float cb = cell * .46;
  float cj = floor(p.x / cb);
  for (int k = -1; k <= 1; k++) {
    float j = cj + float(k);
    float x = (j + .5 + (hash11(j * 3.1 + seed + 5.) - .5) * .6) * cb;
    float H = ridge(x, tall, seed);
    float rad = cb * mix(.32, .78, pow(hash11(j * 6.7 + seed), 1.5));
    float sink = mix(.5, 2.4, hash11(j * 4.3 + seed));
    puff(p, vec2(x, H - rad * sink), rad, cell * .3 + hash11(j * 9.1 + seed) * cell * .2, zref, acc, best, cover);
    if (hq) {
      float r3 = rad * mix(.45, .8, hash11(j * 2.9 + seed));
      float x3 = x + (hash11(j * 1.3 + seed) - .5) * cb;
      puff(p, vec2(x3, ridge(x3, tall, seed) - r3 * mix(.6, 3., hash11(j * 7.7 + seed))), r3, cell * .4, zref, acc, best, cover);
    }
  }
  if (acc.w <= 0.) return vec4(0., 0., 1., 0.);
  vec2 slope = acc.xy / acc.w;
  float fold = 1. - best / acc.w;
  return vec4(slope, acc.z / acc.w, fold);
}

/* High cirrus: long wisps combed out by the wind, in patches that come and go. */
float veil(vec2 c, float sunY) {
  vec2 v = vec2(c.x * .8 + uTime * .006, c.y * 2.4);
  float n = fbm(v * 2.3 + vec2(fbm3(v * 1.2 + 3.) * 1.4, 0.));
  float patches = smoothstep(.45, .72, fbm3(vec2(c.x * .7 + uTime * .0045, c.y * 1.1 + 5.)));
  return smoothstep(.46, .8, n) * patches * smoothstep(sunY - .3, sunY - .08, c.y);
}

/* A cloud's edge isn't a line: it frays into wisps. */
float fluff(float cover, vec2 p) {
  float n = fbm3(p * 38. + vec2(uTime * .01, 0.));
  return clamp(cover * 1.35 - (1. - cover) * (n - .35) * 1.8, 0., 1.);
}

/* Lights the cloud. The eclipse hangs above and behind it, so its light rims the tops; the
   sunset glow along the horizon lights it from below; the sky fills in from above. */
vec3 shadeCloud(vec4 s, vec2 p, vec2 toSun, float sunLit, float rimLit, vec3 amb, float hor, bool hq) {
  vec2 bump = (vec2(vnoise(p * 22.), vnoise(p * 22. + 5.3)) - .5) * .5;
  if (hq) bump += (vec2(vnoise(p * 60.), vnoise(p * 60. + 2.1)) - .5) * .22;
  vec3 N = normalize(vec3(s.xy + bump, 1.));
  vec3 Ls = normalize(vec3(toSun * .9, -.35));
  vec3 Lh = normalize(vec3(0., -1., .35));
  // light wraps softly round a cloud, it doesn't stop dead at a terminator
  float sun = clamp((dot(N, Ls) + .3) / 1.3, 0., 1.);
  float low = clamp((dot(N, Lh) + .25) / 1.25, 0., 1.);
  float up = .5 + .5 * N.y;
  vec3 c = vec3(.026, .022, .028) + amb * (.2 + .45 * up);
  c += vec3(.85, .4, .17) * low * low * hor;
  c += vec3(1., .86, .68) * sun * sun * sunLit;
  // thin edges against the light shine (the silver lining)
  float rim = pow(1. - N.z, 2.) * (1. - s.w);
  c += vec3(1., .88, .72) * rim * rimLit;
  c *= 1. - s.w * .55;
  return c;
}

void main() {
  // This pass is drawn small; work in the screen's own pixels.
  vec2 frag = gl_FragCoord.xy / uRes * uView;
  vec2 uv = frag / uView;
  bool hq = uQuality > .5;
  vec2 par = uMouse / uView - .5;
  vec2 S = uSun.xy - par * uScale * .004;
  float R = uSun.z;
  float r = length(frag - S) / R;
  float glare = uGlare.z;
  // Clouds, front to back, as premultiplied colour and how much they hide what's behind.
  vec3 rgb = vec3(0.);
  float a = 0.;

  // ── High, thin cloud: veils that drift across the sun now and then and catch its light ──
  vec2 c = frag / uView.y;
  if (r < 7.5 && uv.y > .3) {
    float v = veil(c, S.y / uView.y);
    if (v > 0.) {
      float rr = max(r, 1.);
      float lit = uCorona * (exp(-(rr - 1.) / .9) * .55 + exp(-(rr - 1.) / 3.2) * .12) + glare * (exp(-(rr - 1.) / 1.5) * 2.2 + .25);
      lit *= mix(.22, 1., smoothstep(.4, 1., r)) * smoothstep(7.5, 5.5, r);
      rgb += vec3(1., .9, .8) * v * lit;
      // and where the light is just right, a faint shimmer of colour (cloud iridescence)
      float band = exp(-pow((r - 2.6) / 1.3, 2.));
      rgb += (.5 + .5 * cos(TAU * (v * 1.8 + r * .3 + vec3(0., .33, .67)))) * v * band * (.07 * uCorona + .35 * glare);
      a = v * .45 * smoothstep(1.6, 1., r);
    }
  }

  // ── Clouds ──
  float wind = uTime * .0045;
  vec2 sunC = S / uView.y;
  // How brightly the eclipse lights them: hardly at all at totality, gloriously when it breaks out.
  float sunLit = .04 * uCorona + uLight * 1.4 + glare * .85;
  vec3 skyAmb = skyColor(vec2(uv.x, .55)) * 1.1;

  // far bank, low along the horizon
  if (c.y < .17) {
    vec2 p = c + vec2(wind * .45, 0.) - par * .006;
    p += (vec2(vnoise(p * 70.), vnoise(p * 70. + 7.)) - .5) * .005;
    float cover;
    gDip = vec2(sunC.x + wind * .45, .35);
    vec4 sf = bank(p, .07, .11, 1.7, false, cover);
    if (cover > 0.) {
      vec2 toSun = normalize(sunC - p);
      vec3 cc = shadeCloud(sf, p, toSun, sunLit * .6, .05 * uCorona + glare * .45, skyAmb * .85, .6 * smoothstep(.3, .0, p.y), false);
      float al = fluff(cover, p * 1.6);
      rgb = cc * al + rgb * (1. - al);
      a = al + a * (1. - al);
    }
  }
  // near bank: big towers of cumulus
  if (c.y < .43) {
    vec2 p = c + vec2(wind, 0.) - par * .02;
    p += (vec2(vnoise(p * 30.), vnoise(p * 30. + 7.)) - .5) * .012;
    if (hq) p += (vec2(vnoise(p * 90.), vnoise(p * 90. + 3.)) - .5) * .005;
    float cover;
    gDip = vec2(sunC.x + wind, .55);
    vec4 sn = bank(p, .17, .3, 5.3, hq, cover);
    if (cover > 0.) {
      vec2 toSun = normalize(sunC - p);
      float near = exp(-length(sunC - p) / .45);
      float rimLit = (.08 + .25 * near) * uCorona + glare * (.5 + 1.2 * near);
      vec3 cc = shadeCloud(sn, p, toSun, sunLit, rimLit, skyAmb, .5 * smoothstep(.5, .0, p.y), hq);
      float al = fluff(cover, p);
      rgb = cc * al + rgb * (1. - al);
      a = al + a * (1. - al);
    }
  }

  // Stored as sqrt, scaled down: precision in the darks, headroom for the glare.
  rgb *= uCloudy;
  a *= uCloudy;
  gl_FragColor = vec4(sqrt(clamp(rgb / 4., 0., 1.)), clamp(a, 0., 1.));
}
`;

/** Pass 2: the sky, the eclipse, the clouds over it, and the glare. */
export const SOLAR_SKY_FRAG = /* glsl */ `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
uniform vec2 uRes;        // this pass's size, px
uniform vec2 uView;       // the screen's sky buffer, px (the same as uRes for the sky pass)
uniform float uTime;
uniform float uScale;     // min(uView)
uniform float uQuality;   // 1 = full, 0 = light
uniform vec3 uSun;        // the sun: center (screen buffer px, y up) and radius (px)
uniform float uLight;     // sunlight getting past the moon: 0 at totality, 1 with no eclipse at all
uniform vec3 uGlare;      // the diamond ring: where on the rim (a unit vector), and how bright
uniform float uCorona;    // how much of the corona shows, 0..1 (sunlight drowns it out)
uniform vec2 uMouse;      // screen buffer px, y up
uniform vec3 uA;          // accent
uniform vec3 uB;          // second hue
uniform vec2 uMoon;       // the moon's offset from the sun's center, in sun radii
uniform vec4 uErupt;      // a prominence erupting: angle, progress 0..1, size (sun radii), brightness
uniform float uCursor;    // the cursor's light, 0..1
uniform float uDim;
uniform float uFade;      // fades the scene up from black
uniform sampler2D uClouds;
${HELPERS}
/* ── the corona ────────────────────────────────────────────────────────── */

/* One of the long streamers: broad at its base, narrowing to a blade far out, bent a little
   toward the sun's equator the further out it goes. */
float blade(float th, float r, float at, float w, float len, float bend) {
  float k = r - 1.;
  float d = adiff(th, at + bend * (1. - exp(-k / .8)));
  float width = w * (.2 + .8 * exp(-k / .55));
  return exp(-d * d / (width * width)) * exp(-k / len) * smoothstep(0., .05, k);
}

vec3 corona(float r, float th) {
  float k = r - 1.;
  float t = uTime;
  float lr = log(r);
  float a = th / TAU;
  // Fine structure: hair-thin rays combed out along the field lines, drifting slowly outward.
  float fine = pfbm(vec2(a * 40., lr * 2.6 - t * .016), 40.);
  float rays = pow(fine, 2.2) * 2.3;
  if (uQuality > .5 && r < 3.5) rays += pow(pfbm(vec2(a * 136. + 5., lr * 5. - t * .028), 136.), 3.) * 1.7 * smoothstep(3.5, 2.5, r);
  // The sun's poles sit a little off vertical; the big helmet streamers lie along its equator.
  float pole = 1.98;
  float st = 0.;
  st += blade(th, r, pole - 1.5708 + .1, .42, 1.5, -.14) * 1.25;
  st += blade(th, r, pole - 1.5708 - .55, .28, 1., .12) * .8;
  st += blade(th, r, pole + 1.5708 - .08, .46, 1.7, .12) * 1.2;
  st += blade(th, r, pole + 1.5708 + .62, .26, .95, -.1) * .75;
  st += blade(th, r, pole + .85, .18, .7, .2) * .45;
  st += blade(th, r, pole - 2.4, .2, .8, -.2) * .5;
  // A slow swell that wanders round the corona, so it never quite sits still.
  st *= .8 + .35 * sin(th * 2. + t * .07) * sin(th * 3. - t * .05 + 1.3);
  // Polar plumes: short, fine brush strokes standing straight up off the poles.
  float pl = exp(-pow(adiff(th, pole) / .5, 2.)) + exp(-pow(adiff(th, pole + 3.1415927) / .5, 2.));
  float plumes = r < 2.5 ? pl * pow(pfbm(vec2(a * 90. + 2., lr * 1.2), 90.), 3.) * 2.2 * exp(-k / .45) : 0.;
  // The brilliant inner ring, then the K-corona falling away fast.
  float inner = exp(-k / .03) * 1.6 + exp(-k / .12) * 1.;
  float body = pow(r, -3.6) * .5;
  float I = inner * (.72 + .4 * rays) + body * (.55 + .8 * rays) + st * (.35 + .9 * rays) * .7 + plumes;
  vec3 warm = vec3(1., .9, .76);
  vec3 cool = vec3(.84, .88, 1.);
  vec3 c = mix(warm, cool, smoothstep(1.05, 2.6, r));
  c = mix(c, uA * 1.1 + .08, .18 * smoothstep(1.25, 3., r));
  return c * I * smoothstep(1., 1.004, r) * smoothstep(7., 4.2, r);
}

/* Prominences: tongues and loops of glowing pink gas standing up off the rim. They sit in front
   of the corona (rgb), and hide some of it (a). */
vec4 prominences(float r, float th) {
  float k = r - 1.;
  if (k > .4 && uErupt.y <= 0.) return vec4(0.);
  float t = uTime;
  float a = th / TAU;
  float tex = pfbm(vec2(a * 84., k * 34. - t * .3), 84.);
  float acc = 0.;
  int n = uQuality > .5 ? 5 : 3;
  for (int i = 0; i < 5; i++) {
    if (i >= n) break;
    float fi = float(i);
    float at = hash11(fi * 7.31 + 1.7) * TAU;
    float w = mix(.045, .12, hash11(fi * 3.17 + 2.9));
    float h = mix(.085, .2, hash11(fi * 5.13 + 4.1)) * (.85 + .25 * sin(t * .11 + fi * 2.));
    float d = adiff(th, at + .02 * sin(t * .07 + fi));
    float shape = exp(-pow(d / w, 2.)) * smoothstep(h, h * .15, k);
    acc += shape * smoothstep(.25, .7, tex + (1. - k / h) * .4);
  }
  // one great arch
  float d = adiff(th, 2.75);
  float e = length(vec2(d * r / .13, k / .13));
  acc += exp(-pow(e - 1., 2.) / .035) * step(0., k) * (.55 + .6 * tex);
  // …and sometimes one lifts off and erupts into space
  if (uErupt.y > 0.) {
    float p = uErupt.y;
    float s = mix(.06, uErupt.z, sqrt(p));
    float de = adiff(th, uErupt.x);
    float ee = length(vec2(de * r / (s * 1.25), k / s));
    float fade = (1. - p) * (1. - p) * smoothstep(0., .08, p);
    acc += exp(-pow(ee - 1., 2.) / (.05 + p * .1)) * step(0., k) * (.5 + .8 * tex) * fade * uErupt.w * 1.6;
  }
  // and right along the rim, the chromosphere: a whisker of pink fire peeking out round the moon
  acc += exp(-abs(r - (MOON + .005)) / .008) * (.45 + .3 * pnoise(vec2(a * 160., t * .4), 160.));
  acc = clamp(acc, 0., 1.6);
  return vec4((vec3(1., .2, .32) * 2.6 + vec3(1., .55, .6) * acc * .8) * acc, clamp(acc, 0., 1.) * .8);
}

void main() {
  vec2 frag = gl_FragCoord.xy;
  vec2 uv = frag / uRes;
  bool hq = uQuality > .5;
  vec2 par = uMouse / uRes - .5;

  // The sun (and moon) are far away; they barely move as you do.
  vec2 S = uSun.xy - par * uScale * .004;
  float R = uSun.z;
  vec2 q = (frag - S) / R;
  float r = length(q);
  vec2 u = q / max(r, 1e-4);
  float th = atan(q.y, q.x);

  float glare = uGlare.z;
  vec3 col = skyColor(uv);

  // The light of the corona, scattered through the air all around it.
  float rr = max(r, 1.);
  col += vec3(.9, .78, .7) * (.07 * uCorona * exp(-(rr - 1.) / 2.6) + .03 * uCorona * exp(-(rr - 1.) / 9.));

  // A few stars, and the planets, come out in the dark.
  float dark = smoothstep(.25, .9, uv.y) * (1. - clamp(uLight * 3. + glare * .5, 0., 1.));
  if (dark > .01) {
    vec2 sp = frag - par * uScale * .01;
    vec3 st = starField(sp, 70. * uScale / 900., .955, 3.);
    if (hq) st += starField(sp, 46. * uScale / 900., .975, 11.) * .7;
    col += st * dark * .9;
    // Venus, bright and steady, low beside the sun.
    vec2 dv = frag - (S + vec2(-4.4, -2.1) * R);
    col += vec3(1., .96, .9) * (exp(-dot(dv, dv) / 3.2) * 1.4 + exp(-length(dv) / 7.) * .08) * dark;
  }

  // ── The eclipse ──
  vec2 qm = q - uMoon;
  float rm = length(qm);
  float aa = 1.2 / R;
  float moon = 1.;
  if (rm > MOON - CRAGS - 2. * aa) {
    float edge = MOON + limb(qm / max(rm, 1e-4)) * CRAGS;
    moon = smoothstep(edge + aa, edge - aa, rm);
  }

  if (moon < 1. && r < 7.) {
    vec3 light = corona(r, th) * uCorona;
    if (r < 1.4 || (uErupt.y > 0. && r < 1. + uErupt.z * 1.6)) {
      vec4 pr = prominences(r, th);
      light = light * (1. - pr.a) + pr.rgb;
    }
    // The sun itself, wherever the moon doesn't cover it — far too bright to look at.
    float disc = smoothstep(1. + aa, 1. - aa, r);
    if (disc > 0.) light += vec3(1., .94, .82) * 46. * (.45 + .55 * sqrt(max(1. - r * r, 0.))) * disc;
    col += light * (1. - moon);
  }

  // The moon: black, but seen through the glowing air — and faintly lit by the earth.
  if (moon > 0.) {
    // earthshine shows the faintest ghost of the seas on its face
    float seas = smoothstep(.35, .7, fbm3(qm * 1.7 + 4.));
    vec3 behind = skyColor(uv) * .38 + vec3(.0062, .0064, .0078) * (1. - seas * .5);
    // and the brilliant inner corona flares a little way in over its edge, the way it does in a photograph
    behind += vec3(1., .9, .78) * exp(-(MOON - rm) / .018) * .12 * uCorona;
    col = mix(col, behind, moon);
  }

  // Baily's beads: sunlight through the valleys along the moon's edge, the moment before the
  // diamond ring — and after. (Only when the moon is a hair off center.)
  if (r > .94 && r < 1.3 && dot(uMoon, uMoon) > 1e-5) {
    float gap = 1. - (MOON + limb(u) * CRAGS + dot(u, uMoon));
    if (gap > -.01) {
      float bead = smoothstep(-.004, .012, gap);
      col += vec3(1., .9, .74) * bead * (exp(-abs(r - 1.) / .018) * 9. + exp(-abs(r - 1.) / .09) * 1.2);
    }
  }

  // ── The clouds, in front of it all (drawn at lower resolution: they're soft) ──
  vec4 cl = texture2D(uClouds, uv);
  col = col * (1. - cl.a) + cl.rgb * cl.rgb * 4.;

  // ── The diamond ring, and the glare of sunlight in the lens ──
  if (glare > 0.) {
    vec2 P = S + uGlare.xy * R;
    vec2 dv = frag - P;
    float d = length(dv);
    float core = exp(-d * d / (R * R * .006)) * 8.;
    float bloom = exp(-d / (R * .32)) * 1.4 + exp(-d / (R * 1.4)) * .35;
    float haze = .3 / (1. + pow(d / (R * 3.), 2.));
    float reach = exp(-abs(dv.x) / (uRes.x * .2));
    float streak = exp(-abs(dv.y) / (R * (.016 + .02 * exp(-abs(dv.x) / (R * 2.))))) * reach * 1.3;
    streak += exp(-abs(dv.y) / (R * .08)) * exp(-abs(dv.x) / (uRes.x * .1)) * .3;
    // a six-pointed star, from the aperture
    float spikes = 0.;
    for (int i = 0; i < 3; i++) {
      float an = float(i) * 1.0472 + .5236;
      vec2 dir = vec2(cos(an), sin(an));
      float along = dot(dv, dir);
      float across = dot(dv, vec2(-dir.y, dir.x));
      spikes += exp(-abs(across) / (R * .012)) * exp(-abs(along) / (R * 1.2));
    }
    vec3 g = vec3(1., .9, .76) * (core + bloom + haze + spikes * .5);
    g += mix(uA * 1.2 + .15, vec3(1., .92, .8), reach * reach) * streak;
    // a faint rainbow halo
    float ring = exp(-pow((d - R * 4.6) / (R * .32), 2.)) * .1;
    g += ring * (.5 + .5 * cos(TAU * ((d - R * 4.6) / (R * .9) + vec3(0., .33, .67))));
    col += g * glare;
    col += vec3(1., .78, .55) * glare * .12;   // the whole sky lifts
  }

  // The cursor: a faint, warm light in the dusk.
  float ml = exp(-pow(length(frag - uMouse) / (uScale * .4), 2.));
  col += vec3(1., .8, .62) * ml * .02 * uCursor;

  col *= 1. - uDim * .6;
  // Film: highlights roll off softly into white, like an exposure.
  col = 1. - exp(-col * 1.08);
  col *= 1. - .24 * pow(length(uv - .5) * 1.2, 2.4);
  col *= uFade;
  col += (hash12(frag + fract(uTime * 7.)) - .5) / 255.;
  gl_FragColor = vec4(max(col, 0.), 1.);
}
`;
