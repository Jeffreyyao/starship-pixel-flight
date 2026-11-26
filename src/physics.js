// Game physics for the two missions. Pure functions, no three.js, so the
// difficulty can be tuned headlessly (tools/starship-tune.mjs).
//
// The flight is planar: the ship moves in the y–z plane (x = 0) and pitches
// about x, so arrow keys map one-to-one onto what the side camera shows.
// Units here are metres and seconds; the renderer divides by U.
//
// Pitch: 0° upright, -90° belly-down with the nose towards -z (screen right),
// positive pitch tilts the nose towards +z (screen left).

import {
  COM_Y, R, PIN_Y, ARM_TOP, CATCH, FINAL_BASE_Y, TOWER_H, TOWER_HALF, OLM_TOP, OLM_R, SHORE_Z,
  PAD_A, PAD_B, PAD_R, PAD_TOP, LEG_DROP, BUILDING,
} from "./model.js";

export const U = 25; // metres per scene unit
export const G = 9.81;
export const MAX_ACC = 2.0 * G; // thrust at 100%: hovering takes ~50%
export const MIN_THR = 0.4; // Raptors can't throttle below this
const CN = 0.00136; // drag across the hull (belly-flop terminal ≈ 85 m/s)
const CA = 0.0005; // drag along the hull
const SHIP_LEN = 2.0 * U;

export const DIFFICULTY = {
  cadet: { label: "CADET", fuel: 1.6, wind: 0.35, vy: 5, vh: 3, tilt: 12, offset: 6 },
  pilot: { label: "PILOT", fuel: 1.0, wind: 1.0, vy: 3.5, vh: 2.5, tilt: 8, offset: 3 },
};

export const MISSIONS = {
  descent: {
    id: "descent", label: "RETURN FROM SPACE", short: "catch",
    blurb: "Fall from 2.4 km on the belly, glide in, flip, burn, and drop the ship's pins onto the tower's chopsticks.",
    fuel: 24, wind: 1.0, legs: false,
    target: { z: CATCH[2] * U, y: (FINAL_BASE_Y + COM_Y) * U },
    start: { z: 980, y: 2400, vz: -45, vy: -150, pitch: -90 },
  },
  hop: {
    id: "hop", label: "PAD TO PAD HOP", short: "hop",
    blurb: "Lift off from pad A, clear the high bay, cross 275 m and land on the legs on pad B.",
    fuel: 30, wind: 1.0, legs: true,
    target: { z: PAD_B * U, y: (PAD_TOP + LEG_DROP + COM_Y) * U },
    start: { z: PAD_A * U, y: (PAD_TOP + LEG_DROP + COM_Y) * U, vz: 0, vy: 0, pitch: 0, grounded: true },
  },
};

// the orbital mission's own flight lives in orbit.js; it ends in a "descent"
// game for the catch. Listed here so the menu shows it with the others.
MISSIONS.orbit = {
  id: "orbit", label: "ORBITAL FLIGHT", short: "orbit",
  blurb: "Launch the full stack, stage, reach orbit, go once around the planet, reenter belly-first and get caught by the tower.",
};

export function newGame(mission, diff) {
  const s = mission.start, fuel = mission.fuel * diff.fuel;
  return {
    mission, diff, t: 0,
    z: s.z, y: s.y, vz: s.vz, vy: s.vy, pitch: s.pitch, w: 0,
    thr: 0, lit: false, lowHold: 0, fuel, fuel0: fuel,
    grounded: !!s.grounded, airborne: !s.grounded, maxAlt: 0,
    arms: 0.85, pinPrev: Infinity,
    status: "flying", reason: "", result: null, boomAt: null, events: [],
  };
}

const D2R = Math.PI / 180;
export const axisOf = (pitch) => [Math.sin(pitch * D2R), Math.cos(pitch * D2R)]; // [z, y]
export const windAt = (g, t) => g.diff.wind * g.mission.wind * (0.65 * Math.sin(t * 0.21 + 1.3) + 0.45 * Math.sin(t * 0.57 + 4.1) + 0.2 * Math.sin(t * 1.9));

// acceleration of the centre of mass for a given state (no ground contact)
function accel(z, y, vz, vy, pitch, thrust, wind) {
  const [az, ay] = axisOf(pitch), nz = ay, ny = -az; // hull axis and the belly normal
  const rho = Math.exp(-Math.max(0, y) / 8000);
  const vn = vz * nz + vy * ny, va = vz * az + vy * ay;
  const fn = -CN * rho * vn * Math.abs(vn), fa = -CA * rho * va * Math.abs(va);
  return [thrust * az + fn * nz + fa * az + wind, -G + thrust * ay + fn * ny + fa * ay];
}

export const shipPoints = (g) => {
  const [az, ay] = axisOf(g.pitch);
  const base = [g.z - az * COM_Y * U, g.y - ay * COM_Y * U];
  return { base, nose: [base[0] + az * SHIP_LEN, base[1] + ay * SHIP_LEN], axis: [az, ay] };
};

