// Starship, the catch tower and the launch site, modelled from SDF shapes.
//
// Every moving part is its own surfel cloud,
// lighting is computed live in the shader (not baked), so the ship can flip
// and the engine light can sweep across the tower.
//
// Units: 1 unit = 25 m. The ship is 2 units (50 m) tall and 0.36 wide (9 m).
// Ship-local origin is the engine exit plane, +y towards the nose, the belly
// (heat shield) faces -z, the flaps and catch pins stick out along ±x.

import { sphere, ellipsoid, cone, box, cyl, shape, sampleSurface, worley } from "./engine/sdf.js";
import { vnoise3, mulberry32 } from "./engine/noise.js";

export const M = {
  steel: 0, tile: 1, dark: 2, bell: 3, tower: 4, concrete: 5, sand: 6, ocean: 7,
  lamp: 8, beacon: 9, tank: 10, rail: 11, pin: 12, grass: 13, paint: 14,
};
export const MAT_SCALE = 16; // material id is stored as rgba.r = m / 16

export const R = 0.18; // ship radius
export const SHIP_H = 0.011; // ship surfel spacing
export const COM_Y = 0.85; // centre of mass, ship-local (the flip pivots here)
export const PIN_Y = 1.32; // catch pins
export const ARM_Y = 2.1; // chopstick arm centre height
export const ARM_TOP = ARM_Y + 0.05;
export const CATCH = [0, 0, 0.62]; // where the ship hangs (x, -, z), in front of the tower
export const FINAL_BASE_Y = ARM_TOP - (PIN_Y - 0.015); // ship base height once it rests on the arms
export const TOWER_H = 3.3;
export const TOWER_HALF = 0.27; // tower + carriage half width (for collisions)
export const OLM_TOP = 0.71, OLM_R = 0.33;
export const SHORE_Z = 3.55; // ocean begins past this z (on the x = 0 line)
// the hop: two landing pads inland, a tall building between them
export const PAD_A = -14.5, PAD_B = -3.4, PAD_R = 0.75, PAD_TOP = 0.04;
export const LEG_DROP = 0.07; // landing legs reach this far below the engine plane
export const BUILDING = { z: -9.0, hz: 0.45, hx: 0.75, h: 2.6 };
export const ENGINES = [90, 210, 330].map((a) => [0.058 * Math.cos((a * Math.PI) / 180), 0.058 * Math.sin((a * Math.PI) / 180)]);

const D2R = Math.PI / 180;

// ---- the ship ---------------------------------------------------------------
function shipShape() {
  const s = shape();
  const top = 1.28;
  s.add(cyl(0, 0.08 + (top - 0.08) / 2, 0, R, (top - 0.08) / 2, 0.012), M.steel);
  // ogive nose: an ellipsoid sharpened by a blended cone
  s.add(ellipsoid(0, top, 0, R, 0.62, R), M.steel);
  s.add(cone([0, top + 0.02, 0], [0, 1.93, 0], R * 0.86, 0.03), M.steel, 0.1);
  // open aft skirt: the engines sit inside
  s.sub(cyl(0, 0.08, 0, R - 0.014, 0.05, 0.004), M.dark);
  // sea-level Raptors (inner ring) and vacuum Raptors (outer ring)
  for (const [x, z] of ENGINES) {
    s.add(cone([x, 0.13, z], [x, 0.0, z], 0.018, 0.038), M.bell);
    s.sub(cone([x, 0.1, z], [x, -0.01, z], 0.008, 0.031), M.dark);
  }
  for (const a of [30, 150, 270]) {
    const x = 0.118 * Math.cos(a * D2R), z = 0.118 * Math.sin(a * D2R);
    s.add(cone([x, 0.14, z], [x, 0.02, z], 0.022, 0.05), M.bell);
    s.sub(cone([x, 0.11, z], [x, 0.01, z], 0.01, 0.043), M.dark);
  }
  // flap hinge fairings, catch pins, a raceway down the leeward side
  for (const sx of [-1, 1]) {
    s.add(ellipsoid(sx * R * 0.96, 1.56, -0.03, 0.03, 0.15, 0.045), M.steel, 0.02);
    s.add(ellipsoid(sx * R * 0.96, 0.3, -0.03, 0.035, 0.21, 0.05), M.steel, 0.02);
    s.add(box(sx * (R + 0.03), PIN_Y, 0.0, 0.035, 0.015, 0.032, 0.006), M.pin);
  }
  s.add(box(0, 0.75, R * 0.97, 0.022, 0.55, 0.018, 0.008), M.steel);
  return s;
}

