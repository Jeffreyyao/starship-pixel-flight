// Orbital flight: launch from the pad on the full stack, stage, reach orbit,
// go once around the planet, deorbit and reenter. Below 2.4 km the ship is
// handed to the landing physics (physics.js) for the catch.
//
// Planar, like the rest of the game: the flight stays in one plane through
// the planet's centre. Coordinates (u, v) in km, planet centre at the origin,
// the launch site at the top (0, R). Prograde is clockwise: at the site it is
// +u, which the landing view shows as screen-right (-z).
//
// The planet is scaled down (R = 600 km, surface gravity 1 g) so an orbit is
// ~2.3 km/s and ~31 minutes; the game warps time through the quiet parts.
// Pitch is measured from local vertical, as in the landing view: 0 is up,
// -90 points prograde (belly down), +90 retrograde.

import { TOWER_H, TOWER_HALF, R as SHIP_R, OLM_TOP, OLM_R, CATCH } from "./model.js";

export const PLANET_R = 600; // km
export const G0 = 0.00981; // km/s²
export const MU = G0 * PLANET_R * PLANET_R;
export const ATMO = 80; // km: no drag above, orbit counts above this
const H = 8; // atmosphere scale height, km
const CN = 1.36; // drag across the hull: the landing model's, in km units
const CA = 0.06; // drag along it: nose-first terminal speed ≈ 400 m/s
export const BOOSTER_LEN = 2.3 * 25; // m
const SHIP_LEN = 50; // m
export const HANDOFF_ALT = 2.4; // km
const D2R = Math.PI / 180;
const wrap = (a) => ((((a + 180) % 360) + 360) % 360) - 180;

export const ORBIT_DIFF = {
  cadet: { fuel: 1.45, heat: 0.6, window: 30 },
  pilot: { fuel: 1.32, heat: 1.0, window: 18 },
};

// thrust (km/s² at 100%) rises as each stage burns off its propellant
const STAGES = {
  1: { fuel: 62, acc0: 1.55, acc1: 3.6, min: 0.4 }, // Super Heavy + Starship
  2: { fuel: 88, acc0: 1.0, acc1: 2.1, min: 0.4 }, // Starship alone
};

export function newOrbitGame(diffKey) {
  const d = ORBIT_DIFF[diffKey];
  const base = (OLM_TOP * 25 + BOOSTER_LEN) / 1000; // ship-base altitude on the pad
  return {
    kind: "orbit", diffKey, d, t: 0,
    u: 0, v: PLANET_R + base, vu: 0, vv: 0,
    pitch: 0, w: 0, thr: 0, lit: false, lowHold: 0,
    stage: 1, fuel1: STAGES[1].fuel * d.fuel, fuel2: STAGES[2].fuel * d.fuel,
    fuel1_0: STAGES[1].fuel * d.fuel, fuel2_0: STAGES[2].fuel * d.fuel,
    grounded: true, phase: "pad", swept: 0, prevAng: 90, heat: 0, maxAlt: 0, maxQ: 0, passedMaxQ: false,
    inOrbit: false, deorbited: false,
    status: "flying", reason: "", hit: null, boomAt: null, events: [], sep: null,
  };
}

export const altOf = (o) => Math.hypot(o.u, o.v) - PLANET_R;
const frame = (u, v) => { const r = Math.hypot(u, v); return { r, ru: u / r, rv: v / r, tu: v / r, tv: -u / r }; };
// nose and belly directions for a pitch, in (u, v)
export function attitude(o, u = o.u, v = o.v, pitch = o.pitch) {
  const f = frame(u, v), c = Math.cos(pitch * D2R), s = Math.sin(pitch * D2R);
  return {
    f,
    nu: c * f.ru - s * f.tu, nv: c * f.rv - s * f.tv, // nose
    bu: s * f.ru + c * f.tu, bv: s * f.rv + c * f.tv, // belly (heat shield)
  };
}
const falling0 = (o) => { const f = frame(o.u, o.v); return o.vu * f.ru + o.vv * f.rv < 0; };
// thin air fades out to nothing at ATMO, so orbits above it never decay
const rhoAt = (alt) => (alt < ATMO ? Math.exp(-Math.max(0, alt) / H) * Math.min(1, (ATMO - alt) / 10) : 0);