// ground height under z (metres), and what is there
function groundAt(g, z) {
  const zu = z / U;
  if (g.mission.id === "descent" && Math.abs(zu - CATCH[2]) < OLM_R) return [OLM_TOP * U, "mount"];
  if (Math.abs(zu - PAD_A) < PAD_R) return [PAD_TOP * U, "padA"];
  if (Math.abs(zu - PAD_B) < PAD_R) return [PAD_TOP * U, "padB"];
  if (zu > SHORE_Z) return [0, "ocean"];
  return [0, "ground"];
}

// hit: the facility the ship crashed into, if any (it shatters with it)
function crash(g, reason, at, hit = null) {
  if (g.status !== "flying") return;
  g.status = "crashed";
  g.reason = reason;
  g.hit = hit;
  g.boomAt = at;
  g.lit = false;
  g.thr = 0;
}

function finish(g, status, reason, offsetM) {
  g.status = status;
  g.reason = reason;
  g.lit = false;
  g.thr = 0;
  const d = g.diff, vy = Math.abs(g.vy), vh = Math.abs(g.vz), tilt = Math.abs(g.pitch);
  let score = 1000 + (g.fuel / g.fuel0) * 600 - vy * 70 - vh * 70 - tilt * 12 - offsetM * 20;
  if (g.diff === DIFFICULTY.pilot) score *= 1.5;
  score = Math.max(100, Math.round(score));
  const precise = vy < d.vy * 0.5 && vh < d.vh * 0.5 && offsetM < d.offset && tilt < d.tilt * 0.5;
  g.result = { score, vy, vh, tilt, offset: offsetM, fuel: g.fuel / g.fuel0, rating: precise ? "PERFECT" : score > 1100 ? "GREAT" : "GOOD", time: g.t };
  g.vy = g.vz = g.w = 0;
}