// a flap in its own hinge space: hinge on the y axis, blade out along +x (or -x)
function flapShape(sx, len, halfH, taper) {
  const s = shape();
  s.add(box(sx * len * 0.5, 0, 0, len * 0.5, halfH, 0.011, 0.008), M.tile);
  // trapezoid: cut the outer top corner away
  const cut = (x, y, z) => {
    const u = sx * x / len, v = (y + halfH) / (2 * halfH); // 0..1
    return (v - (1 - taper * u)) * 0.12; // > 0 above the slanted edge
  };
  return { dist: (x, y, z) => Math.max(s.dist(x, y, z), cut(x, y, z)), mat: () => M.tile };
}

function shipDetail(m, x, y, z, n) {
  // belly half (and the nose's belly side) is the black heat shield
  if ((m === M.steel) && z < R * 0.06 - (y > 1.3 ? 0.02 : 0) && Math.abs(x) < R * 1.02 && y > 0.07) m = M.tile;
  let det = 0.5;
  if (m === M.tile) {
    // hexagonal tiles: dark grout where Worley cells meet
    const [, e] = worley(x * 34, y * 30, z * 34, 2);
    det = e < 0.08 ? 0.1 : 0.55 + 0.25 * (vnoise3(x * 50, y * 50, z * 50) - 0.5);
  } else if (m === M.steel) {
    const ring = Math.abs(((y * 11.3) % 1) - 0.5) > 0.47; // weld lines between rings
    det = (ring ? 0.32 : 0.55) + 0.18 * (vnoise3(x * 20, y * 6, z * 20) - 0.5);
  } else if (m === M.bell) det = 0.4 + 0.3 * Math.min(1, (0.13 - y) / 0.13);
  return [m, det];
}

function flapDetail(m, x, y, z, n) {
  // tiles on the windward face, bare steel on the back
  if (n[2] > 0.3) return [M.steel, 0.5 + 0.15 * (vnoise3(x * 30, y * 30, 1) - 0.5)];
  const [, e] = worley(x * 34, y * 30, z * 34, 4);
  return [M.tile, e < 0.08 ? 0.1 : 0.55];
}