function accel(o, u, v, vu, vv, thrust, pitch) {
  const a = attitude(o, u, v, pitch), r = a.f.r, alt = r - PLANET_R;
  const g = MU / (r * r);
  let au = -g * a.f.ru + thrust * a.nu, av = -g * a.f.rv + thrust * a.nv;
  const rho = rhoAt(alt);
  if (rho > 0) {
    const vb = vu * a.bu + vv * a.bv, vn = vu * a.nu + vv * a.nv;
    const fb = -CN * rho * vb * Math.abs(vb), fn = -CA * rho * vn * Math.abs(vn);
    au += fb * a.bu + fn * a.nu; av += fb * a.bv + fn * a.nv;
  }
  return [au, av];
}

// orbital elements from the state: apoapsis / periapsis altitudes (km)
export function elements(o, u = o.u, v = o.v, vu = o.vu, vv = o.vv) {
  const r = Math.hypot(u, v), sp2 = vu * vu + vv * vv;
  const energy = sp2 / 2 - MU / r, h = u * vv - v * vu;
  if (energy >= 0) return { ap: Infinity, pe: NaN, period: Infinity };
  const a = -MU / (2 * energy), e = Math.sqrt(Math.max(0, 1 + (2 * energy * h * h) / (MU * MU)));
  return { ap: a * (1 + e) - PLANET_R, pe: a * (1 - e) - PLANET_R, period: 2 * Math.PI * Math.sqrt((a * a * a) / MU) };
}

function crash(o, reason, hit = null) {
  if (o.status !== "flying") return;
  o.status = "crashed";
  o.reason = reason;
  o.hit = hit;
  o.lit = false;
  o.thr = 0;
  const p = local(o);
  o.boomAt = [p.z, Math.max(0, p.y)];
}

// position in the landing view's frame, metres: y up from the ground, z with
// the launch mount at CATCH and prograde towards -z
export function local(o) {
  const ang = Math.atan2(o.v, o.u), down = PLANET_R * (Math.PI / 2 - ang) * 1000;
  return { y: altOf(o) * 1000, z: CATCH[2] * 25 - down };
}