// one fixed step. input: { up, down, left, right }
export function step(g, input, dt) {
  if (g.status !== "flying") {
    // caught: the arms finish closing; nothing else moves
    g.arms = Math.max(0, g.arms - dt * 0.9);
    return;
  }
  g.t += dt;
  const d = g.diff;

  // ---- throttle: ↑ lights the engines at the minimum and opens up; ↓ closes
  //      down to the minimum, and held there for half a second shuts them off
  if (input.up && g.fuel > 0) {
    if (!g.lit) { g.lit = true; g.thr = MIN_THR; g.events.push("ignite"); }
    g.thr = Math.min(1, g.thr + 0.75 * dt);
  }
  if (input.down && g.lit) {
    g.thr -= 0.75 * dt;
    if (g.thr <= MIN_THR) {
      g.thr = MIN_THR;
      g.lowHold += dt;
      if (g.lowHold > 0.5) { g.lit = false; g.thr = 0; g.events.push("shutdown"); }
    }
  } else g.lowHold = 0;
  if (g.lit) {
    g.fuel -= g.thr * dt;
    if (g.fuel <= 0) { g.fuel = 0; g.lit = false; g.thr = 0; g.events.push("flameout"); }
  }
  const thrust = g.lit ? g.thr * MAX_ACC : 0;

  // ---- attitude: arrows set a rotation rate, letting go holds attitude.
  //      Gimballed engines turn the ship faster than the flaps alone.
  const maxRate = g.lit ? 50 : 30;
  const want = ((input.left ? 1 : 0) - (input.right ? 1 : 0)) * maxRate;
  g.w += (want - g.w) * Math.min(1, dt / 0.22);
  if (!g.grounded) g.pitch = Math.max(-130, Math.min(60, g.pitch + g.w * dt));

  // ---- forces
  const alt = shipPoints(g).base[1];
  const wind = g.grounded ? 0 : windAt(g, g.t) * Math.min(1, alt / 30);
  let [ax, ay] = accel(g.z, g.y, g.vz, g.vy, g.pitch, thrust, wind);
  if (g.grounded) {
    if (ay <= 0.05) { g.vz = g.vy = 0; ax = ay = 0; }
    else g.grounded = false;
  }
  g.vz += ax * dt; g.vy += ay * dt;
  g.z += g.vz * dt; g.y += g.vy * dt;
  const p = shipPoints(g);
  g.maxAlt = Math.max(g.maxAlt, p.base[1]);
  if (!g.airborne && p.base[1] - g.mission.start.y + COM_Y * U > 2) g.airborne = true;

  // ---- structures: sample points along the hull
  for (let k = 0; k <= 16; k++) {
    const u = k / 16, z = p.base[0] + (p.nose[0] - p.base[0]) * u, y = p.base[1] + (p.nose[1] - p.base[1]) * u;
    const r = R * (u < 0.64 ? 1 : Math.max(0.15, (1 - u) / 0.36)) * 0.95; // the nose tapers
    if (Math.abs(z) < (TOWER_HALF + r) * U && y < (TOWER_H + 0.45) * U) return crash(g, "Hit the tower", [z, y], "tower");
    if (Math.abs(z - BUILDING.z * U) < (BUILDING.hz + r) * U && y < BUILDING.h * U) return crash(g, "Hit the high bay", [z, y], "bay");
  }

  // ---- the catch: the chopsticks close when the ship hovers into the window
  //      below them, and take it when the pins come down onto them
  if (g.mission.id === "descent") {
    const zu = g.z / U, baseU = p.base[1] / U;
    const inWindow = Math.abs(zu - CATCH[2]) < 0.4 && Math.abs(g.pitch) < 15 && baseU > FINAL_BASE_Y - 0.1 && baseU < FINAL_BASE_Y + 1.8;
    const want = inWindow ? 0 : 0.85;
    g.arms += Math.sign(want - g.arms) * Math.min(Math.abs(want - g.arms), dt * 0.85);
    const pin = p.base[1] + p.axis[1] * (PIN_Y - 0.015) * U, top = ARM_TOP * U;
    if (g.pinPrev >= top && pin < top && g.arms < 0.25 && zu > 0.44 && zu < 1.0) {
      const vy = -g.vy, vh = Math.abs(g.vz), tilt = Math.abs(g.pitch);
      if (vy > d.vy) return crash(g, `Hit the chopsticks too hard (${vy.toFixed(1)} m/s down)`, [g.z, pin], "arms");
      if (vh > d.vh) return crash(g, `Sliding sideways onto the arms (${vh.toFixed(1)} m/s)`, [g.z, pin], "arms");
      if (tilt > d.tilt) return crash(g, `Too much tilt for the catch (${tilt.toFixed(1)}°)`, [g.z, pin], "arms");
      g.y += top - pin; // settle the pins on the arms
      return finish(g, "caught", "Ship caught by the chopsticks", Math.abs(g.z - CATCH[2] * U));
    }
    g.pinPrev = pin;
  }

  // ---- touchdown
  const foot = g.mission.legs ? LEG_DROP * U * Math.max(0.2, p.axis[1]) : 0;
  for (const pt of [p.base, p.nose]) {
    const [gy, what] = groundAt(g, pt[0]);
    if (pt[1] - (pt === p.base ? foot : 0) > gy) continue;
    if (pt === p.nose || !g.mission.legs) {
      if (what === "ocean") return crash(g, "Splashdown in the Gulf", pt);
      if (what === "mount") return crash(g, "Dropped onto the launch mount", pt, "mount");
      return crash(g, g.mission.legs ? "Tipped over" : "No landing legs: Starship has to be caught", pt);
    }
    // legs on the ground
    if (!g.airborne) { g.y += gy - (pt[1] - foot); g.vy = Math.max(0, g.vy); g.grounded = true; continue; }
    const vy = -g.vy, vh = Math.abs(g.vz), tilt = Math.abs(g.pitch);
    if (what === "ocean") return crash(g, "Splashdown in the Gulf", pt);
    if (vy > d.vy * 1.6 || tilt > d.tilt * 1.8) return crash(g, `Hard landing (${vy.toFixed(1)} m/s, ${tilt.toFixed(0)}°)`, pt, what === "padA" || what === "padB" ? what : null);
    if (vy > d.vy) return crash(g, `Legs collapsed (${vy.toFixed(1)} m/s down, limit ${d.vy})`, pt);
    if (vh > d.vh) return crash(g, `Skidded and tipped (${vh.toFixed(1)} m/s sideways)`, pt);
    if (tilt > d.tilt) return crash(g, `Tipped over (${tilt.toFixed(1)}° tilt)`, pt);
    g.y += gy - (pt[1] - foot);
    if (what === "padB") return finish(g, "landed", "Touchdown on pad B", Math.abs(g.z - PAD_B * U));
    g.status = "missed";
    g.reason = what === "padA" ? "Landed back on pad A" : "Landed safely, but off the pad";
    g.lit = false; g.thr = 0; g.vy = g.vz = 0;
    return;
  }
  if (g.y > 4200 || Math.abs(g.z) > 2400) crash(g, "Lost the ship", [g.z, g.y]);
}

// where the ship is heading if nothing changes: ballistic + current thrust
export function predict(g, seconds = 10, n = 40) {
  const out = [];
  let z = g.z, y = g.y, vz = g.vz, vy = g.vy;
  const thrust = g.lit ? g.thr * MAX_ACC : 0, dt = seconds / n / 4;
  for (let i = 0; i < n * 4; i++) {
    const [ax, ay] = accel(z, y, vz, vy, g.pitch, thrust, 0);
    vz += ax * dt; vy += ay * dt; z += vz * dt; y += vy * dt;
    if (i % 4 === 3) out.push([z, y]);
    if (y - COM_Y * U < 0) break;
  }
  return out;
}

// how far the ship needs to stop its fall with a full-throttle upright burn
export const stoppingDistance = (g) => (g.vy < 0 ? (g.vy * g.vy) / (2 * (MAX_ACC - G)) : 0);