// ---- tower, arms, launch mount, tank farm -------------------------------------
function towerShape() {
  const s = shape();
  const w = 0.2, r = 0.011, step = 0.22;
  for (const [cx, cz] of [[w, w], [-w, w], [w, -w], [-w, -w]]) s.add(box(cx, TOWER_H / 2, cz, 0.026, TOWER_H / 2, 0.026, 0.004), M.tower);
  // the lattice is one shape that only looks at the bracing levels next to the
  // point, instead of 120 separate primitives each checked on every sample
  const corners = [[w, w], [-w, w], [-w, -w], [w, -w]];
  const levels = [];
  for (let k = 0, y = 0.12; y < TOWER_H - 0.05; y += step, k++) {
    const members = [];
    for (let f = 0; f < 4; f++) {
      const a = corners[f], b = corners[(f + 1) % 4];
      members.push(cone([a[0], y, a[1]], [b[0], y, b[1]], r, r));
      const flip = (k + f) & 1;
      if (y + step < TOWER_H) members.push(cone([a[0], y + (flip ? step : 0), a[1]], [b[0], y + (flip ? 0 : step), b[1]], r * 0.8, r * 0.8));
    }
    levels.push(members);
  }
  s.add((x, y, z) => {
    const ax = Math.max(Math.abs(x), Math.abs(z)) - w;
    if (ax > 0.1 || ax < -0.1) return Math.abs(ax) - 0.02; // far from the faces
    const k = Math.floor((y - 0.12) / step);
    let d = 1e9;
    for (let kk = k - 1; kk <= k + 1; kk++) {
      const L = levels[kk];
      if (L) for (const f of L) { const v = f(x, y, z); if (v < d) d = v; }
    }
    return d;
  }, M.tower);
  // carriage that carries the arms, and the top with its crane and rod
  s.bound(0, ARM_Y, 0, 0.6);
  s.add(box(0, ARM_Y + 0.02, 0, 0.27, 0.13, 0.27, 0.01), M.tower);
  s.sub(box(0, ARM_Y + 0.02, 0, 0.215, 0.2, 0.215, 0.0), M.dark);
  s.add(box(0, ARM_Y + 0.02, 0.24, 0.27, 0.06, 0.04, 0.006), M.rail);
  s.bound();
  s.bound(0, TOWER_H, 0, 0.8);
  s.add(box(0, TOWER_H + 0.02, 0, 0.25, 0.03, 0.25, 0.006), M.tower);
  s.add(box(0, TOWER_H + 0.1, -0.05, 0.08, 0.06, 0.12, 0.01), M.tower);
  s.add(cone([0, TOWER_H + 0.1, -0.1], [0, TOWER_H + 0.35, 0.45], 0.022, 0.012), M.tower);
  s.add(cone([0.15, TOWER_H, 0.15], [0.15, TOWER_H + 0.42, 0.15], 0.012, 0.005), M.tower);
  s.add(sphere(0.15, TOWER_H + 0.44, 0.15, 0.022), M.beacon);
  s.add(sphere(0, TOWER_H + 0.36, 0.46, 0.02), M.beacon);
  s.bound();
  // floodlights on the tower face, beacons part way up
  for (const y of [0.6, 1.25, 2.7]) {
    s.bound(0, y, 0.25, 0.25);
    s.add(box(0.12, y, w + 0.045, 0.04, 0.025, 0.012, 0.004), M.lamp).add(box(-0.12, y, w + 0.045, 0.04, 0.025, 0.012, 0.004), M.lamp);
    s.bound();
  }
  s.add(sphere(w + 0.03, 1.6, w + 0.03, 0.02), M.beacon);
  // launch mount (the ship hangs over it) with its legs and deluge plate
  const [mx, , mz] = CATCH;
  s.bound(mx, 0.35, mz, 0.6);
  s.add(cyl(mx, 0.66, mz, 0.3, 0.045, 0.01), M.tower);
  s.sub(cyl(mx, 0.66, mz, 0.21, 0.1, 0.0), M.dark);
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * Math.PI * 2 + 0.5;
    s.add(box(mx + Math.cos(a) * 0.27, 0.31, mz + Math.sin(a) * 0.27, 0.035, 0.31, 0.035, 0.006), M.concrete);
  }
  s.add(cyl(mx, 0.012, mz, 0.24, 0.012, 0.004), M.tower);
  s.bound();
  // a pipe run from the tank farm to the mount
  s.add(cone([-1.35, 0.06, -0.9], [mx - 0.25, 0.06, mz - 0.1], 0.025, 0.025), M.tank);
  return s;
}

function towerDetail(m, x, y, z) {
  if (m === M.tower) return [m, 0.5 + 0.25 * (vnoise3(x * 18, y * 18, z * 18) - 0.5)];
  if (m === M.concrete) return [m, 0.5 + 0.2 * (vnoise3(x * 30, y * 30, z * 30) - 0.5)];
  return [m, 0.5];
}

function armShape(sx) {
  // hinge at the origin, arm reaches out along +z
  const s = shape();
  const len = 0.8;
  s.add(box(0, 0, len / 2, 0.035, 0.05, len / 2, 0.008), M.tower);
  for (let k = 0; k < 6; k++) s.sub(box(0, 0, 0.1 + k * 0.12, 0.06, 0.028, 0.04, 0.004), M.dark);
  // the catch rail on top, along the inner edge
  s.add(box(-sx * 0.022, 0.055, len / 2 + 0.06, 0.014, 0.008, len / 2 - 0.06, 0.003), M.rail);
  s.add(cyl(0, 0, 0, 0.05, 0.08, 0.01), M.tower); // hinge drum
  return s;
}