// warp: how fast game time runs; turning and throttling stay at real-time speed
export function step(o, input, dt, warp = 1) {
  if (o.status !== "flying") return;
  o.t += dt;
  const st = STAGES[o.stage], fuelKey = o.stage === 1 ? "fuel1" : "fuel2";

  // throttle, as in the landing game
  if (input.up && o[fuelKey] > 0) {
    if (!o.lit) { o.lit = true; o.thr = st.min; o.events.push("ignite"); }
    o.thr = Math.min(1, o.thr + (0.6 * dt) / warp);
  }
  if (input.down && o.lit) {
    o.thr -= (0.6 * dt) / warp;
    if (o.thr <= st.min) {
      o.thr = st.min;
      o.lowHold += dt / warp;
      if (o.lowHold > 0.5) { o.lit = false; o.thr = 0; o.events.push("shutdown"); }
    }
  } else o.lowHold = 0;

  let thrust = 0;
  if (o.lit) {
    const used = 1 - o[fuelKey] / (st.fuel * o.d.fuel);
    thrust = o.thr * G0 * (st.acc0 + (st.acc1 - st.acc0) * used);
    o[fuelKey] -= o.thr * dt;
    if (o[fuelKey] <= 0) {
      o[fuelKey] = 0;
      if (o.stage === 1) {
        // hot staging: the ship lights as the booster lets go
        o.stage = 2;
        o.sep = { t: o.t, u: o.u, v: o.v, vu: o.vu, vv: o.vv, pitch: o.pitch };
        o.thr = Math.max(o.thr, 0.7);
        o.events.push("staging");
      } else { o.lit = false; o.thr = 0; o.events.push("flameout"); }
    }
  }

  // attitude: a rate while held, held relative to the horizon when let go
  const maxRate = o.lit ? 24 : 16;
  const want = ((input.left ? 1 : 0) - (input.right ? 1 : 0)) * maxRate;
  o.w += (want - o.w) * Math.min(1, dt / warp / 0.25);
  if (!o.grounded) o.pitch = wrap(o.pitch + (o.w * dt) / warp); // free to turn all the way round
  // after the deorbit, letting go holds the angle to the airflow (not to the
  // horizon), so the belly stays in the flow as the path bends down
  const turning = input.left || input.right;
  if (o.deorbited && Math.hypot(o.vu, o.vv) > 0.05) {
    const pg = pro(o.u, o.v, o.vu, o.vv);
    if (turning || o.aoaHold === undefined) o.aoaHold = wrap(o.pitch - pg);
    else o.pitch = wrap(pg + o.aoaHold);
  }

  // on the pad until the engines lift the stack
  const [au, av] = accel(o, o.u, o.v, o.vu, o.vv, thrust, o.pitch);
  if (o.grounded) {
    const a = attitude(o);
    if (au * a.f.ru + av * a.f.rv <= 0) { o.vu = o.vv = 0; return; }
    o.grounded = false;
    o.phase = "ascent";
    o.events.push("liftoff");
  }
  o.vu += au * dt; o.vv += av * dt;
  o.u += o.vu * dt; o.v += o.vv * dt;

  const alt = altOf(o), speed = Math.hypot(o.vu, o.vv);
  o.maxAlt = Math.max(o.maxAlt, alt);
  const rho = rhoAt(alt), q = rho * speed * speed;
  if (!o.passedMaxQ && o.phase === "ascent") { if (q > o.maxQ) o.maxQ = q; else if (o.maxQ > 0.002 && q < o.maxQ * 0.9) { o.passedMaxQ = true; o.events.push("maxq"); } }

  // angle swept around the planet (clockwise positive), for the one orbit
  const ang = Math.atan2(o.v, o.u) / D2R;
  let dA = o.prevAng - ang;
  if (dA > 180) dA -= 360; else if (dA < -180) dA += 360;
  o.swept += dA;
  o.prevAng = ang;

  // phases
  const el = elements(o);
  if (!o.inOrbit && el.pe > ATMO && alt > ATMO) { o.inOrbit = true; o.phase = "orbit"; o.events.push("orbit"); }
  if (o.inOrbit && !o.deorbited && el.pe < ATMO - 25) { o.deorbited = true; o.events.push("deorbit"); }
  if (o.deorbited && alt < ATMO && falling0(o)) o.phase = "reentry";

  // reentry heating: the tiled belly has to face the airflow
  const fr = frame(o.u, o.v), falling = o.vu * fr.ru + o.vv * fr.rv < 0;
  if (rho > 0 && o.inOrbit && falling && alt < ATMO - 5 && speed > 0.6) {
    const a = attitude(o), facing = Math.abs((o.vu * a.bu + o.vv * a.bv) / speed);
    const heating = rho * speed * speed * speed; // ~0.03 at peak
    if (o.stage === 2 && facing < 0.7) o.heat += heating * (0.7 - facing) * 40 * o.d.heat * dt;
    else o.heat = Math.max(0, o.heat - dt * 0.05);
    if (o.heat >= 1) return crash(o, "Burned up on reentry: keep the black heat shield (belly) facing the airflow");
  }

  // the tower, while still close to the pad
  if (alt < 0.2) {
    const p = local(o), a = attitude(o);
    // nose direction in the landing frame: up is +y, prograde is -z
    const ny = a.nu * a.f.ru + a.nv * a.f.rv, nz = -(a.nu * a.f.tu + a.nv * a.f.tv);
    const len = o.stage === 1 ? BOOSTER_LEN + SHIP_LEN : SHIP_LEN, back = o.stage === 1 ? BOOSTER_LEN : 0;
    for (let k = 0; k <= 16; k++) {
      const s = -back + (len * k) / 16, z = p.z + nz * s, y = p.y + ny * s;
      if (Math.abs(z) < (TOWER_HALF + SHIP_R) * 25 && y < (TOWER_H + 0.45) * 25) {
        crash(o, "Hit the tower on the way up: climb straight until you clear it", "tower");
        o.boomAt = [z, y];
        return;
      }
    }
  }

  if (alt <= 0) {
    const onMount = !o.inOrbit && Math.abs(local(o).z - CATCH[2] * 25) < OLM_R * 25 + 6;
    return crash(o, o.inOrbit ? "Came down too steep and too fast" : onMount ? "Fell back onto the launch mount" : "Fell back to the ground", onMount ? "mount" : null);
  }
  if (o.inOrbit && !o.deorbited && o.swept > 360 + 70) return crash(o, "Missed the deorbit window: burn retrograde (nose left) before you come back round");
  if (o.inOrbit && o.stage === 2 && o.fuel2 <= 0 && !o.deorbited && el.pe > ATMO) return crash(o, "Stranded in orbit: no fuel left to come home");
  if (alt > 4000 || el.ap === Infinity) return crash(o, "Escaped into deep space");
}

