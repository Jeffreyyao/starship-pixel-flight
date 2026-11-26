// Starship: Pixel Flight. A game on the pixel-art splat renderer.
//
// The ship, its flaps and legs, the tower, the
// chopstick arms, the pads and the high bay are SDF shapes sampled into
// surfels in the browser, each in its own three.js Group. Lighting, the
// engine plume, reentry plasma, steam and explosions are Spark modifiers.
//
// Two missions (src/physics.js): a catch from a 2.4 km belly-flop,
// and a hop from pad A to pad B. The menu plays the scripted catch from
// src/flight.js behind it.

import * as THREE from "three";
import { SparkRenderer, SplatMesh, dyno } from "@sparkjsdev/spark";
import { buildShip, buildSite, buildGround, buildBooster, BOOSTER_H, M, MAT_SCALE, COM_Y, ENGINES, CATCH, ARM_Y, TOWER_H, BUILDING, PAD_A, PAD_B, PAD_R, OLM_R, OLM_TOP } from "./model.js";
import { newOrbitGame, step as orbitStep, altOf, elements, guidePitch, reentryPitch, landingError, predictPath, handoff, attitude, local as orbitLocal, ORBIT_DIFF, ATMO, HANDOFF_ALT, MU } from "./orbit.js";
import { buildEarth, EARTH_R, KM } from "./earth.js";
import { flightState, T_CATCH, T_END, T_IGNITE, smooth, lerp } from "./flight.js";
import { MISSIONS, DIFFICULTY, newGame, step as physicsStep, shipPoints, stoppingDistance, U } from "./physics.js";
import { createUI } from "./ui.js";
import { createTouchControls, isTouchDevice } from "./touch.js";
import { hexToRgb, mulberry32 } from "./engine/noise.js";
import { createPost } from "./engine/post.js";
import { showLoading, defaultPixel, portraitFit, viewportSize } from "./engine/screen.js";

THREE.ColorManagement.enabled = false;

// ---------------------------------------------------------------- themes
// Each colour ramp has a night and a day version. The shaders pick one with a
// single value (DAYV), so switching costs nothing; the pixel pass swaps the
// palette and sky to match.
const NIGHT_RAMPS = {
  steel: ["#0e1428", "#1d2542", "#333d5e", "#56617f", "#8590ab", "#b9c2d4", "#e8ecf3"],
  tile: ["#06070d", "#10121c", "#1c2030", "#2d3246"],
  tower: ["#0a0d1b", "#151a2d", "#242a43", "#38405d", "#59627f"],
  conc: ["#121625", "#22283a", "#383e53", "#585e73", "#80869a"],
  sand: ["#15121b", "#2a232d", "#463a3e", "#6a584f", "#917a66"],
  ocean: ["#040817", "#091830", "#112c55", "#1d4878", "#3d6fa3", "#8fb0d6"],
  warm: ["#5a1810", "#ac361a", "#ec661e", "#ffa238", "#ffd674", "#fff5d6"],
  red: ["#3e0d14", "#9c1f2a", "#ff4848"],
  grass: ["#0e1816", "#1b2b24", "#2c4234"],
  plasma: ["#4a1a5a", "#a2348a", "#ff66a6", "#ffc2dc"],
  cloud: ["#151a2d", "#242a43", "#38405d", "#59627f"],
};
const DAY_RAMPS = {
  steel: ["#2b3244", "#4b5569", "#6f7a90", "#9aa5b8", "#c3ccd8", "#e4e9ef", "#ffffff"],
  tile: ["#0b0c12", "#171a24", "#262a38", "#3a4054"],
  tower: ["#232a38", "#363f52", "#4f5a6e", "#6f7a90", "#959fb3"],
  conc: ["#55575d", "#76787d", "#9a9b9e", "#bdbdbc", "#dcdad4"],
  sand: ["#7a6248", "#9c805d", "#bd9f75", "#d9bf90", "#eedcb3"],
  ocean: ["#0a3150", "#0f4a74", "#176894", "#2689b5", "#4fb0d1", "#a9e2e8"],
  warm: NIGHT_RAMPS.warm,
  red: NIGHT_RAMPS.red,
  grass: ["#44532a", "#5d7038", "#7c9149"],
  plasma: NIGHT_RAMPS.plasma,
  cloud: ["#9aa5b8", "#c3ccd8", "#e4e9ef", "#ffffff"],
};
const norm3 = (v) => { const l = Math.hypot(...v); return v.map((x) => x / l); };
const THEMES = {
  night: { label: "NIGHT", ramps: NIGHT_RAMPS, sky: ["#1a2850", "#121d40", "#0c1532", "#081024", "#060a1a"], fog: "#121c3d", key: norm3([-0.45, 0.55, 0.7]), disc: "#f4f2ea" },
  day: { label: "DAY", ramps: DAY_RAMPS, sky: ["#d6e7f0", "#b6d6ec", "#93c1e7", "#70a7dd", "#5089cc"], fog: "#c8ddeb", key: norm3([-0.6, 0.62, 0.5]), disc: "#fff6dc" },
};
// the planet from orbit, and the space palette (the ship keeps its night colours)
const EARTH_RAMPS = {
  eocean: ["#06142e", "#0b2a55", "#124487", "#1f64b0", "#3f8bd0", "#8cc4ea"],
  eland: ["#16301a", "#24502a", "#3a7034", "#5a8f3e"],
  edesert: ["#6b5434", "#9c7c4a", "#c9a86a"],
  eice: ["#9fb3c8", "#cfdbe6", "#f4f8fb"],
  enight: ["#03050c", "#070c1c", "#0d1630"],
  erock: ["#4a4038", "#6e6252"],
};
const SPACE_BG = "#020309";
const ATMO_GLOW = ["#2a5aa8", "#4f8fe0", "#9cc8f0"];
const SPACE_PALETTE = [SPACE_BG, ...Object.values(EARTH_RAMPS).flat(), ...["steel", "tile", "tower", "warm", "red", "plasma"].flatMap((k) => NIGHT_RAMPS[k]), "#f4f2ea", "#fff6dc"];
const BEAM = "#4fd0b0";
const GLOW = ["#5a4024", "#33291e", "#232a48", "#6a3a22", "#2f7a6a", BEAM, "#f3e2b0"]; // colours only halos, beams and the sky may take
const surfacePalette = (th) => [...new Set([...Object.values(th.ramps).flat(), th.disc])];
let themeName = "night";
const isDay = () => themeName === "day";

const params = new URLSearchParams(location.search);
const dpr = Math.min(window.devicePixelRatio || 1, 2);
const state = {
  pixel: Number(params.get("px")) || 0, quant: params.get("quant") !== "0", dither: 0, idle: false, crisp: true,
  ss: params.get("ss") === "0" ? 1 : 2, outline: params.get("outline") !== "0",
};

// ---------------------------------------------------------------- renderer
const renderer = new THREE.WebGLRenderer({ antialias: false, preserveDrawingBuffer: true });
renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
renderer.setPixelRatio(dpr);
document.body.appendChild(renderer.domElement);
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(32, 1, 0.05, 320);
const spark = new SparkRenderer({ renderer, falloff: 0, maxStdDev: 1.5, blurAmount: 0, preBlurAmount: 0.3 });
scene.add(spark);

const rt = new THREE.WebGLRenderTarget(1, 1, { minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, type: THREE.HalfFloatType });
const post = createPost();
post.setOutline(state.outline);

// ---------------------------------------------------------------- shading
const uTime = dyno.dynoFloat(0);
const uCam = dyno.dynoVec3(new THREE.Vector3());
const uEng = dyno.dynoVec3(new THREE.Vector3(0, -50, 0)); // engine (or fireball) light position, world
const uFx = dyno.dynoVec4(new THREE.Vector4()); // engine light, throttle, steam, plasma
const uFog = dyno.dynoVec2(new THREE.Vector2(10, 50));
const uAux = dyno.dynoVec4(new THREE.Vector4(0, CATCH[2], -1, 0)); // steam x, steam z, explosion age (<0 none), day (0/1)
const uBoom = dyno.dynoVec3(new THREE.Vector3()); // explosion centre
const uEx = dyno.dynoVec4(new THREE.Vector4(0, 1, 0, 0)); // sun direction (in space), booster throttle