function farmShape() {
  const s = shape();
  const rnd = mulberry32(31);
  // tank farm behind the tower
  for (let i = 0; i < 7; i++) {
    const x = -1.9 + (i % 4) * 0.33 + rnd() * 0.05, z = -1.0 - Math.floor(i / 4) * 0.38, h = 0.25 + rnd() * 0.3;
    s.bound(x, h, z, h + 0.2);
    s.add(cyl(x, h, z, 0.12, h, 0.03), M.tank);
    s.add(sphere(x, 2 * h, z, 0.11), M.tank, 0.04);
    s.bound();
  }
  s.bound(-1.25, 0.2, -1.95, 0.4);
  s.add(sphere(-1.25, 0.24, -1.95, 0.22), M.tank);
  for (let k = 0; k < 4; k++) s.add(cyl(-1.25 + Math.cos(k * 1.57 + 0.78) * 0.15, 0.08, -1.95 + Math.sin(k * 1.57 + 0.78) * 0.15, 0.02, 0.08), M.tower);
  s.bound();
  // a hangar and a smaller building
  s.bound(2.4, 0.5, -2.2, 1.0);
  s.add(box(2.4, 0.42, -2.2, 0.55, 0.42, 0.35, 0.02), M.concrete);
  s.sub(box(2.4, 0.3, -1.84, 0.32, 0.3, 0.05, 0.0), M.lamp);
  s.bound();
  s.bound(1.6, 0.15, -1.5, 0.4);
  s.add(box(1.6, 0.13, -1.5, 0.2, 0.13, 0.15, 0.01), M.concrete);
  s.add(sphere(1.6, 0.3, -1.5, 0.018), M.beacon);
  s.bound();
  // a second, far tower for scale
  s.bound(-3.2, 1.3, -2.8, 1.5);
  s.add(box(-3.2, 1.25, -2.8, 0.12, 1.25, 0.12, 0.01), M.tower);
  s.add(sphere(-3.2, 2.55, -2.8, 0.03), M.beacon);
  s.bound();
  return s;
}

// ---- sampling -----------------------------------------------------------------
function sampled(sh, box, h, detailFn) {
  const s = sampleSurface(sh, box[0], box[1], h);
  const n = s.mat.length, attr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const x = s.p[i * 3], y = s.p[i * 3 + 1], z = s.p[i * 3 + 2];
    const nn = [s.n[i * 3], s.n[i * 3 + 1], s.n[i * 3 + 2]];
    const [m, det] = detailFn(s.mat[i], x, y, z, nn);
    attr[i * 3] = m;
    attr[i * 3 + 1] = Math.max(0, Math.min(1, det));
    attr[i * 3 + 2] = s.ao[i];
  }
  return { count: n, p: new Float32Array(s.p), n: new Float32Array(s.n), attr, h };
}

export function buildShip() {
  const F = { y: 1.56, z: -0.03, len: 0.13, halfH: 0.13 };
  const A = { y: 0.3, z: -0.03, len: 0.17, halfH: 0.2 };
  const parts = [
    { name: "ship", parent: null, pos: [0, 0, 0], ...sampled(shipShape(), [[-0.26, -0.03, -0.24], [0.26, 1.98, 0.24]], SHIP_H, shipDetail) },
  ];
  for (const [nm, f, taper] of [["fwd", F, 0.55], ["aft", A, 0.3]])
    for (const sx of [-1, 1]) {
      const sh = flapShape(sx, f.len, f.halfH, taper);
      const lo = [sx > 0 ? -0.01 : -f.len - 0.02, -f.halfH - 0.02, -0.03], hi = [sx > 0 ? f.len + 0.02 : 0.01, f.halfH + 0.02, 0.03];
      parts.push({ name: `${nm}${sx > 0 ? "R" : "L"}`, parent: "ship", pos: [sx * R * 0.98, f.y, f.z], sx, ...sampled(sh, [lo, hi], SHIP_H, flapDetail) });
    }
  parts.push({ name: "legs", parent: "ship", pos: [0, 0, 0], ...sampled(legsShape(), [[-0.26, -LEG_DROP - 0.03, -0.26], [0.26, 0.26, 0.26]], 0.009, () => [M.tower, 0.5]) });
  return parts;
}

