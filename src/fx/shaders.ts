/**
 * The sky: deep space, drifting nebula dust, sparse twinkling stars — and a living solar
 * corona that streams out from behind the editor panel, as if the panel were the moon
 * in a total eclipse. Events (flares, the diamond ring, shockwaves) drive it via uniforms.
 */

export const VERT = /* glsl */ `
attribute vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }
`;

export const FRAG = /* glsl */ `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif

uniform vec2 uRes;
uniform float uTime;
uniform vec2 uMouse;
uniform vec4 uPanel;     // center.xy, half-size.xy (buffer px, y up)
uniform float uRadius;   // panel corner radius
uniform float uShape;    // 0 = rounded rect, 1 = circle (radius = uPanel.z)
uniform vec3 uA;         // accent
uniform vec3 uB;         // secondary nebula hue
uniform float uEnergy;   // ambient activity (lowered while writing)
uniform float uFlare;    // corona flare 0..1
uniform float uDim;      // eclipse darkening 0..1
uniform vec4 uRing;      // diamond ring: xy, intensity, -
uniform vec4 uShock0;
uniform vec4 uShock1;
uniform vec4 uShock2;    // shockwaves: xy, age 0..1, strength
uniform float uScale;    // min(uRes)
uniform float uQuality;  // 1 = full, 0 = light

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

float fbm(vec2 p) {
  float v = 0.;
  float a = .5;
  mat2 r = mat2(.8, .6, -.6, .8);
  for (int i = 0; i < 5; i++) {
    v += a * vnoise(p);
    p = r * p * 2.03 + 11.7;
    a *= .5;
  }
  return v;
}

vec3 starLayer(vec2 p, float cell, float thresh, float seed) {
  vec2 g = p / cell;
  vec2 id = floor(g);
  vec2 f = fract(g);
  float h = hash12(id + seed);
  if (h < thresh) return vec3(0.);
  vec2 pos = vec2(hash12(id + seed + 3.1), hash12(id + seed + 7.7)) * .5 + .25;
  vec2 d = (f - pos) * cell;
  float r2 = dot(d, d);
  float mag = (h - thresh) / (1. - thresh);
  float size = mix(.55, 1.7, mag * mag);
  float tw = .55 + .45 * sin(uTime * (.8 + h * 3.) + h * 70.);
  float core = exp(-r2 / (size * size));
  float halo = exp(-sqrt(r2) / (size * 3.)) * .12 * mag;
  vec3 tint = mix(vec3(1.), mix(uA, uB, hash12(id + seed + 9.)), .4);
  return tint * (core + halo) * tw * (.25 + .75 * mag);
}

float sdRoundBox(vec2 p, vec2 b, float r) {
  vec2 q = abs(p) - b + r;
  return length(max(q, 0.)) + min(max(q.x, q.y), 0.) - r;
}

vec2 shock(vec4 s, vec2 p, inout float light) {
  if (s.w <= 0.) return p;
  vec2 dv = p - s.xy;
  float d = length(dv);
  float R = s.z * uScale * 1.5;
  float w = uScale * .05;
  float band = exp(-pow((d - R) / w, 2.));
  float fade = 1. - s.z;
  light += band * fade * fade * s.w;
  return p - (dv / max(d, 1.)) * band * s.w * fade * uScale * .03;
}

void main() {
  vec2 frag = gl_FragCoord.xy;
  vec2 uv = frag / uRes;
  float shockLight = 0.;
  vec2 p = frag;
  p = shock(uShock0, p, shockLight);
  p = shock(uShock1, p, shockLight);
  p = shock(uShock2, p, shockLight);

  vec2 par = uMouse / uRes - .5;
  float live = .45 + .55 * uEnergy;

  // Deep sky.
  vec3 col = mix(vec3(.008, .008, .012), vec3(.014, .014, .022), uv.y);

  // Nebula: glowing gas folding in on itself, threaded with bright filaments
  // and crossed by dark dust lanes. It gathers into great clouds in places.
  vec2 np = (p - par * 50.) / uScale * 1.1;
  float t = uTime * .014;
  vec2 q = vec2(fbm(np + vec2(t, -t * .6)), fbm(np + vec2(4.1, 7.3) - t * .8));
  float n = fbm(np * 1.3 + 2.1 * q + vec2(t * .5, -t * .2));
  float region = smoothstep(.3, .75, fbm(np * .42 + vec2(7.3, 1.1) + t * .3));
  vec3 neb = mix(uB, uA, smoothstep(.25, .85, q.y));
  neb = mix(neb, mix(uB, vec3(1.), .3), smoothstep(.62, .92, n) * .5);
  float gas = smoothstep(.32, .92, n);
  col += neb * gas * (.08 + .5 * region) * live;
  if (uQuality > .5) {
    float fil = pow(1. - abs(2. * fbm(np * 2.6 + 2.6 * q + 3.3) - 1.), 7.);
    col += mix(neb, vec3(1.), .35) * fil * region * gas * .36 * live;
    float lane = smoothstep(.52, .3, fbm(np * .9 + 2. * q.yx + 5.1));
    col *= 1. - lane * region * .6;
  }

  // Stars at three depths of parallax; the faint dense ones crowd into the clouds.
  col += starLayer(p + par * 14. + vec2(uTime * 1.2, 0.), 64., .88, 1.) * .85;
  if (uQuality > .5) {
    col += starLayer(p + par * 32. + vec2(uTime * 2.6, uTime * .4), 110., .92, 7.) * 1.1;
    col += starLayer(p + par * 6. + vec2(uTime * .5, 0.), 24., .8, 13.) * (.18 + .6 * region);
  }

  // The corona: light pouring out from behind the panel.
  vec2 pc = p - uPanel.xy;
  float d = uShape > .5 ? length(pc) - uPanel.z : sdRoundBox(pc, uPanel.zw, uRadius);
  float ang = atan(pc.y, pc.x);
  float dn = max(d, 0.) / uScale;
  float flow = uTime * .07;
  float s1 = fbm(vec2(ang * 5. + sin(ang * 2. + flow) * .6, dn * 5. - flow * 1.4));
  float s2 = uQuality > .5 ? fbm(vec2(ang * 17. - flow * .4, dn * 13. - flow * 3.2)) : .5;
  float rays = pow(s1, 2.4) * 1.9 + pow(s2, 3.2) * 1.1;
  // Streamers: long thin rays that carry the light far out across the sky, flowing outward.
  float st = pow(fbm(vec2(ang * 7. + 1.3, dn * 1.5 - flow * .8)), 3.) * 2.4;
  if (uQuality > .5) st += pow(fbm(vec2(ang * 23. + 7.7, dn * 2.6 - flow * 1.3)), 4.) * 1.8;
  // Solar wind: a slow lobe of brighter light circling the corona.
  float gust = pow(.5 + .5 * sin(ang - uTime * .33), 9.) * .9 + pow(.5 + .5 * sin(ang * 2. + uTime * .21 + 1.7), 14.) * .5;
  // Flares are local: strongest near the focus point (the diamond ring or an eruption).
  float near = exp(-length(p - uRing.xy) / (uScale * .5));
  float reach = .034 + .05 * uFlare * (.25 + .75 * near) + .01 * uEnergy;
  float outer = exp(-dn / reach);
  float halo = exp(-dn / (reach * 3.4)) * .3;
  float rim = exp(-abs(d) / (uScale * .0045));
  float inside = d < 0. ? exp(d / (uScale * .006)) : 1.;
  // The broad glow belongs to the sky around the panel only. Inside it, anything that
  // depends on the angle from the panel's center would pinch to a point right there.
  float around = smoothstep(-uScale * .012, 0., d);
  vec2 lightDir = normalize(uMouse - uPanel.xy + vec2(1e-3));
  float side = .62 + .38 * dot(pc / max(length(pc), 1.), lightDir);
  float power = (.45 + .35 * uEnergy) * (1. + uFlare * (.5 + 2.8 * near)) * (1. - uDim * .85);
  vec3 hot = mix(uA, vec3(1.), .55);
  float far = exp(-dn / (.13 + .05 * uEnergy + .12 * uFlare * near));
  col += mix(uA, uB, .25) * halo * power * .3 * side * around;
  col += mix(uB, uA, .6) * exp(-dn / .3) * .035 * power * (1. + gust * .6) * around;
  col += mix(hot, uA, .35) * st * far * .24 * (1. + gust * .8) * side * power * inside;
  col += hot * outer * (.11 + rays * .3) * (1. + gust) * side * power * inside;
  col += mix(hot, vec3(1.), .5) * rim * .38 * side * power * inside;

  // Diamond ring: a single blinding point of sunlight on the rim.
  if (uRing.z > 0.) {
    vec2 dv = p - uRing.xy;
    float r = length(dv);
    float core = exp(-r * r / (uScale * uScale * .00035));
    float glow = exp(-r / (uScale * .045)) * .7;
    float h = exp(-abs(dv.y) / (uScale * .0035)) * exp(-abs(dv.x) / (uScale * .38));
    float v = exp(-abs(dv.x) / (uScale * .003)) * exp(-abs(dv.y) / (uScale * .11)) * .45;
    col += (vec3(1.) * core * 2.4 + hot * (glow + h + v)) * uRing.z;
  }

  col += hot * shockLight * .28;

  // The cursor is a faint light source in the sky.
  float ml = exp(-pow(length(frag - uMouse) / (uScale * .42), 2.));
  col += uA * ml * .028 * live;

  col *= 1. - uDim * .55;
  col *= 1. - .26 * pow(length(uv - .5) * 1.2, 2.2);
  col += (hash12(frag + fract(uTime * 7.)) - .5) / 255.;
  gl_FragColor = vec4(max(col, 0.), 1.);
}
`;