// angle of attack for the belly-first reentry: nose this far above the
// direction of travel (90 = belly straight into the flow)
export const REENTRY_AOA = 75;
const pro = (u, v, vu, vv) => { const f = frame(u, v); return Math.atan2(-(vu * f.tu + vv * f.tv), vu * f.ru + vv * f.rv) / D2R; };

// how far from the site the ship will come down (km; + short, - long), by
// coasting from here belly-first, holding the angle of attack it has now
// (during reentry) or the standard one. null if it stays up.
export function landingError(o, maxT = 3000) {
  let u = o.u, v = o.v, vu = o.vu, vv = o.vv, swept = o.swept, prev = Math.atan2(v, u) / D2R;
  // the angle being held counts once the ship is in the air and holding a
  // sensible one; before that (still turning, still burning) assume the standard
  const now = wrap(o.pitch - pro(u, v, vu, vv));
  const aoa = o.phase === "reentry" && now > 25 && now < 125 ? now : REENTRY_AOA;
  const dt = 1.0;
  for (let t = 0; t < maxT; t += dt) {
    const alt = Math.hypot(u, v) - PLANET_R;
    const pitch = alt < ATMO ? pro(u, v, vu, vv) + aoa : -90;
    const [au, av] = accel(o, u, v, vu, vv, 0, pitch);
    vu += au * dt; vv += av * dt; u += vu * dt; v += vv * dt;
    const ang = Math.atan2(v, u) / D2R;
    let dA = prev - ang;
    if (dA > 180) dA -= 360; else if (dA < -180) dA += 360;
    swept += dA; prev = ang;
    if (Math.hypot(u, v) - PLANET_R < HANDOFF_ALT) return PLANET_R * (360 - swept) * D2R;
  }
  return null;
}

// predicted path for the map: coast (or burn on) from here, n points
export function predictPath(o, seconds = 2000, n = 120) {
  const out = [];
  let u = o.u, v = o.v, vu = o.vu, vv = o.vv;
  const dt = seconds / n / 4;
  for (let i = 0; i < n * 4; i++) {
    const [au, av] = accel(o, u, v, vu, vv, 0, o.pitch);
    vu += au * dt; vv += av * dt; u += vu * dt; v += vv * dt;
    if (i % 4 === 3) out.push([u, v]);
    if (Math.hypot(u, v) < PLANET_R) break;
  }
  return out;
}

// the direction of travel as a pitch (0 straight up, -90 prograde level)
export function progradePitch(o) {
  return Math.hypot(o.vu, o.vv) < 1e-4 ? 0 : pro(o.u, o.v, o.vu, o.vv);
}
// the pitch to hold on reentry: belly into the flow, nose above the path
export const reentryPitch = (o, aoa = REENTRY_AOA) => wrap(progradePitch(o) + aoa);
// the ascent guide for a gravity turn: straight up past the tower, a kick
// over while still slow, then follow the direction of travel down to level
export function guidePitch(o) {
  const alt = altOf(o);
  if (alt < 0.4) return 0;
  // apoapsis high enough: nose level for the coast and the circularising burn
  if (elements(o).ap > 85) return -90;
  const kick = -24 * Math.min(1, (alt - 0.4) / 2.2);
  const program = -90 * Math.pow(Math.min(1, (alt - 0.4) / 45), 0.6); // flatter in thin air
  return Math.max(-90, Math.min(kick, program, progradePitch(o) - 1.5));
}

// the hand-off to the landing game: start conditions for the descent mission
export function handoff(o) {
  const err = PLANET_R * (360 - o.swept) * D2R; // km, + short of the site
  const a = attitude(o), vr = (o.vu * a.f.ru + o.vv * a.f.rv) * 1000, vt = (o.vu * a.f.tu + o.vv * a.f.tv) * 1000;
  return {
    err,
    ok: Math.abs(err) <= o.d.window,
    start: {
      // centred on the catch mission's own start, so the catch is as fair
      z: 980 + Math.max(-1, Math.min(1, err / o.d.window)) * 170,
      y: HANDOFF_ALT * 1000,
      vy: Math.max(-150, Math.min(-90, vr)),
      vz: -Math.max(15, Math.min(50, vt)),
      pitch: -90 + Math.max(-20, Math.min(20, o.pitch + 90)),
    },
  };
}