// Super Heavy: the booster under the ship for the orbital launch. Its own
// origin is its engine plane, +y up; the ship sits on top at y = BOOSTER_H.
export const BOOSTER_H = 2.3;
function boosterShape() {
  const s = shape(), Hb = BOOSTER_H;
  s.add(cyl(0, 0.07 + (Hb - 0.07) / 2, 0, R, (Hb - 0.07) / 2, 0.01), M.steel);
  s.sub(cyl(0, 0.07, 0, R - 0.014, 0.05, 0.004), M.dark); // open skirt
  // 33 Raptors: 3 in the middle, 10 around them, 20 on the outer ring
  const rings = [[3, 0.03, 0], [10, 0.085, 0.3], [20, 0.145, 0.1]];
  for (const [n, rr, a0] of rings)
    for (let k = 0; k < n; k++) {
      const a = a0 + (k / n) * Math.PI * 2, x = Math.cos(a) * rr, z = Math.sin(a) * rr, bell = rr > 0.12 ? 0.016 : 0.019;
      s.add(cone([x, 0.1, z], [x, 0.0, z], bell * 0.45, bell), M.bell);
    }
  // the vented hot-staging ring on top, and four grid fins just below it
  s.add(cyl(0, Hb - 0.035, 0, R + 0.004, 0.035, 0.004), M.tower);
  for (let k = 0; k < 12; k++) {
    const a = (k / 12) * Math.PI * 2;
    s.sub(box(Math.cos(a) * R, Hb - 0.035, Math.sin(a) * R, 0.018, 0.02, 0.018, 0.0), M.dark);
  }
  for (const [x, z] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const cx = x * (R + 0.07), cz = z * (R + 0.07);
    s.add(box(cx, Hb - 0.16, cz, x ? 0.06 : 0.075, 0.075, z ? 0.06 : 0.075, 0.004), M.tower);
  }
  // chines (strakes) along the lower body and a pipe run up the side
  for (const sx of [-1, 1]) s.add(box(sx * (R + 0.012), 0.75, 0, 0.012, 0.6, 0.02, 0.004), M.steel);
  s.add(box(0, Hb / 2, R * 0.98, 0.022, Hb * 0.42, 0.016, 0.006), M.steel);
  return s;
}
function boosterDetail(m, x, y, z) {
  if (m === M.steel) {
    const ring = Math.abs(((y * 11.3) % 1) - 0.5) > 0.47;
    // frost from the cold propellant on the lower tank
    const frost = y < 1.3 && vnoise3(x * 14, y * 5, z * 14) > 0.62;
    return [m, (ring ? 0.32 : 0.55) + (frost ? 0.25 : 0) + 0.18 * (vnoise3(x * 20, y * 6, z * 20) - 0.5)];
  }
  if (m === M.tower) {
    const lattice = Math.abs(Math.sin(x * 120) * Math.sin(y * 120) * Math.sin(z * 120)) > 0.6;
    return [m, lattice ? 0.25 : 0.6];
  }
  if (m === M.bell) return [m, 0.4 + 0.3 * Math.min(1, (0.1 - y) / 0.1)];
  return [m, 0.5];
}
export function buildBooster() {
  return { name: "booster", parent: null, pos: [0, 0, 0], ...sampled(boosterShape(), [[-0.3, -0.03, -0.3], [0.3, BOOSTER_H + 0.03, 0.3]], SHIP_H * 1.15, boosterDetail) };
}

// six short landing legs folded out of the skirt (the hop only)
function legsShape() {
  const s = shape();
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * Math.PI * 2 + Math.PI / 6, c = Math.cos(a), sn = Math.sin(a);
    s.add(cone([c * R * 0.92, 0.22, sn * R * 0.92], [c * (R + 0.05), -LEG_DROP + 0.012, sn * (R + 0.05)], 0.011, 0.009), M.tower);
    s.add(sphere(c * (R + 0.05), -LEG_DROP + 0.012, sn * (R + 0.05), 0.016), M.dark);
  }
  return s;
}