const glslRamp = (name, hexes) => `
vec3 ${name}(float l) {
  const vec3 c[${hexes.length}] = vec3[${hexes.length}](${hexes.map((h) => `vec3(${hexToRgb(h).map((v) => v.toFixed(4)).join(",")})`).join(",")});
  l = clamp(l, 0.0, 1.0) * ${(hexes.length - 1).toFixed(1)};
  int i = int(floor(l));
  return mix(c[i], c[min(i + 1, ${hexes.length - 1})], fract(l));
}`;
const vec3s = (hex) => `vec3(${hexToRgb(hex).map((v) => v.toFixed(4)).join(",")})`;
const vec3n = (v) => `vec3(${v.map((x) => x.toFixed(4)).join(",")})`;
const GLOBALS = `
float ss_hash11(float p) { p = fract(p * 0.1031); p *= p + 33.33; p *= p + p; return fract(p); }
vec4 ss_hash41(float p) {
  vec4 p4 = fract(vec4(p) * vec4(0.1031, 0.1030, 0.0973, 0.1099));
  p4 += dot(p4, p4.wzxy + 33.33);
  return fract((p4.xxyz + p4.yzzw) * p4.zywx);
}
${Object.keys(NIGHT_RAMPS).map((k) => `${glslRamp(`ss_${k}_n`, NIGHT_RAMPS[k])}\n${glslRamp(`ss_${k}_d`, DAY_RAMPS[k])}\n#define ss_${k}(l) (DAYV > 0.5 ? ss_${k}_d(l) : ss_${k}_n(l))`).join("\n")}
#define SS_FOG (DAYV > 0.5 ? ${vec3s(THEMES.day.fog)} : ${vec3s(THEMES.night.fog)})
#define SS_BG SS_FOG
#define SS_KEY (DAYV > 0.5 ? ${vec3n(THEMES.day.key)} : ${vec3n(THEMES.night.key)})
${Object.entries(EARTH_RAMPS).map(([k, v]) => glslRamp(`ss_${k}`, v)).join("\n")}
// the coastline (scene units), as in model.js
float ss_shore(float x) { return 3.4 + 0.35 * sin(x * 0.55) + 0.2 * sin(x * 1.7 + 1.0); }
const vec3 SS_ENG[3] = vec3[3](${ENGINES.map(([x, z]) => `vec3(${x.toFixed(4)}, 0.0, ${z.toFixed(4)})`).join(",")});`;

// extra: { name: [glsl type, dyno value] } for inputs only one modifier uses
function fx(body, extra = {}) {
  const ex = Object.entries(extra);
  return dyno.dynoBlock({ gsplat: dyno.Gsplat }, { gsplat: dyno.Gsplat }, ({ gsplat }) => {
    const d = new dyno.Dyno({
      inTypes: { gsplat: dyno.Gsplat, t: "float", cam: "vec3", eng: "vec3", fx: "vec4", fog: "vec2", aux: "vec4", boom: "vec3", ex: "vec4", ...Object.fromEntries(ex.map(([k, [t]]) => [k, t])) },
      outTypes: { gsplat: dyno.Gsplat },
      inputs: { gsplat, t: uTime, cam: uCam, eng: uEng, fx: uFx, fog: uFog, aux: uAux, boom: uBoom, ex: uEx, ...Object.fromEntries(ex.map(([k, [, v]]) => [k, v])) },
      globals: () => [GLOBALS],
      statements: ({ inputs, outputs }) => [`${outputs.gsplat} = ${inputs.gsplat};`, `{ float DAYV = ${inputs.aux}.w;`, body(inputs, outputs.gsplat), "}"],
    });
    return { gsplat: d.outputs.gsplat };
  });
}

// World-space lighting. rgba carries (material/16, painted detail, baked AO).
const shadeFx = () =>
  fx((i, g) => `{
    vec3 n = quatVec(${g}.quaternion, vec3(0.0, 0.0, 1.0));
    vec3 p = ${g}.center;
    int m = int(floor(${g}.rgba.r * ${MAT_SCALE.toFixed(1)} + 0.5));
    float det = ${g}.rgba.g, ao = ${g}.rgba.b, t = ${i.t};
    float engk = ${i.fx}.x, thr = ${i.fx}.y, plasma = ${i.fx}.w;

    bool day = DAYV > 0.5;
    vec3 key = SS_KEY;
    vec3 V = normalize(${i.cam} - p);

    // moonlight (or sunlight) from over the sea, some sky from above
    float ndl = dot(n, key);
    float l = (day ? 0.3 : 0.14) + (day ? 0.66 : 0.72) * clamp(ndl * 0.75 + 0.25, 0.0, 1.0);
    l *= mix(0.45, 1.0, ao);
    l += (day ? 0.1 : 0.07) * max(n.y, 0.0) + (det - 0.5) * 0.5;

    // the engines (or a fireball) light everything around them
    vec3 lv = ${i.eng} - p;
    float ld = length(lv);
    float lw = engk * (max(dot(n, lv / ld), 0.0) * 0.9 + 0.1) / (1.0 + ld * ld * 1.1) * (day ? 0.45 : 1.0);
    // floodlights on the tower face (night only)
    vec3 fv = vec3(0.0, 1.1, 0.55) - p;
    float fd = length(fv);
    float fw = day ? 0.0 : 0.4 * max(dot(n, fv / fd), 0.0) / (1.0 + fd * fd * 1.6);

    vec3 col;
    bool lit = true;
    if (m == ${M.steel} || m == ${M.pin}) col = ss_steel(l * 1.0 + 0.1);
    else if (m == ${M.tile}) { col = ss_tile(l * 0.8); col += vec3(1.0, 0.3, 0.6) * plasma * 0.55 * max(-n.y, 0.0); }
    else if (m == ${M.dark}) col = ss_tile(l * 0.25);
    else if (m == ${M.bell}) col = mix(ss_steel(l * 0.6), ss_warm(0.45 + 0.5 * det), thr * det * 0.9);
    else if (m == ${M.tower}) col = ss_tower(l * 0.9);
    else if (m == ${M.rail}) col = ss_steel(l * 0.85);
    else if (m == ${M.concrete}) col = ss_conc(l * 0.85);
    else if (m == ${M.grass}) col = ss_grass(l * 0.95);
    else if (m == ${M.tank}) col = ss_steel(l * 0.9 + 0.08);
    else if (m == ${M.paint}) col = ss_warm(0.3 + l * 0.42);
    else if (m == ${M.sand}) {
      float sd = p.z - ss_shore(p.x); // < 0 on land
      col = ss_sand(l * 0.85 + (day ? 0.05 : 0.0));
      if (sd > -0.34) {
        // wet sand: darker, and shiny where it catches the light
        col = ss_sand(l * 0.55);
        if (pow(max(dot(reflect(-V, n), key), 0.0), 20.0) > 0.5 + 0.3 * det) col = ss_ocean(0.86);
        // thin sheets of water run up the beach and drain back
        if (sd + 0.2 + 0.13 * sin(t * 0.8 + p.x * 1.3) > 0.0) col = ss_ocean(0.66 + 0.12 * sin(p.x * 9.0 + t * 2.0));
      }
    }
    else if (m == ${M.ocean}) {
      float sd = p.z - ss_shore(p.x); // > 0 out to sea
      float depth = sqrt(clamp(sd / 8.0, 0.0, 1.0));
      // a long swell over everything; each splat tips its normal a little,
      // so the light breaks into glitter
      float a1 = p.x * 1.7 + p.z * 0.9 - t * 0.7, a2 = p.x * 0.6 - p.z * 2.3 + t * 0.5;
      float sw = 0.5 * sin(a1) + 0.5 * sin(a2);
      vec3 wn = normalize(vec3(0.14 * cos(a1) + 0.05 * cos(a2) + (det - 0.5) * 0.4, 1.0,
                               0.08 * cos(a1) - 0.12 * cos(a2) + (fract(det * 7.13) - 0.5) * 0.4));
      col = ss_ocean(mix(0.64, 0.2, depth) + 0.07 * sw + (day ? 0.06 : 0.0));
      // a glitter path towards the moon or the sun
      float spec = pow(max(dot(reflect(-V, wn), key), 0.0), day ? 80.0 : 50.0);
      if (spec > 0.4) col = ss_ocean(1.0);
      else if (spec > 0.13) col = ss_ocean(0.84);
      // breakers roll in towards the beach and foam as they go
      float roll = sin(sd * 5.5 - t * 1.3 + 1.6 * sin(p.x * 0.7));
      float shoal = 1.0 - smoothstep(0.3, 2.8, sd);
      if (roll > 0.93 - 0.08 * shoal && shoal > 0.05) col = ss_ocean(shoal > 0.5 ? 1.0 : 0.84);
      // the surf line, moving up and down the sand
      if (sd < 0.1 + 0.07 * sin(t * 0.8 + p.x * 1.3)) col = ss_ocean(det > 0.45 ? 1.0 : 0.84);
      lw *= 0.6;
    }
    else if (m == ${M.lamp}) { col = ss_warm(day ? 0.7 : 0.86 + 0.03 * sin(t * 13.0 + p.y * 9.0)); lit = false; }
    else { col = ss_red(fract(t * 0.7 + p.y * 0.3) < 0.5 ? 1.0 : 0.15); lit = false; }
    if (lit) col += vec3(1.0, 0.56, 0.22) * lw * 1.4 + vec3(1.0, 0.82, 0.55) * fw * 0.5;
    float fogk = smoothstep(${i.fog}.x, ${i.fog}.y, length(p - ${i.cam}));
    col = mix(col, SS_BG, fogk * (lit ? 0.9 : 0.5));
    ${g}.rgba = vec4(col, 1.0);
  }`);

// The plume: splats stream out of the three sea-level bells (ship space).
const plumeFx = () =>
  fx((i, g) => `{
    float id = float(${g}.index), thr = ${i.fx}.y, t = ${i.t};
    vec4 r = ss_hash41(id + 3.0);
    vec3 e = SS_ENG[int(mod(id, 3.0))];
    float c = fract(t * 2.6 * (0.8 + 0.4 * r.x) + r.y);
    float len = 0.95 * thr * (0.86 + 0.14 * sin(t * 37.0 + r.z * 6.0));
    float a = r.z * 6.2832, rad = (0.008 + c * 0.06) * sqrt(r.w);
    vec3 p = e + vec3(cos(a) * rad, -0.01 - c * len, sin(a) * rad);
    float diamonds = 0.12 * sin(c * 38.0);
    ${g}.center = p;
    ${g}.scales = vec3(0.011 + 0.022 * c);
    float keep = step(c, 1.0 - 0.55 * r.x) * step(0.02, thr);
    ${g}.rgba = vec4(ss_warm(1.0 - c * 1.05 + diamonds), keep);
    if (keep < 0.5) ${g}.scales = vec3(0.0);
  }`);

// Reentry plasma flowing around the belly (ship space).
const plasmaFx = () =>
  fx((i, g) => `{
    float id = float(${g}.index), pl = ${i.fx}.w, t = ${i.t};
    vec4 r = ss_hash41(id + 11.0);
    float c = fract(t * 1.8 * (0.7 + 0.6 * r.x) + r.y);
    float side = r.z < 0.5 ? -1.0 : 1.0;
    float th = -1.5708 + side * c * 2.3;
    float rad = 0.2 + 0.03 * r.w + 0.06 * c;
    ${g}.center = vec3(cos(th) * rad, 0.08 + r.w * 1.82, sin(th) * rad - 0.02);
    ${g}.scales = vec3(0.012 + 0.012 * (1.0 - c));
    float keep = step(r.x * 0.9 + c * 0.5, pl * 1.2);
    ${g}.rgba = vec4(ss_plasma(1.0 - c * 0.9), keep);
    if (keep < 0.5) ${g}.scales = vec3(0.0);
  }`);

// Steam and dust thrown out across the ground under the engines (world space).
const steamFx = () =>
  fx((i, g) => `{
    float id = float(${g}.index), dust = ${i.fx}.z, engk = ${i.fx}.x, t = ${i.t};
    vec4 r = ss_hash41(id + 7.0);
    float c = fract(t * 0.32 * (0.7 + 0.6 * r.x) + r.y);
    float a = r.z * 6.2832, rad = 0.2 + c * (1.4 + 1.3 * r.x);
    vec3 p = vec3(${i.aux}.x + cos(a) * rad, 0.04 + c * (0.12 + 0.55 * r.w) * (0.4 + c), ${i.aux}.y + sin(a) * rad);
    ${g}.center = p;
    ${g}.scales = vec3(0.025 + 0.075 * c);
    float keep = step(r.w * 0.85 + c * 0.25, dust);
    vec3 col = mix(ss_conc(0.95 - 0.55 * c), ss_warm(0.55 - 0.2 * c), clamp(engk * 1.4 * (1.0 - c), 0.0, 1.0));
    col = mix(col, SS_BG, smoothstep(${i.fog}.x, ${i.fog}.y, length(p - ${i.cam})) * 0.85);
    ${g}.rgba = vec4(col, keep);
    if (keep < 0.5) ${g}.scales = vec3(0.0);
  }`);

// A crash: a fireball that blooms, then rolls up into smoke (world space).
const boomFx = () =>
  fx((i, g) => `{
    float id = float(${g}.index), age = ${i.aux}.z;
    vec4 r = ss_hash41(id + 23.0);
    vec3 dir = normalize(vec3(r.x - 0.5, r.y * 0.9 - 0.25, r.z - 0.5) + 1e-3);
    float reach = (0.35 + 1.4 * r.w) * (1.0 - exp(-age * 2.4));
    vec3 p = ${i.boom} + dir * reach + vec3(0.0, age * age * 0.05 * (0.5 + r.x) + age * 0.18 * r.y, 0.0);
    p.y = max(p.y, 0.03);
    float hot = clamp(1.0 - age * 0.55 - r.x * 0.3, 0.0, 1.0);
    vec3 col = hot > 0.05 ? ss_warm(0.25 + hot * 0.8) : ss_tower(0.25 + 0.4 * r.y);
    float keep = step(0.0, age) * step(age * 0.11 + r.z * 0.5, 1.0);
    ${g}.center = p;
    ${g}.scales = vec3((0.03 + 0.07 * r.x) * (0.5 + min(age, 2.0) * 0.6) * keep);
    col = mix(col, SS_BG, smoothstep(${i.fog}.x, ${i.fog}.y, length(p - ${i.cam})) * 0.8);
    ${g}.rgba = vec4(col, keep);
  }`);

// Clouds: each puff carries its shade in red; the theme picks the colours.
const cloudFx = () =>
  fx((i, g) => `{
    vec3 col = ss_cloud(${g}.rgba.r);
    col = mix(col, SS_FOG, smoothstep(${i.fog}.x, ${i.fog}.y * 1.6, length(${g}.center - ${i.cam})) * 0.7);
    ${g}.rgba = vec4(col, 1.0);
  }`);

// Halos fade with the engine (the plume glow) or pulse gently (lamps).
const haloFx = (engine) =>
  fx((i, g) => engine
    ? `{ ${g}.rgba.a *= step(0.02, ${i.fx}.y) * (0.85 + 0.15 * sin(${i.t} * 29.0 + float(${g}.index))); ${g}.scales *= 0.6 + 0.4 * ${i.fx}.y; }`
    : `{ ${g}.rgba.a *= 0.9 + 0.1 * sin(${i.t} * 2.0 + float(${g}.index)); }`);

// The target beam: rings that drift upwards so the column reads as a marker.
const beamFx = () =>
  fx((i, g) => `{
    float id = float(${g}.index);
    ${g}.center.y += mod(${i.t} * 0.6, 0.7);
    // fades out near the camera, so it marks the spot without blocking the view
    ${g}.rgba.a *= (0.85 + 0.15 * sin(${i.t} * 3.0 + id * 0.05)) * smoothstep(3.5, 8.0, length(${g}.center - ${i.cam}));
    // and never wraps around the ship itself (eng is just below its engines)
    float dy = ${g}.center.y - ${i.eng}.y;
    if (dy > -1.0 && dy < 3.0 && length(${g}.center.yz - ${i.eng}.yz) < 3.5) ${g}.rgba.a = 0.0;
  }`);

// The planet's surface, lit by the sun: oceans with a glint, land, deserts,
// ice; the night side goes dark with city lights; a warm band at sunset.
const earthFx = () =>
  fx((i, g) => `{
    vec3 p = ${g}.center, n = normalize(p), sun = normalize(${i.ex}.xyz), V = normalize(${i.cam} - p);
    int m = int(floor(${g}.rgba.r * ${MAT_SCALE.toFixed(1)} + 0.5));
    float det = ${g}.rgba.g, ndl = dot(n, sun);
    float lit = smoothstep(-0.05, 0.14, ndl), l = 0.3 + 0.7 * clamp(ndl, 0.0, 1.0);
    vec3 day;
    if (m == 0) { day = ss_eocean(0.2 + 0.45 * l - 0.22 * det); if (pow(max(dot(reflect(-V, n), sun), 0.0), 36.0) > 0.45) day = ss_eocean(1.0); }
    else if (m == 1) day = ss_eland(l * 0.85 + (det - 0.5) * 0.35);
    else if (m == 2) day = ss_edesert(l * 0.85 + (det - 0.5) * 0.3);
    else if (m == 3) day = ss_eice(0.3 + 0.7 * l);
    else day = ss_erock(l * 0.9);
    vec3 night = ss_enight(m == 0 ? 0.05 : 0.5);
    if ((m == 1 || m == 2) && det > 0.84) night = ss_warm(det > 0.92 ? 0.86 : 0.6); // city lights
    vec3 col = mix(night, day, lit);
    if (ndl > -0.04 && ndl < 0.09 && m != 3) col = mix(col, ss_warm(0.28 + 0.3 * l), 0.5);
    ${g}.rgba = vec4(col, 1.0);
  }`);
// clouds over the planet: bright by day, dark at night (density in red)
const earthCloudFx = () =>
  fx((i, g) => `{
    vec3 n = normalize(${g}.center);
    float ndl = dot(n, normalize(${i.ex}.xyz)), lit = smoothstep(-0.05, 0.14, ndl);
    vec3 col = mix(ss_enight(0.9), ss_eice(0.45 + 0.55 * clamp(ndl, 0.0, 1.0) - 0.3 * (1.0 - ${g}.rgba.r)), lit);
    ${g}.rgba = vec4(col, 1.0);
  }`);
// the atmosphere: a translucent shell kept only where it is seen edge-on
const atmoFx = () =>
  fx((i, g) => `{
    vec3 p = ${g}.center, n = normalize(p), V = normalize(${i.cam} - p);
    float rim = 1.0 - abs(dot(n, V)), day = smoothstep(-0.3, 0.3, dot(n, normalize(${i.ex}.xyz)));
    float a = 0.34 * smoothstep(0.6, 0.97, rim) * (0.3 + 0.7 * day);
    ${g}.rgba = vec4(mix(${vec3s(ATMO_GLOW[0])}, ${vec3s(ATMO_GLOW[2])}, day * rim), a);
  }`);
// Super Heavy's plume: 33 engines in three rings, merging into one column
const boosterPlumeFx = () =>
  fx((i, g) => `{
    float id = float(${g}.index), thr = ${i.ex}.w, t = ${i.t};
    vec4 r = ss_hash41(id + 31.0);
    float k = mod(id, 33.0), rr, a;
    if (k < 3.0) { rr = 0.03; a = k * 2.094; } else if (k < 13.0) { rr = 0.085; a = (k - 3.0) * 0.628 + 0.3; } else { rr = 0.145; a = (k - 13.0) * 0.314 + 0.1; }
    float c = fract(t * 2.3 * (0.8 + 0.4 * r.x) + r.y);
    float len = 1.6 * thr * (0.86 + 0.14 * sin(t * 33.0 + r.z * 6.0));
    float b = r.z * 6.2832, spread = (0.01 + c * 0.13) * sqrt(r.w);
    vec3 p = vec3(cos(a) * rr * (1.0 - 0.5 * c), 0.0, sin(a) * rr * (1.0 - 0.5 * c)) + vec3(cos(b) * spread, -0.01 - c * len, sin(b) * spread);
    ${g}.center = p;
    ${g}.scales = vec3(0.013 + 0.04 * c);
    float keep = step(c, 1.0 - 0.5 * r.x) * step(0.02, thr);
    ${g}.rgba = vec4(ss_warm(1.0 - c * 1.05 + 0.1 * sin(c * 30.0)), keep);
    if (keep < 0.5) ${g}.scales = vec3(0.0);
  }`);

// A facility shattering where the ship hit it: what stands above the impact
// leans over and falls away from the ship; pieces near the impact are blown
// out, fall and settle as rubble. One per facility mesh, in its own space:
//   C impact point; A (age, blast radius, topple direction, topple radius);
//   K the axis the upper part stands on (x, z)
function makeShatter() {
  const C = dyno.dynoVec3(new THREE.Vector3()), A = dyno.dynoVec4(new THREE.Vector4(-1, 1, 1, 0)), K = dyno.dynoVec2(new THREE.Vector2());
  const mod = fx((i, g) => `{
    float age = ${i.sA}.x;
    if (age >= 0.0) {
      vec3 p0 = ${g}.center, p = p0, c = ${i.sC};
      vec4 r = ss_hash41(float(${g}.index) + 17.0);
      bool moved = false;
      if (${i.sA}.w > 0.0 && p.y > c.y - 0.04 && length(p.xz - ${i.sK}) < ${i.sA}.w) {
        float ang = ${i.sA}.z * min(1.52, 0.32 * age * age);
        float qy = p.y - c.y, qz = p.z - c.z, cs = cos(ang), sn = sin(ang);
        p.y = c.y + qy * cs - qz * sn;
        p.z = c.z + qy * sn + qz * cs;
        moved = true;
      }
      float d = length(p0 - c), near = 1.0 - smoothstep(${i.sA}.y * 0.35, ${i.sA}.y, d);
      if (r.w < near * 0.9) {
        float tau = max(0.0, age - d * 0.06);
        vec3 dir = normalize(p0 - c + (r.xyz - 0.5) * 0.9 + vec3(0.0, 0.5, 0.0));
        p += dir * (1.2 + 2.6 * r.x) * near * tau;
        p.y -= 2.2 * tau * tau;
        moved = true;
      }
      if (moved) p.y = max(p.y, 0.015 + 0.04 * r.y); // debris comes to rest on the ground
      ${g}.center = p;
    }
  }`, { sC: ["vec3", C], sA: ["vec4", A], sK: ["vec2", K] });
  return { mod, C: C.value, A: A.value, K: K.value };
}

// ---------------------------------------------------------------- build
const Z = new THREE.Vector3(0, 0, 1);
function surfelMesh(def, modifier = shadeFx()) {
  const c = new THREE.Vector3(), n = new THREE.Vector3(), q = new THREE.Quaternion(), col = new THREE.Color(), sc = new THREE.Vector3();
  const mesh = new SplatMesh({
    constructSplats: (splats) => {
      for (let i = 0; i < def.count; i++) {
        c.fromArray(def.p, i * 3);
        if (def.n) q.setFromUnitVectors(Z, n.fromArray(def.n, i * 3).normalize());
        else q.setFromUnitVectors(Z, n.set(0, 1, 0));
        const h = def.size ? def.size[i] : def.h;
        sc.set(0.64 * h, 0.64 * h, 0.3 * h);
        col.setRGB(def.attr[i * 3] / MAT_SCALE, def.attr[i * 3 + 1], def.attr[i * 3 + 2]);
        splats.pushSplat(c, sc, q, 1, col);
      }
    },
  });
  mesh.worldModifier = modifier;
  mesh.updateGenerator();
  return mesh;
}
function pointMesh(n, put, modifier, opts = {}) {
  const c = new THREE.Vector3(), s = new THREE.Vector3(), q = new THREE.Quaternion(), col = new THREE.Color();
  const mesh = new SplatMesh({
    constructSplats: (sp) => {
      for (let k = 0; k < n; k++) {
        const o = put(k);
        c.fromArray(o.p);
        s.setScalar(o.s);
        col.set(o.c || "#ffffff");
        sp.pushSplat(c, s, q, o.a ?? 1, col);
      }
    },
  });
  if (modifier) mesh[opts.world ? "worldModifier" : "objectModifier"] = modifier;
  // particles are moved by their shader, so their bounds say nothing: never cull them
  mesh.frustumCulled = false;
  mesh.updateGenerator();
  return mesh;
}
// three nested translucent discs: the pixel pass turns them into a dotted halo
const halo = (list, p, r, col) => { for (const [k, a] of [[1, 0.31], [0.55, 0.38], [0.28, 0.5]]) list.push({ p, s: r * k, c: col, a }); };

const groups = {};
const meshes = [];
const beams = {};
let skyGroup, nightSky, daySky, siteGroup, spaceGroup, armRig, armInner;
const shatters = {};
let total = 0;
function addPart(def, parentObj) {
  const group = new THREE.Group();
  group.position.fromArray(def.pos);
  (def.parent ? groups[def.parent] : parentObj).add(group);
  groups[def.name] = group;
  const mesh = surfelMesh(def);
  group.add(mesh);
  meshes.push(mesh);
  total += def.count;
  return group;
}

function build() {
  const shipRoot = new THREE.Group();
  scene.add(shipRoot);
  groups.root = shipRoot;
  for (const d of buildShip()) addPart(d, shipRoot);
  // Super Heavy, under the ship for the orbital launch
  addPart(buildBooster(), shipRoot);
  groups.booster.position.set(0, -BOOSTER_H, 0);
  groups.booster.visible = false;
  const bplume = pointMesh(1400, () => ({ p: [0, 0, 0], s: 0.02 }), boosterPlumeFx());
  groups.booster.add(bplume);
  meshes.push(bplume);
  for (const d of buildSite()) addPart(d, scene);
  // the arms hang from a pivot, so they can fall with the tower
  armRig = new THREE.Group();
  armInner = new THREE.Group();
  armRig.add(armInner);
  scene.add(armRig);
  armInner.add(groups.armL, groups.armR);
  // every facility can shatter where the ship hits it
  for (const name of ["tower", "armL", "armR", "bay", "padA", "padB"]) {
    const mesh = groups[name].children[0], sh = makeShatter();
    mesh.objectModifier = sh.mod;
    mesh.updateGenerator();
    shatters[name] = { ...sh, group: groups[name] };
  }
  const ground = buildGround();
  const gmesh = surfelMesh(ground);
  scene.add(gmesh);
  meshes.push(gmesh);
  total += ground.count;

  const ship = groups.ship;
  const plume = pointMesh(660, () => ({ p: [0, 0, 0], s: 0.02 }), plumeFx());
  const plasma = pointMesh(700, () => ({ p: [0, 0, 0], s: 0.02 }), plasmaFx());
  const glowList = [];
  halo(glowList, [0, -0.3, 0], 0.2, NIGHT_RAMPS.warm[2]);
  const engGlow = pointMesh(glowList.length, (k) => glowList[k], haloFx(true));
  ship.add(plume, plasma, engGlow);
  const steam = pointMesh(900, () => ({ p: [0, 0, 0], s: 0.05 }), steamFx());
  const boom = pointMesh(900, () => ({ p: [0, 0, 0], s: 0.05 }), boomFx());
  scene.add(steam, boom);

  // lamp halos
  const lamps = [];
  for (const y of [0.6, 1.25, 2.7]) for (const x of [-0.12, 0.12]) halo(lamps, [x, y, 0.27], 0.07, NIGHT_RAMPS.warm[4]);
  halo(lamps, [2.4, 0.3, -1.8], 0.2, NIGHT_RAMPS.warm[4]);
  for (const p of [[0.15, TOWER_H + 0.44, 0.15], [0, TOWER_H + 0.36, 0.46], [-3.2, 2.55, -2.8], [0.56, BUILDING.h + 0.1, BUILDING.z], [-0.56, BUILDING.h + 0.1, BUILDING.z]]) halo(lamps, p, 0.06, NIGHT_RAMPS.red[2]);
  const lampGlow = pointMesh(lamps.length, (k) => lamps[k], haloFx(false));
  scene.add(lampGlow);

  // target beams: a dashed column of light over the catch point and pad B
  const beam = (x, y0, z, height) => {
    const list = [];
    for (let y = y0; y < y0 + height; y += 0.7)
      for (let k = 0; k < 12; k++) {
        const a = (k / 12) * Math.PI * 2;
        list.push({ p: [x + Math.cos(a) * 0.28, y, z + Math.sin(a) * 0.28], s: 0.05, c: BEAM, a: 0.36 });
      }
    const m = pointMesh(list.length, (k) => list[k], beamFx());
    m.visible = false;
    scene.add(m);
    meshes.push(m);
    return m;
  };
  beams.descent = beam(0, ARM_Y + 2.2, CATCH[2], 95);
  beams.hop = beam(0, 0.4, PAD_B, 40);

  // stars, the moon (night) and the sun (day) ride with the camera so they
  // stay at infinity; the sky's colour itself comes from the pixel pass
  skyGroup = new THREE.Group();
  scene.add(skyGroup);
  nightSky = new THREE.Group();
  daySky = new THREE.Group();
  skyGroup.add(nightSky, daySky);
  const rnd = mulberry32(12);
  const sky = [];
  for (let k = 0; k < 1100; k++) {
    const u = rnd() * 2 - 1, a = rnd() * 6.2832, y = u * 0.98, rr = Math.sqrt(1 - y * y);
    sky.push({ p: [Math.cos(a) * rr * 160, y * 160, Math.sin(a) * rr * 160], s: 0.24 + rnd() * rnd() * 0.5, c: ["#e8ecf3", "#b9c2d4", "#ffd674", "#8590ab"][Math.floor(rnd() * 4)] });
  }
  const md = new THREE.Vector3(...THEMES.night.key).multiplyScalar(150);
  sky.push({ p: md.toArray(), s: 4.4, c: "#f4f2ea" });
  for (const [dx, dy, r] of [[-1.4, 1.1, 1.1], [1.6, -0.6, 0.9], [0.2, -2.0, 0.7], [1.2, 1.9, 0.5]])
    sky.push({ p: [md.x + dx * 0.8, md.y + dy, md.z - dx * 0.5], s: r, c: "#b9c2d4" });
  const moonHalo = [];
  halo(moonHalo, md.clone().multiplyScalar(1.01).toArray(), 17, "#232a48");
  nightSky.add(pointMesh(sky.length, (k) => sky[k]), pointMesh(moonHalo.length, (k) => moonHalo[k]));
  const sd = new THREE.Vector3(...THEMES.day.key).multiplyScalar(150), sun = [{ p: sd.toArray(), s: 5.2, c: THEMES.day.disc }];
  halo(sun, sd.clone().multiplyScalar(1.01).toArray(), 19, "#f3e2b0");
  daySky.add(pointMesh(sun.length, (k) => sun[k]));

  // cloud banks along the descent (moonlit grey at night, white by day): background only (x < 0), so they
  // never come between the camera and the ship
  const clouds = [];
  for (let k = 0; k < 110; k++) {
    const y = 10 + rnd() * 82, along = 0.6 + (y / 96) * 38;
    const cx = -2.5 - rnd() * 14, cz = along + (rnd() - 0.5) * 22, w = 0.6 + rnd() * 1.5;
    for (let j = 0; j < 55; j++) {
      const u = rnd() * 6.2832, v = Math.sqrt(rnd());
      const px = cx + Math.cos(u) * v * w, pz = cz + Math.sin(u) * v * w * 1.8, py = y + (rnd() - 0.35) * 0.3 * (1 - v * v);
      const tone = py - y > 0.06 ? 0.95 : rnd() < 0.6 ? 0.3 : 0.62; // lit tops, shaded bellies
      clouds.push({ p: [px, py, pz], s: 0.08 + rnd() * 0.1, c: new THREE.Color(tone, tone, tone).getHex() });
    }
  }
  const cloudMesh = pointMesh(clouds.length, (k) => clouds[k], cloudFx());
  scene.add(cloudMesh);
  meshes.push(cloudMesh);

  meshes.push(plume, plasma, engGlow, steam, boom, lampGlow);

  // everything on the ground, so it can be hidden in space
  siteGroup = new THREE.Group();
  for (const c of [...scene.children]) if (![shipRoot, skyGroup, spark, boom].includes(c)) siteGroup.add(c);
  scene.add(siteGroup);

  // the planet, for the orbital mission
  spaceGroup = new THREE.Group();
  spaceGroup.visible = false;
  scene.add(spaceGroup);
  const E = buildEarth();
  const radial = (def, size, flat, color, modifier, alpha = 1) => {
    const c = new THREE.Vector3(), n = new THREE.Vector3(), q = new THREE.Quaternion(), col = new THREE.Color(), sc = new THREE.Vector3(size, size, size * flat);
    const mesh = new SplatMesh({
      constructSplats: (sp) => {
        for (let i = 0; i < def.count; i++) {
          c.fromArray(def.p, i * 3);
          q.setFromUnitVectors(Z, n.copy(c).normalize());
          color(col, i);
          sp.pushSplat(c, sc, q, alpha, col);
        }
      },
    });
    mesh.worldModifier = modifier;
    mesh.updateGenerator();
    spaceGroup.add(mesh);
    meshes.push(mesh);
    return mesh;
  };
  radial(E.surface, 0.14, 0.4, (col, i) => col.setRGB(E.surface.attr[i * 3] / MAT_SCALE, E.surface.attr[i * 3 + 1], 1), earthFx());
  radial(E.clouds, 0.17, 0.35, (col, i) => col.setRGB(E.clouds.attr[i * 2], E.clouds.attr[i * 2 + 1], 0), earthCloudFx());
  radial(E.atmo, 0.75, 1, (col) => col.setRGB(1, 1, 1), atmoFx(), 0.4);
  return total + 660 + 700 + 900 * 2 + sky.length + clouds.length + E.surface.count + E.clouds.count + E.atmo.count + 1400;
}

// ---------------------------------------------------------------- sizing
function resize() {
  const { w, h } = viewportSize();
  renderer.setSize(w, h);
  const px = state.pixel || defaultPixel();
  state.pixelUsed = px;
  const lw = Math.max(1, Math.round(w / px)), lh = Math.max(1, Math.round(h / px));
  rt.setSize(lw * state.ss, lh * state.ss);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  post.setSizes(lw, lh, px * dpr, state.ss);
}
window.addEventListener("resize", resize);

// ---------------------------------------------------------------- pose helpers
const qPitch = new THREE.Quaternion(), qRoll = new THREE.Quaternion(), X = new THREE.Vector3(1, 0, 0), ZA = new THREE.Vector3(0, 0, 1);
const offs = new THREE.Vector3(), tmpV = new THREE.Vector3(), engLocal = new THREE.Vector3(0, -0.28, 0);
// place the ship from its centre of mass (scene units) and attitude (degrees)
function poseShip(comY, comZ, pitch, roll = 0) {
  const root = groups.root;
  qRoll.setFromAxisAngle(ZA, THREE.MathUtils.degToRad(roll));
  qPitch.setFromAxisAngle(X, THREE.MathUtils.degToRad(pitch));
  root.quaternion.copy(qRoll).multiply(qPitch);
  offs.set(0, COM_Y, 0).applyQuaternion(root.quaternion);
  root.position.set(0, comY, comZ).sub(offs);
}
function setFlaps(fwdL, fwdR, aftL, aftR) {
  groups.fwdR.rotation.y = -fwdR; groups.fwdL.rotation.y = fwdL;
  groups.aftR.rotation.y = -aftR; groups.aftL.rotation.y = aftL;
}
function setArms(a, dy = 0) {
  groups.armR.rotation.y = a; groups.armL.rotation.y = -a;
  groups.armR.position.y = groups.armL.position.y = ARM_Y + dy;
}

// ---------------------------------------------------------------- cameras
const CATCH_CENTER = new THREE.Vector3(CATCH[0], 1.6, CATCH[2] - 0.2);
const look = new THREE.Vector3();
let fov = 32;
function setFov(f) { if (Math.abs(f - fov) > 0.01) { fov = f; camera.fov = f; camera.updateProjectionMatrix(); } }

// the menu's attract loop: the scripted catch, with a cut for each act
function attractCamera(t, com) {
  const fit = portraitFit(camera.aspect);
  let targetFov = 32;
  if (t < T_IGNITE - 0.3) {
    const a = 0.55 + t * 0.03;
    camera.position.set(com.x + Math.sin(a) * 4.6 * fit, com.y + 1.9, com.z + Math.cos(a) * 4.6 * fit);
    camera.lookAt(look.set(com.x, com.y - 0.5, com.z));
  } else if (t < 12) {
    camera.position.set(com.x + 6.2 * fit, com.y + 0.5, com.z - 0.6 + (t - T_IGNITE) * 0.12);
    camera.lookAt(com);
  } else if (t < 17.2) {
    camera.position.set(2.8 * fit, 0.32, 4.4 * fit);
    look.copy(com).lerp(CATCH_CENTER, 0.25);
    camera.lookAt(look);
    targetFov = 44;
  } else {
    const k = t - 17.2, a = 0.75 + k * 0.04, d = (8.2 - 1.6 * smooth(k / 5)) * fit;
    camera.position.set(CATCH_CENTER.x + Math.sin(a) * d, 1.0 + 0.6 * smooth(k / 6), CATCH_CENTER.z + Math.cos(a) * d);
    camera.lookAt(look.copy(CATCH_CENTER).lerp(com, 0.3));
  }
  setFov(targetFov);
}

// The game camera: a steady side view. It looks across the flight plane
// from +x (turned 20° towards the sea), so ← and → always rotate the ship the
// way it looks on screen. It leads the ship along its velocity, leans
// towards the target, pulls back with speed and pulls in for the landing.
const CAM_DIR = new THREE.Vector3(0.94, 0.13, 0.34).normalize();
const ZOOMS = [1, 1.55, 0.72], ZOOM_NAMES = ["FOLLOW", "WIDE", "CLOSE"];
const cam = { focus: new THREE.Vector3(), dist: 8, zoom: 0, snap: true, shake: 0 };
const want = new THREE.Vector3(), lead = new THREE.Vector3(), toT = new THREE.Vector3(), tgt = new THREE.Vector3();
function gameCamera(g, dt, shipC) {
  const vz = g.vz / U, vy = g.vy / U, speed = Math.hypot(vz, vy);
  tgt.set(0, g.mission.target.y / U, g.mission.target.z / U);
  toT.subVectors(tgt, shipC);
  const dT = toT.length();
  // lead along the velocity (less vertically, so climbs and falls stay framed)
  const narrow = Math.max(0.3, Math.min(1, camera.aspect / 1.3)); // portrait: less sideways lead
  lead.set(0, vy * 0.3, vz * 0.55 * narrow);
  if (lead.length() > 2.2) lead.setLength(2.2);
  want.copy(shipC).add(lead);
  // lean sideways towards the target while it's far, frame both as it gets close
  const dzT = toT.z;
  want.z += Math.sign(dzT) * Math.min(2.0, Math.abs(dzT) * 0.2) * narrow;
  if (dT < 7) want.lerp(tmpV.copy(shipC).add(tgt).multiplyScalar(0.5), 0.4 * (1 - dT / 7));
  want.y += 0.35; // look a little above the ship: it sits just below centre, clear of the HUD
  want.y = Math.max(want.y, 1.0);
  let dist = 6.2 + Math.min(speed, 4) * 0.7 + Math.min(dT, 10) * 0.16;
  if (g.status === "flying" && !g.lit && g.mission.id === "descent") dist += 1.2; // the glide: more sky
  dist *= ZOOMS[cam.zoom] * portraitFit(camera.aspect);
  if (cam.snap) { cam.focus.copy(want); cam.dist = dist; cam.snap = false; }
  cam.focus.lerp(want, 1 - Math.exp(-dt * 4.5));
  cam.dist += (dist - cam.dist) * (1 - Math.exp(-dt * 1.6));
  camera.position.copy(cam.focus).addScaledVector(CAM_DIR, cam.dist);
  camera.position.y = Math.max(camera.position.y, 0.35);
  if (cam.shake > 0) {
    camera.position.x += (Math.random() - 0.5) * cam.shake;
    camera.position.y += (Math.random() - 0.5) * cam.shake;
    cam.shake = Math.max(0, cam.shake - dt * 0.5);
  }
  camera.lookAt(cam.focus);
  setFov(34);
}

// ---------------------------------------------------------------- game state
const keys = { up: false, down: false, left: false, right: false, warp: false };
let mode = "loading", game = null, attractT = 0, endTimer = 0, paused = false, steam = 0, caughtAt = -1, lastTime = 0;
let ui = null, flapAnim = 0, touchMode = false, touch = null;
const DT = 1 / 120;
let acc = 0;

const MISSION_ORDER = ["descent", "hop", "orbit"];
const nextMission = (m) => MISSION_ORDER[(MISSION_ORDER.indexOf(m) + 1) % MISSION_ORDER.length];
let cur = { mission: "descent", diff: "cadet" };
function startGame(missionId, diffId) {
  cur = { mission: missionId, diff: diffId };
  resetFacilities();
  attachBooster();
  if (view !== "local") setView("local");
  orb = null;
  game = null;
  if (missionId === "orbit") {
    orb = newOrbitGame(diffId);
    orbPredAt = 0;
  } else {
    game = newGame(MISSIONS[missionId], DIFFICULTY[diffId]);
    game.missionKey = missionId; game.diffKey = diffId;
  }
  mode = "play";
  paused = false;
  acc = 0;
  steam = 0;
  caughtAt = -1;
  endTimer = 0;
  cam.snap = true;
  cam.shake = 0;
  groups.root.visible = true;
  groups.legs.visible = missionId === "hop";
  groups.booster.visible = missionId === "orbit";
  beams.descent.visible = missionId === "descent";
  beams.hop.visible = missionId === "hop";
  uAux.value.z = -1;
  uEx.value.w = 0;
  if (orb) ui.showOrbit(orb); else ui.showFlight(game);
  touch?.show(touchMode);
  touch?.setPaused(false);
  ui.toast({ descent: "ENTRY INTERFACE", hop: "PAD A · READY", orbit: "STARBASE · GO FOR LAUNCH" }[missionId]);
}
function togglePause() { paused = !paused; touch?.setPaused(paused); }
function cycleCamera() { cam.zoom = (cam.zoom + 1) % ZOOMS.length; cam.snap = view === "space"; ui.toast(`CAMERA · ${(view === "space" ? SPACE_ZOOM_NAMES : ZOOM_NAMES)[cam.zoom]}`); }
function toMenu() {
  mode = "menu";
  game = null;
  orb = null;
  if (view !== "local") setView("local");
  resetFacilities();
  attachBooster();
  groups.booster.visible = false;
  uEx.value.w = 0;
  attractT = 0;
  groups.root.visible = true;
  groups.legs.visible = false;
  beams.descent.visible = beams.hop.visible = false;
  uAux.value.z = -1;
  ui.showMenu();
  touch?.show(false);
}

window.addEventListener("keydown", (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  const arrows = { ArrowUp: "up", ArrowDown: "down", ArrowLeft: "left", ArrowRight: "right" };
  if (arrows[k] || k === " ") e.preventDefault();
  if (k === "-" || k === "=" || k === "+") {
    // art-pixel size: chunkier or finer
    state.pixel = Math.max(2, Math.min(10, (state.pixel || state.pixelUsed) + (k === "-" ? -1 : 1)));
    resize();
    return ui.toast(`PIXEL SIZE ${state.pixel}`);
  }
  if (k === "t") return toggleTheme();
  if (mode === "menu") return ui.menuKey(k === "enter" ? "Enter" : k);
  if (mode === "play") {
    if (arrows[k]) keys[arrows[k]] = true;
    else if (k === " ") keys.warp = true;
    else if (k === "p") togglePause();
    else if (k === "c") cycleCamera();
    else if (k === "r") startGame(cur.mission, cur.diff);
    else if (k === "Escape") toMenu();
  } else if (mode === "result") {
    if (k === "Enter" || k === "r") startGame(cur.mission, cur.diff);
    else if (k === "n") startGame(nextMission(cur.mission), cur.diff);
    else if (k === "Escape") toMenu();
  }
});
window.addEventListener("keyup", (e) => {
  const arrows = { ArrowUp: "up", ArrowDown: "down", ArrowLeft: "left", ArrowRight: "right" };
  if (arrows[e.key]) keys[arrows[e.key]] = false;
  if (e.key === " ") keys.warp = false;
});
window.addEventListener("blur", () => { for (const k in keys) keys[k] = false; });

// what to tell the pilot right now
function coach(g) {
  if (g.status !== "flying") return [null];
  const p = shipPoints(g), alt = p.base[1], d = g.diff, tilt = Math.abs(g.pitch);
  if (g.mission.id === "descent") {
    const stop = stoppingDistance(g), burnAt = stop * 1.25 + 160;
    if (!g.lit) {
      if (g.fuel <= 0) return ["OUT OF FUEL", true];
      if (alt < burnAt) return ["↑ LIGHT THE ENGINES NOW, then ← flip upright", true];
      if (alt < burnAt + 300) return ["Get ready to light the engines (↑)", false];
      if (g.t < 9) return ["Belly-flop glide · → nose down to fly farther · ← nose up to fall shorter · space: time warp", false];
      return ["Line up with the tower (green beam): watch the dotted path on the radar", false];
    }
    if (g.pitch < -35) return ["← FLIP UPRIGHT", true];
    if (alt > 260) return ["Burn hard, kill the speed, lean ← to brake your forward drift", false];
    const zu = g.z / U;
    if (Math.abs(zu - CATCH[2]) < 0.4 && alt < 110) return [g.arms < 0.5 ? "CHOPSTICKS CLOSING · ease down onto the arms" : "In the window · come down slowly", false];
    return [`Slide under the arms (beam) · slow to ≤ ${d.vy} m/s down, ≤ ${d.vh} m/s sideways, ≤ ${d.tilt}° tilt`, false];
  }
  if (!g.airborne) return ["↑ Throttle up to lift off · hovering takes about 50%", false];
  const zu = g.z / U;
  if (zu < BUILDING.z + 1.2 && alt < (BUILDING.h + 0.6) * U) return ["Climb above the high bay before you lean ← towards pad B", alt < BUILDING.h * U && zu > BUILDING.z - 1.8];
  if (Math.abs(zu - PAD_B) < 1.6 && alt < 70) return [`Over pad B · settle straight down: ≤ ${d.vy} m/s, ≤ ${d.vh} m/s sideways, ≤ ${d.tilt}°`, false];
  if (tilt > 25) return ["Too much lean: level out (→) or you'll lose height", true];
  return ["Lean ← to fly to pad B, lean → to slow down · keep your height", false];
}

// ---------------------------------------------------------------- shattering
// which meshes break for each kind of hit, how far the blast reaches, and
// whether (and around which axis) the part above the impact topples
const SHATTER = {
  tower: { parts: ["tower", "armL", "armR"], blast: 1.3, topple: 0.45, axis: [0, 0] },
  mount: { parts: ["tower"], blast: 0.9, topple: 0, axis: [0, CATCH[2]] },
  arms: { parts: ["armL", "armR"], blast: 0.6, topple: 0, axis: [0, 0] },
  bay: { parts: ["bay"], blast: 1.5, topple: 1.0, axis: [0, BUILDING.z] },
  padA: { parts: ["padA"], blast: 0.7, topple: 0, axis: [0, PAD_A] },
  padB: { parts: ["padB"], blast: 0.7, topple: 0, axis: [0, PAD_B] },
};
let armTopple = null;
function shatterFacility(hit, P, shipZ) {
  const def = SHATTER[hit];
  if (!def) return;
  const dir = shipZ > def.axis[1] ? -1 : 1; // falls away from the ship
  scene.updateMatrixWorld(true);
  for (const name of def.parts) {
    const sh = shatters[name];
    sh.C.copy(sh.group.worldToLocal(P.clone()));
    sh.A.set(0, def.blast, dir, name.startsWith("arm") ? 0 : def.topple);
    sh.K.set(def.axis[0], def.axis[1]);
  }
  // the arms ride down with the tower when it breaks below them
  if (hit === "tower" && P.y < ARM_Y) {
    armTopple = { age: 0, dir };
    armRig.position.set(0, P.y, P.z);
    armInner.position.set(0, -P.y, -P.z);
  }
}
function updateShatter(dt) {
  for (const sh of Object.values(shatters)) if (sh.A.x >= 0) sh.A.x += dt;
  if (armTopple) { armTopple.age += dt; armRig.rotation.x = armTopple.dir * Math.min(1.52, 0.32 * armTopple.age * armTopple.age); }
}
function resetFacilities() {
  for (const sh of Object.values(shatters)) sh.A.x = -1;
  armTopple = null;
  armRig.position.set(0, 0, 0);
  armRig.rotation.set(0, 0, 0);
  armInner.position.set(0, 0, 0);
}
// a crash: fireball at the impact, the ship gone, the facility (if any) breaks
function crashFx(P, hit, shipZ) {
  cam.shake = 0.3;
  uAux.value.z = 0;
  uBoom.value.copy(P);
  groups.root.visible = false;
  if (hit) shatterFacility(hit, P, shipZ);
}

// ---------------------------------------------------------------- orbital mission
let orb = null, view = "local", orbWarp = 1, orbPredAt = 0, boosterFree = null;
const orbInfo = { el: null, err: null, path: [], guide: 0, warp: 1 };
const D2R = Math.PI / 180;
const SPACE_ZOOMS = [11, 30, 135], SPACE_ZOOM_NAMES = ["FOLLOW", "WIDE", "MAP"];
const ORB_EVENTS = { liftoff: "LIFTOFF", staging: "STAGING · BOOSTER SEP", maxq: "MAX-Q", orbit: "ORBIT ACHIEVED", deorbit: "DEORBIT · HEADING HOME", ignite: "IGNITION", shutdown: "ENGINES OFF", flameout: "FLAMEOUT · NO FUEL" };

function applySpace() {
  post.setPalette(SPACE_PALETTE, [...GLOW, ...ATMO_GLOW]);
  post.setSky([]);
  post.setBackground(SPACE_BG);
  nightSky.visible = daySky.visible = true;
  uAux.value.w = 0; // the ship keeps its night colours up here
}
function setView(v) {
  view = v;
  spaceLift = orb && orb.stage === 2 ? 0.9 : BOOSTER_H + 1.9;
  const space = v === "space";
  siteGroup.visible = !space;
  spaceGroup.visible = space;
  if (space) applySpace();
  else { camera.up.set(0, 1, 0); setTheme(themeName); }
  cam.snap = true;
}
function attachBooster() {
  groups.root.add(groups.booster);
  groups.booster.position.set(0, -BOOSTER_H, 0);
  groups.booster.quaternion.identity();
  boosterFree = null;
}
// how fast game time runs: real time near the ground and in burns, faster on the coasts
function orbitWarp(o) {
  if (o.status !== "flying") return 1;
  const alt = altOf(o);
  if (o.phase === "pad" || alt < 1) return 1;
  if (view === "local") return 2;
  if (o.lit && o.inOrbit) return 1; // the deorbit burn is delicate: real time
  if (o.lit) return 4;
  if (o.deorbited) return alt > 45 ? (keys.warp ? 15 : 5) : 3;
  if (o.inOrbit) return keys.left || keys.right ? 6 : keys.warp ? 120 : 30; // slow down while turning
  return keys.warp ? 40 : 10;
}

const basis = new THREE.Matrix4(), vNose = new THREE.Vector3(), vBelly = new THREE.Vector3(), vX = new THREE.Vector3(), vP = new THREE.Vector3();
// orient a group in space: +y along the nose, -z along the belly
function orientSpace(obj, nu, nv, bu, bv) {
  vNose.set(0, nv, -nu);
  vBelly.set(0, -bv, bu); // local +z is away from the belly
  vX.crossVectors(vNose, vBelly);
  basis.makeBasis(vX, vNose, vBelly);
  obj.quaternion.setFromRotationMatrix(basis);
}
const renderPos = (u, v, out) => out.set(0, v * KM, -u * KM);

function poseOrbitLocal(o, dt, now) {
  const lp = orbitLocal(o), az = Math.sin(o.pitch * D2R), ay = Math.cos(o.pitch * D2R);
  const comY = (lp.y + ay * COM_Y * U) / U, comZ = (lp.z + az * COM_Y * U) / U;
  poseShip(comY, comZ, o.pitch);
  setFlaps(1.25, 1.25, 1.1, 1.1);
  setArms(0.85);
  const stack = o.stage === 1;
  groups.booster.visible = stack;
  scene.updateMatrixWorld(true);
  const thr = o.lit ? o.thr : 0;
  (stack ? groups.booster : groups.ship).localToWorld(tmpV.set(0, -0.3, 0));
  const baseU = lp.y / U - (stack ? BOOSTER_H : 0);
  const target = thr * (1 - smooth((baseU - OLM_TOP - 0.1) / 5));
  steam = target > steam ? lerp(steam, target, 1 - Math.exp(-dt * 2.5)) : lerp(steam, target, 1 - Math.exp(-dt * 0.3));
  const boomAge = uAux.value.z;
  if (boomAge >= 0) { uEng.value.copy(uBoom.value); uFx.value.set(3.4 * Math.exp(-boomAge * 1.2), 0, steam, 0); uEx.value.w = 0; }
  else {
    uEng.value.copy(tmpV);
    uFx.value.set(thr * (stack ? 3.4 : 2.2) * (0.9 + 0.1 * Math.sin(now * 41)), stack ? 0 : thr, steam, 0);
    uEx.value.w = stack ? thr : 0;
  }
  uAux.value.x = 0; uAux.value.y = lp.z / U;
  // camera: side on, framing the whole stack and the tower beside it
  const fit = portraitFit(camera.aspect);
  want.set(0, Math.max(1.6, comY - (stack ? BOOSTER_H * 0.5 : 0) + 0.5), comZ);
  const dist = (11 + Math.min(7, comY * 0.03)) * ZOOMS[cam.zoom] * fit;
  if (cam.snap) { cam.focus.copy(want); cam.dist = dist; cam.snap = false; }
  cam.focus.lerp(want, 1 - Math.exp(-dt * 5));
  cam.dist += (dist - cam.dist) * (1 - Math.exp(-dt * 2));
  camera.up.set(0, 1, 0);
  camera.position.copy(cam.focus).addScaledVector(CAM_DIR, cam.dist);
  camera.position.y = Math.max(camera.position.y, 0.35);
  shakeCamera(dt);
  camera.lookAt(cam.focus);
  setFov(34);
  const cd = camera.position.distanceTo(cam.focus);
  uFog.value.set(cd + 7, cd + 60);
}

const camOff = new THREE.Vector3(), rr = new THREE.Vector3(), tt = new THREE.Vector3();
// the ship is drawn far larger than the planet's scale, so it is lifted by its
// own drawn length: the stack and its plume never sink into the ground
let spaceLift = BOOSTER_H + 1.9;
function poseOrbitSpace(o, dt, now) {
  const a = attitude(o), alt = altOf(o), speed = Math.hypot(o.vu, o.vv);
  const liftWant = o.stage === 1 ? BOOSTER_H + 1.9 : 0.9;
  spaceLift += (liftWant - spaceLift) * (1 - Math.exp(-dt * 0.6));
  renderPos(o.u, o.v, vP);
  vP.addScaledVector(rr.copy(vP).normalize(), spaceLift);
  groups.root.position.copy(vP);
  orientSpace(groups.root, a.nu, a.nv, a.bu, a.bv);
  const reentering = o.deorbited && alt < ATMO + 10;
  setFlaps(reentering ? 0.25 : 1.25, reentering ? 0.25 : 1.25, reentering ? 0.2 : 1.1, reentering ? 0.2 : 1.1);
  groups.booster.visible = o.stage === 1 || !!boosterFree;
  // the sun: over Starbase by day, behind the planet at night
  const sun = isDay() ? [0.45, 0.75, -0.48] : [0.45, -0.75, 0.48];
  uEx.value.set(...sun, 0);
  scene.updateMatrixWorld(true);
  const thr = o.lit ? o.thr : 0, stack = o.stage === 1;
  (stack ? groups.booster : groups.ship).localToWorld(tmpV.set(0, -0.3, 0));
  const plasma = reentering && alt < ATMO ? smooth((speed - 0.7) / 0.9) * smooth((ATMO - alt) / 12) : 0;
  const boomAge = uAux.value.z;
  if (boomAge >= 0) { uEng.value.copy(uBoom.value); uFx.value.set(3.4 * Math.exp(-boomAge * 1.2), 0, 0, 0); }
  else {
    uEng.value.copy(tmpV);
    uFx.value.set(thr * 2.2, stack ? 0 : thr, 0, plasma);
    uEx.value.w = stack ? thr : 0;
  }
  // the spent booster falls away
  if (boosterFree) {
    const gdt = dt * orbWarp;
    for (let k = 0, n = Math.ceil(gdt / 0.2); k < n; k++) {
      const h = gdt / n, r = Math.hypot(boosterFree.u, boosterFree.v), g = MU / (r * r * r);
      boosterFree.vu -= boosterFree.u * g * h; boosterFree.vv -= boosterFree.v * g * h;
      boosterFree.u += boosterFree.vu * h; boosterFree.v += boosterFree.vv * h;
    }
    boosterFree.age += gdt;
    boosterFree.pitch += 6 * gdt;
    const ba = attitude(o, boosterFree.u, boosterFree.v, boosterFree.pitch);
    renderPos(boosterFree.u, boosterFree.v, groups.booster.position);
    groups.booster.position.addScaledVector(rr.copy(groups.booster.position).normalize(), spaceLift);
    orientSpace(groups.booster, ba.nu, ba.nv, ba.bu, ba.bv);
    groups.booster.position.addScaledVector(vNose.set(0, ba.nv, -ba.nu), -BOOSTER_H);
    if (boosterFree.age > 120 || Math.hypot(boosterFree.u, boosterFree.v) < EARTH_R / KM) groups.booster.visible = false;
  }
  // camera: beside the ship with the local horizon level; MAP shows the whole planet
  const fit = portraitFit(camera.aspect), r = Math.hypot(o.u, o.v);
  rr.copy(vP).normalize();
  tt.set(0, -o.u / r, -o.v / r);
  const map = cam.zoom === 2;
  // frame the whole stack (and its plume) while the booster is on, the ship after
  if (map) want.set(0, 0, 0);
  else if (stack) want.copy(vP).addScaledVector(vNose.set(0, a.nv, -a.nu), -1.4).addScaledVector(rr, 0.3);
  // the higher you are, the more the camera looks down to keep the horizon in view
  else want.copy(vP).addScaledVector(rr, 1.0 - Math.min(1.8, alt * KM * 0.4));
  const dist = SPACE_ZOOMS[cam.zoom] * fit * (stack && !map ? 1.35 : 1);
  if (cam.snap) { cam.focus.copy(want); cam.dist = dist; cam.snap = false; }
  cam.focus.lerp(want, 1 - Math.exp(-dt * 6));
  cam.dist += (dist - cam.dist) * (1 - Math.exp(-dt * 2.5));
  if (map) { camOff.set(1, 0.08, 0).normalize(); camera.up.set(0, 1, 0); }
  else { camOff.set(0.94, 0, 0).addScaledVector(rr, 0.13).addScaledVector(tt, -0.34).normalize(); camera.up.copy(rr); }
  camera.position.copy(cam.focus).addScaledVector(camOff, cam.dist);
  shakeCamera(dt);
  camera.lookAt(cam.focus);
  setFov(34);
  uFog.value.set(1e4, 2e4);
}
function shakeCamera(dt) {
  if (cam.shake <= 0) return;
  camera.position.x += (Math.random() - 0.5) * cam.shake;
  camera.position.y += (Math.random() - 0.5) * cam.shake;
  cam.shake = Math.max(0, cam.shake - dt * 0.5);
}

function orbitSummary(o) {
  return { status: o.status, reason: o.reason, t: o.t, fuel: o.fuel2, fuel0: o.fuel2_0, maxAlt: o.maxAlt * 1000, mission: MISSIONS.orbit, diff: DIFFICULTY[cur.diff], missionKey: "orbit" };
}
// below 2.4 km the ship is handed to the landing physics for the catch
function startHandoff(o) {
  const h = handoff(o);
  if (!h.ok) {
    o.status = "missed";
    o.reason = h.err > 0 ? `Came down ${h.err.toFixed(0)} km short of Starbase, out in the Gulf (limit ±${o.d.window} km)` : `Came down ${(-h.err).toFixed(0)} km past Starbase, inland (limit ±${o.d.window} km)`;
    o.done = true;
    endTimer = 1.6;
    return;
  }
  const mission = { ...MISSIONS.descent, label: MISSIONS.orbit.label, start: h.start };
  game = newGame(mission, DIFFICULTY[cur.diff]);
  game.missionKey = "orbit"; game.diffKey = cur.diff;
  game.orbit = { err: h.err, t: o.t };
  attachBooster();
  groups.booster.visible = false;
  setView("local");
  beams.descent.visible = true;
  steam = 0; acc = 0; caughtAt = -1; endTimer = 0;
  ui.showFlight(game);
  ui.toast(`STARBASE · ${Math.abs(h.err).toFixed(0)} KM ${h.err > 0 ? "SHORT" : "LONG"}`);
}

function frameOrbit(dt, now, draw = true) {
  const o = orb;
  if (!paused && o.status === "flying") {
    orbWarp = orbitWarp(o);
    let left = dt * orbWarp;
    while (left > 1e-9 && o.status === "flying") {
      const h = Math.min(left, o.lit || altOf(o) < ATMO ? 0.03 : 0.25);
      orbitStep(o, keys, h, orbWarp);
      left -= h;
      if (o.deorbited && altOf(o) < HANDOFF_ALT) break;
    }
    for (const ev of o.events.splice(0)) ui.toast(ORB_EVENTS[ev] || ev);
    if (o.sep && !boosterFree && view === "space") {
      scene.attach(groups.booster);
      boosterFree = { u: o.sep.u, v: o.sep.v, vu: o.sep.vu * 0.985, vv: o.sep.vv * 0.985, pitch: o.sep.pitch, age: 0 };
    }
  }
  touch?.setWarp(o.status === "flying" && !o.lit && altOf(o) > 10);
  if (o.status === "flying" && o.deorbited && altOf(o) < HANDOFF_ALT) {
    startHandoff(o);
    if (game) return frameGame(dt, now, draw);
  }
  if (view === "local" && altOf(o) > 6 && o.status === "flying") setView("space");
  // predictions for the HUD and the map, a few times a second
  if (now > orbPredAt || orbPredAt - now > 1) {
    orbPredAt = now + 0.25;
    orbInfo.err = o.inOrbit ? landingError(o) : null;
    const el = elements(o);
    orbInfo.path = predictPath(o, o.inOrbit && Number.isFinite(el.period) ? el.period * 1.02 : 1200, 160);
  }
  orbInfo.el = elements(o);
  orbInfo.warp = orbWarp;
  orbInfo.guide = o.deorbited ? reentryPitch(o) : o.inOrbit ? (o.swept > 200 ? 90 : -90) : guidePitch(o);
  orbInfo.view = view;
  if (o.status === "crashed" && !o.done) {
    o.done = true;
    endTimer = 2.4;
    if (view === "local") crashFx(tmpV.set(0, o.boomAt[1] / U, o.boomAt[0] / U).clone(), o.hit, orbitLocal(o).z / U);
    else crashFx(groups.root.position.clone(), null, 0);
  }
  if (view === "local") poseOrbitLocal(o, dt, now); else poseOrbitSpace(o, dt, now);
  if (!paused) { if (uAux.value.z >= 0) uAux.value.z += dt; updateShatter(dt); }
  ui.updateOrbit(o, orbInfo);
  const [h, urgent] = paused ? [touchMode ? "PAUSED · tap ▶ to resume" : "PAUSED · P to resume", false] : coachOrbit(o, orbInfo);
  ui.hint(h, urgent);
  if (o.status !== "flying" && !paused && mode === "play") {
    endTimer -= dt;
    if (endTimer <= 0) { mode = "result"; ui.showResult(orbitSummary(o)); touch?.show(false); }
  }
  if (draw) render(now);
}

// what to tell the pilot during the orbital flight
function coachOrbit(o, info) {
  if (o.status !== "flying") return [null];
  const alt = altOf(o), el = info.el, gp = Math.round(info.guide);
  const diff = ((info.guide - o.pitch + 540) % 360) - 180, off = Math.abs(diff), turn = off < 4 ? "✓" : diff > 0 ? "←" : "→";
  const f = attitude(o).f, vr = o.vu * f.ru + o.vv * f.rv;
  if (o.phase === "pad") return ["↑ Throttle up to lift off · climb straight up: the tower is right beside you", false];
  if (alt < 0.4) return ["Straight up until you clear the tower · don't lean yet", Math.abs(o.pitch) > 2];
  if (!o.inOrbit) {
    if (o.lit && el.ap < 85) return [`Gravity turn: follow the guide (${gp}°) ${turn} · throttle up${o.stage === 1 ? " · the booster drops off when it runs dry" : ""}`, off > 15];
    if (vr > 0.015) return [o.lit ? "Apoapsis 85 km+: hold ↓ to cut the engines and coast to the top" : "Coasting up to apoapsis · space: warp · at the top, burn level until PERIAPSIS > 80 km", o.lit && el.ap > 110];
    return [`At the top: nose level (−90°) ${off > 4 ? turn : "✓"} and ↑ BURN until PERIAPSIS > 80 km`, !o.lit];
  }
  if (!o.deorbited) {
    const sw = o.swept;
    if (sw < 200) return [`In orbit! ${Math.round(sw)}° of 360° round · space: faster warp · deorbit after about 220°`, false];
    const e = info.err;
    const now = e == null ? "still in orbit" : Math.abs(e) < 3 ? "on target ✓ · cut the engines" : e > 0 ? `${e.toFixed(0)} km short` : `${(-e).toFixed(0)} km long`;
    return [`DEORBIT: nose retrograde (+90°) ${off > 4 ? turn : "✓"} · ↑ burn at minimum throttle until LANDING ≈ 0 km · now ${now}`, sw > 300];
  }
  if (o.heat > 0.3) return ["HEAT SHIELD! Turn the belly into the flow", true];
  if (alt > ATMO) return [`Heading home · turn the belly into the flow: pitch ${gp}° ${turn}`, off > 30 && alt < ATMO + 12];
  const e = info.err;
  return [`Reentry · belly into the flow (${gp}° ${turn}) · ${e == null ? "" : Math.abs(e) < 3 ? "on target ✓" : e > 0 ? `${e.toFixed(0)} km short: → nose down to stretch` : `${(-e).toFixed(0)} km long: ← nose up to shorten`}`, off > 35];
}

// ---------------------------------------------------------------- frame
const comV = new THREE.Vector3();
function render(t) {
  uTime.value = t;
  scene.updateMatrixWorld(true);
  uCam.value.copy(camera.position);
  skyGroup.position.copy(camera.position);
  for (const m of meshes) m.updateVersion();
  renderer.setRenderTarget(rt);
  renderer.setClearColor(0x000000, 0);
  renderer.clear();
  renderer.render(scene, camera);
  renderer.setRenderTarget(null);
  camera.updateMatrixWorld();
  post.setCamera(camera);
  post.render(renderer, rt.texture, state.quant, state.dither);
}

function frameAttract(dt) {
  attractT += dt;
  if (attractT > T_END) attractT = 0;
  const t = attractT, f = flightState(t);
  comV.fromArray(f.com);
  poseShip(comV.y, comV.z, f.pitch, f.roll);
  setFlaps(f.fwdL, f.fwdR, f.aftL, f.aftR);
  setArms(f.arms, f.bounce);
  scene.updateMatrixWorld(true);
  groups.ship.localToWorld(tmpV.copy(engLocal));
  uEng.value.copy(tmpV);
  const baseY = groups.root.position.y;
  const target = f.throttle * (1 - smooth((baseY - 0.8) / 4));
  steam = target > steam ? lerp(steam, target, 1 - Math.exp(-dt * 2.5)) : lerp(steam, target, 1 - Math.exp(-dt * 0.35));
  if (t < 0.05) steam = 0;
  uFx.value.set(f.throttle * 2.2 * (0.9 + 0.1 * Math.sin(t * 41)), f.throttle, steam, f.plasma);
  uAux.value.set(0, CATCH[2], -1, isDay() ? 1 : 0);
  attractCamera(t, comV);
  uFog.value.set(camera.position.distanceTo(comV) + 6, camera.position.distanceTo(comV) + 55);
  render(t);
}

function frameGame(dt, now, draw = true) {
  const g = game;
  if (!paused) {
    const canWarp = g.mission.id === "descent" && !g.lit && shipPoints(g).base[1] > 900 && g.status === "flying";
    touch?.setWarp(canWarp);
    const warp = keys.warp && canWarp ? 3 : 1;
    acc += dt * warp;
    while (acc >= DT) {
      const was = g.status;
      physicsStep(g, keys, DT);
      acc -= DT;
      if (was === "flying" && g.status !== "flying") {
        endTimer = g.status === "crashed" ? 2.2 : 1.8;
        if (g.status === "crashed") crashFx(new THREE.Vector3(0, Math.max(0.05, g.boomAt[1] / U), g.boomAt[0] / U), g.hit, g.z / U);
        if (g.status === "caught") { caughtAt = now; ui.toast("CAUGHT!"); }
        if (g.status === "caught" && g.missionKey === "orbit") {
          // around the world and back into the arms
          const bonus = Math.round(1500 + 600 * (1 - Math.min(1, Math.abs(g.orbit.err) / ORBIT_DIFF[g.diffKey].window)));
          g.result.score += bonus;
          g.reason = `Once around the planet and caught · orbit bonus +${bonus}`;
        }
        if (g.status === "landed") ui.toast("TOUCHDOWN");
        break;
      }
    }
    for (const ev of g.events.splice(0)) ui.toast({ ignite: "IGNITION", shutdown: "ENGINES OFF", flameout: "FLAMEOUT · NO FUEL" }[ev] || ev);
  }

  // pose
  let bounce = 0, roll = 0;
  if (caughtAt >= 0) { const k = now - caughtAt; bounce = -0.018 * Math.exp(-2.6 * k) * Math.sin(k * 9); roll = 1.2 * Math.exp(-0.7 * k) * Math.sin(k * 2.3); }
  poseShip(g.y / U + bounce, g.z / U, g.pitch, roll);
  // flaps: steering on the glide, folded for the burn
  flapAnim += ((g.lit || g.grounded ? 1 : 0) - flapAnim) * Math.min(1, dt * 1.5);
  const steer = g.w / 30;
  const fwd = lerp(0.22 + 0.3 * steer, 1.25, flapAnim), aft = lerp(0.2 - 0.3 * steer, 1.1, flapAnim);
  setFlaps(fwd, fwd, aft, aft);
  setArms(g.mission.id === "descent" ? g.arms : 0.85, bounce);

  scene.updateMatrixWorld(true);
  groups.ship.localToWorld(tmpV.copy(engLocal));
  const thr = g.lit ? g.thr : 0;
  const speed = Math.hypot(g.vz, g.vy);
  const p = shipPoints(g);
  const baseU = p.base[1] / U;
  const ground = g.mission.id === "descent" && Math.abs(g.z / U - CATCH[2]) < OLM_R ? OLM_TOP : 0;
  const target = thr * (1 - smooth((baseU - ground - 0.2) / 4));
  steam = target > steam ? lerp(steam, target, 1 - Math.exp(-dt * 2.5)) : lerp(steam, target, 1 - Math.exp(-dt * 0.35));
  const boomAge = uAux.value.z;
  if (!paused) updateShatter(dt);
  if (boomAge >= 0) {
    if (!paused) uAux.value.z += dt;
    uEng.value.copy(uBoom.value);
    uFx.value.set(3.2 * Math.exp(-boomAge * 1.3), 0, steam, 0);
  } else {
    uEng.value.copy(tmpV);
    uFx.value.set(thr * 2.2 * (0.9 + 0.1 * Math.sin(now * 41) * Math.sin(now * 17)), thr, steam, smooth((speed - 105) / 50));
  }
  uAux.value.x = 0; uAux.value.y = p.base[0] / U;

  comV.set(0, g.y / U, g.z / U);
  gameCamera(g, dt, comV);
  const cd = camera.position.distanceTo(comV);
  uFog.value.set(cd + 7, cd + 60);

  ui.update(g);
  const [h, urgent] = paused ? [touchMode ? "PAUSED · tap ▶ to resume" : "PAUSED · P to resume", false] : coach(g);
  ui.hint(h, urgent);

  if (g.status !== "flying" && endTimer > 0 && !paused) {
    endTimer -= dt;
    if (endTimer <= 0) { mode = "result"; ui.showResult(g); touch?.show(false); }
  }
  if (draw) render(now);
}

function frame(ms) {
  const now = ms / 1000;
  const dt = Math.min(0.05, Math.max(0, now - (lastTime || now)));
  lastTime = now;
  if (mode === "menu") frameAttract(dt);
  else if (mode === "play" || mode === "result") (orb && !game ? frameOrbit : frameGame)(dt, now);
  requestAnimationFrame(frame);
}

// ---------------------------------------------------------------- start
resize();
const loaded = showLoading("assembling Starship, the tower and the pads…");
await new Promise((r) => setTimeout(r, 30));
build();
loaded();

// day or night: shaders, palette, sky and sun/moon all follow one switch
function setTheme(name, announce = false) {
  themeName = THEMES[name] ? name : "night";
  const th = THEMES[themeName];
  uAux.value.w = isDay() ? 1 : 0;
  post.setPalette(surfacePalette(th), [...GLOW, ...th.sky, th.fog]);
  post.setSky(th.sky);
  post.setBackground(th.sky[th.sky.length - 1]);
  nightSky.visible = !isDay();
  daySky.visible = isDay();
  try { localStorage.setItem("starship-time", themeName); } catch {}
  ui?.setTime(themeName);
  touch?.setTime(themeName);
  if (view === "space") applySpace();
  if (announce) ui?.toast(isDay() ? "☀ DAY" : "☾ NIGHT");
}
const toggleTheme = () => setTheme(isDay() ? "night" : "day", true);
setTheme(params.get("time") || (() => { try { return localStorage.getItem("starship-time"); } catch { return null; } })() || "night");

ui = createUI({
  missions: MISSIONS, difficulties: DIFFICULTY,
  time: () => themeName,
  onTime: (name) => setTheme(name, true),
  onStart: (m, d) => startGame(m, d),
  onRetry: () => startGame(cur.mission, cur.diff),
  onNext: () => startGame(nextMission(cur.mission), cur.diff),
  onMenu: () => toMenu(),
});
// phones and tablets get on-screen buttons; a first touch turns them on too
const enableTouch = () => {
  if (touchMode) return;
  touchMode = true;
  document.documentElement.classList.add("touch");
  touch = createTouchControls({
    keys,
    onPause: () => mode === "play" && togglePause(),
    onCamera: () => mode === "play" && cycleCamera(),
    onRestart: () => (game || orb) && startGame(cur.mission, cur.diff),
    onMenu: () => toMenu(),
    onTime: () => toggleTheme(),
  });
  touch.setTime(themeName);
  ui.setTouch(true);
  if (mode === "play") touch.show(true);
};
if (isTouchDevice()) enableTouch();
window.addEventListener("touchstart", enableTouch, { once: true, passive: true });
toMenu();
const auto = params.get("play");
if (auto && MISSIONS[auto]) startGame(auto, params.get("diff") === "pilot" ? "pilot" : "cadet");
// debugging: advance the game by `seconds` with keys held, independent of
// animation frames (which stop when the tab is hidden)
let vnow = 0;
const tick = async (seconds, held = {}) => {
  Object.assign(keys, { up: false, down: false, left: false, right: false, warp: false }, held);
  const n = Math.max(1, Math.round(seconds * 60));
  const run = (d, draw) => (mode === "menu" ? frameAttract(d) : (orb && !game ? frameOrbit : frameGame)(d, vnow, draw));
  for (let i = 0; i < n; i++) { vnow += 1 / 60; run(1 / 60, i >= n - 1); }
  // Spark sorts asynchronously: give it a few drawn frames to catch up
  for (let i = 0; i < 4; i++) { await new Promise((r) => setTimeout(r, 30)); run(0, true); }
  if (orb && !game) return { t: +orb.t.toFixed(1), alt: +altOf(orb).toFixed(2), speed: +Math.hypot(orb.vu, orb.vv).toFixed(3), pitch: +orb.pitch.toFixed(1), stage: orb.stage, thr: +orb.thr.toFixed(2), lit: orb.lit, phase: orb.phase, swept: +orb.swept.toFixed(1), status: orb.status, reason: orb.reason, view, warp: orbWarp };
  const g = game;
  return g && { t: +g.t.toFixed(2), z: +g.z.toFixed(1), y: +g.y.toFixed(1), vz: +g.vz.toFixed(1), vy: +g.vy.toFixed(1), pitch: +g.pitch.toFixed(1), thr: +g.thr.toFixed(2), lit: g.lit, fuel: +(g.fuel / g.fuel0).toFixed(2), status: g.status, reason: g.reason };
};
window.game = { debug: { groups, uEx, uFx, camera, scene, shatters }, get state() { return game; }, get orbit() { return orb; }, keys, start: startGame, menu: toMenu, get mode() { return mode; }, tick };
requestAnimationFrame(frame);