// the hop course: start pad, the high bay in the way, target pad
function hopShape() {
  const s = shape();
  for (const z of [PAD_A, PAD_B]) {
    s.bound(0, 0, z, PAD_R + 0.2);
    s.add(cyl(0, PAD_TOP / 2, z, PAD_R, PAD_TOP / 2 + 0.004, 0.01), M.concrete);
    for (let k = 0; k < 10; k++) {
      const a = (k / 10) * Math.PI * 2;
      s.add(sphere(Math.cos(a) * (PAD_R - 0.04), PAD_TOP + 0.008, z + Math.sin(a) * (PAD_R - 0.04), 0.017), M.lamp);
    }
    s.bound();
  }
  const { z, hz, hx, h } = BUILDING;
  s.bound(0, h / 2, z, h);
  s.add(box(0, h / 2, z, hx, h / 2, hz, 0.02), M.concrete);
  s.add(box(0, h + 0.03, z, hx * 0.8, 0.04, hz * 0.8, 0.01), M.tower);
  s.sub(box(0, h * 0.36, z + hz, hx * 0.55, h * 0.36, 0.02, 0.0), M.dark); // the big door
  for (let k = 0; k < 4; k++) s.add(box(0, h * (0.2 + k * 0.2), z - hz - 0.005, hx * 0.9, 0.012, 0.012, 0.004), M.lamp);
  s.add(sphere(hx * 0.7, h + 0.1, z, 0.025), M.beacon).add(sphere(-hx * 0.7, h + 0.1, z, 0.025), M.beacon);
  s.bound();
  return s;
}

function hopDetail(m, x, y, z) {
  if (m === M.concrete && y < PAD_TOP + 0.01) {
    // pad markings: a ring and a cross
    const pz = Math.abs(z - PAD_A) < PAD_R + 0.05 ? PAD_A : PAD_B, r = Math.hypot(x, z - pz);
    if ((r > PAD_R * 0.62 && r < PAD_R * 0.7) || (r < PAD_R * 0.45 && (Math.abs(x) < 0.03 || Math.abs(z - pz) < 0.03))) return [M.paint, 0.5];
    return [M.concrete, 0.5 + 0.2 * (vnoise3(x * 20, 0, z * 20) - 0.5)];
  }
  if (m === M.concrete) return [m, (Math.abs(((y * 6) % 1) - 0.5) > 0.46 ? 0.3 : 0.55) + 0.15 * (vnoise3(x * 12, y * 12, z * 12) - 0.5)];
  return [m, 0.5];
}

export function buildSite() {
  const parts = [
    { name: "tower", parent: null, pos: [0, 0, 0], ...sampled(towerShape(), [[-0.65, -0.02, -1.0], [0.65, TOWER_H + 0.5, 0.95]], 0.0125, towerDetail) },
    { name: "farm", parent: null, pos: [0, 0, 0], ...sampled(farmShape(), [[-3.5, -0.02, -3.1], [3.0, 2.65, -0.6]], 0.03, towerDetail) },
  ];
  for (const sx of [-1, 1])
    parts.push({ name: sx > 0 ? "armR" : "armL", parent: null, pos: [sx * 0.225, ARM_Y, 0.25], sx, ...sampled(armShape(sx), [[-0.08, -0.1, -0.08], [0.08, 0.08, 0.84]], 0.011, towerDetail) });
  const hop = hopShape(), B = BUILDING;
  for (const z of [PAD_A, PAD_B]) parts.push({ name: z === PAD_A ? "padA" : "padB", parent: null, pos: [0, 0, 0], ...sampled(hop, [[-PAD_R - 0.05, -0.02, z - PAD_R - 0.05], [PAD_R + 0.05, PAD_TOP + 0.04, z + PAD_R + 0.05]], 0.02, hopDetail) });
  parts.push({ name: "bay", parent: null, pos: [0, 0, 0], ...sampled(hop, [[-B.hx - 0.05, -0.02, B.z - B.hz - 0.05], [B.hx + 0.05, B.h + 0.16, B.z + B.hz + 0.05]], 0.028, hopDetail) });
  return parts;
}

// Flat ground and sea are laid out directly on a grid: no SDF needed.
// Returns surfels with the up normal and a per-surfel splat size.
// the coastline on the x = 0 line is at SHORE_Z; elsewhere it wanders
export const shoreAt = (x) => 3.4 + 0.35 * Math.sin(x * 0.55) + 0.2 * Math.sin(x * 1.7 + 1);

// Dune height (scene units). Flat where things stand or the ship flies: the
// flight corridor (|x| < 1.35), the tank farm and buildings, and the beach.
export function duneHeight(x, z) {
  const sstep = (a, b, v) => { const t = Math.max(0, Math.min(1, (v - a) / (b - a))); return t * t * (3 - 2 * t); };
  const corridor = sstep(1.35, 2.4, Math.abs(x));
  const fx = Math.max(-3.8 - x, x - 3.4, 0), fz = Math.max(-3.4 - z, z + 0.4, 0);
  const farm = sstep(0, 0.9, Math.hypot(fx, fz));
  const beach = sstep(0.45, 1.7, shoreAt(x) - z);
  const mask = Math.min(corridor, farm) * beach;
  if (mask <= 0) return 0;
  // long wind-blown ridges plus some lumps
  const ridge = 1 - Math.abs(2 * vnoise3(x * 0.55 + z * 0.22, 7, z * 0.75 - x * 0.1) - 1);
  return mask * (0.2 * ridge * ridge + 0.07 * vnoise3(x * 1.7, 2, z * 1.7) + 0.02 * vnoise3(x * 5, 4, z * 5));
}

export function buildGround() {
  const p = [], n = [], attr = [], size = [];
  const rnd = mulberry32(77);
  const put = (x, y, z, nx, ny, nz, step, m, det) => { p.push(x, y, z); n.push(nx, ny, nz); attr.push(m, det, 1); size.push(step); };
  // finer near the pad, coarser further out; the outer ring runs on to the
  // horizon haze so the world has no visible edge
  const R0 = 70, e = 0.04;
  for (const [lo, hi, step] of [[0, 2.6, 0.026], [2.6, 7, 0.045], [7, 18, 0.085], [18, R0, 0.55]]) {
    for (let z = -hi; z < hi; z += step)
      for (let x = -hi; x < hi; x += step) {
        const ax = Math.max(Math.abs(x), Math.abs(z));
        if (ax < lo || ax >= hi) continue;
        const jx = x + (rnd() - 0.5) * step * 0.3, jz = z + (rnd() - 0.5) * step * 0.3;
        if (Math.hypot(jx, jz) > R0) continue;
        const sh = shoreAt(jx);
        // the sea: the shader does the colour, from depth, waves and light
        if (jz > sh) { put(jx, 0, jz, 0, 1, 0, step, M.ocean, rnd()); continue; }
        // concrete pad around the tower and a road
        const pad = Math.abs(jx) < 1.25 && jz > -1.25 && jz < 1.7;
        const road = Math.abs(jz + 1.55 - 0.08 * jx) < 0.12 && jx > -4 && jx < 4;
        if (pad || road) {
          const seam = Math.abs(((jx * 2.5) % 1 + 1) % 1 - 0.5) > 0.47 || Math.abs(((jz * 2.5) % 1 + 1) % 1 - 0.5) > 0.47;
          const scorch = Math.exp(-((jx - CATCH[0]) ** 2 + (jz - CATCH[2]) ** 2) / 0.35);
          put(jx, 0, jz, 0, 1, 0, step, M.concrete, (seam ? 0.3 : 0.55 + 0.15 * (vnoise3(jx * 6, 0, jz * 6) - 0.5)) - 0.4 * scorch);
          continue;
        }
        // sand dunes with wind ripples; scrub grows in clumps away from the beach
        const y = duneHeight(jx, jz);
        const gx = (duneHeight(jx + e, jz) - duneHeight(jx - e, jz)) / (2 * e), gz = (duneHeight(jx, jz + e) - duneHeight(jx, jz - e)) / (2 * e);
        const gl = Math.hypot(gx, 1, gz);
        const inland = sh - jz;
        const ripple = Math.sin((jx * 0.35 + jz) * 34 + 3 * vnoise3(jx * 2, 5, jz * 2));
        let det = 0.5 + 0.1 * ripple + 0.22 * (vnoise3(jx * 3, 1, jz * 3) - 0.5);
        // sparse bushes: small clumps, thicker in the dune hollows behind the beach
        const clump = vnoise3(jx * 2.2, 3, jz * 2.2) * 0.45 + vnoise3(jx * 9, 9, jz * 9) * 0.55;
        const scrub = inland > 1.1 && clump > 0.72 - 0.05 * Math.min(1, (inland - 1.1) / 3);
        if (scrub) det = 0.35 + 0.5 * vnoise3(jx * 14, 2, jz * 14); // lit tips and dark stems
        put(jx, y, jz, -gx / gl, 1 / gl, -gz / gl, step, scrub ? M.grass : M.sand, det);
      }
  }
  return { count: size.length, p: new Float32Array(p), n: new Float32Array(n), attr: new Float32Array(attr), size: new Float32Array(size) };
}
