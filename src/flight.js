// The flight profile: belly-flop, flip, landing burn, tower catch.
//
// Velocities are given as keyframes and integrated once, so position and
// speed always agree and the ship ends exactly on the catch arms. Angles,
// throttle and flap positions are smooth keyframe tracks.
//
// 1 unit = 25 m. Times are in seconds, real time.

import { COM_Y, CATCH, FINAL_BASE_Y } from "./model.js";

export const T_IGNITE = 7.5;
export const T_CATCH = 20.9;
export const T_END = 34;
export const UNIT_M = 25;

const lerp = (a, b, t) => a + (b - a) * t;
const clamp01 = (x) => Math.max(0, Math.min(1, x));
const smooth = (x) => { x = clamp01(x); return x * x * (3 - 2 * x); };

// piecewise linear
function linear(keys) {
  return (t) => {
    if (t <= keys[0][0]) return keys[0][1];
    for (let i = 1; i < keys.length; i++) if (t <= keys[i][0]) {
      const [t0, v0] = keys[i - 1], [t1, v1] = keys[i];
      return lerp(v0, v1, (t - t0) / (t1 - t0));
    }
    return keys[keys.length - 1][1];
  };
}
// cubic Hermite through the keys (Catmull-Rom tangents, non-uniform spacing)
function spline(keys) {
  const n = keys.length;
  const tan = keys.map((_, i) => {
    if (i === 0 || i === n - 1) return 0;
    return (keys[i + 1][1] - keys[i - 1][1]) / (keys[i + 1][0] - keys[i - 1][0]);
  });
  return (t) => {
    if (t <= keys[0][0]) return keys[0][1];
    for (let i = 1; i < n; i++) if (t <= keys[i][0]) {
      const [t0, p0] = keys[i - 1], [t1, p1] = keys[i], h = t1 - t0, u = (t - t0) / h;
      const u2 = u * u, u3 = u2 * u;
      return (2 * u3 - 3 * u2 + 1) * p0 + (u3 - 2 * u2 + u) * h * tan[i - 1] + (-2 * u3 + 3 * u2) * p1 + (u3 - u2) * h * tan[i];
    }
    return keys[n - 1][1];
  };
}

// ---- velocity profiles of the centre of mass (units / s) ----------------------
const vy = linear([[0, -3.4], [T_IGNITE, -3.4], [9.5, -3.0], [11, -2.4], [17, -0.8], [19.5, -0.18], [20.6, -0.05], [T_CATCH, 0]]);
const vz = linear([[0, -0.9], [T_IGNITE, -0.9], [9.5, -0.7], [12, -0.5], [17, -0.15], [19.5, -0.03], [T_CATCH, 0]]);
const vx = linear([[0, -0.12], [9, -0.08], [15, -0.05], [19.5, 0], [T_CATCH, 0]]);

const DT = 0.005, N = Math.ceil(T_END / DT) + 2;
const table = new Float32Array(N * 3);
{
  let x = 0, y = 0, z = 0;
  for (let i = 0; i < N; i++) {
    table[i * 3] = x; table[i * 3 + 1] = y; table[i * 3 + 2] = z;
    const t = i * DT + DT / 2;
    x += vx(t) * DT; y += vy(t) * DT; z += vz(t) * DT;
  }
}
const iEnd = Math.round(T_CATCH / DT);
const FINAL = [CATCH[0], FINAL_BASE_Y + COM_Y, CATCH[2]];
const OFFSET = [FINAL[0] - table[iEnd * 3], FINAL[1] - table[iEnd * 3 + 1], FINAL[2] - table[iEnd * 3 + 2]];
export const START_ALT_M = Math.round((table[1] + OFFSET[1] - COM_Y) * UNIT_M);

function comAt(t, out) {
  const f = Math.max(0, Math.min(N - 1.001, t / DT)), i = Math.floor(f), u = f - i;
  for (let k = 0; k < 3; k++) out[k] = lerp(table[i * 3 + k], table[(i + 1) * 3 + k], u) + OFFSET[k];
  return out;
}

// ---- attitude, engines, flaps, arms ----------------------------------------
// pitch: -90° is belly-down with the nose towards the tower (-z), 0° upright
const pitchTrack = spline([[0, -90], [7.3, -88], [7.7, -84], [8.5, -58], [9.25, -14], [9.85, 13], [10.9, 9], [12.5, 5], [17, 1.5], [19.5, 0], [40, 0]]);
const rollTrack = spline([[0, 2], [4, -2], [7.5, 1], [9.5, -3], [12, 1.5], [16, -0.6], [19.5, 0], [40, 0]]);
const throttleTrack = linear([[0, 0], [T_IGNITE, 0], [7.95, 1], [11, 1], [14, 0.85], [17, 0.7], [19.5, 0.55], [20.75, 0.5], [T_CATCH, 0]]);
const armTrack = (t) => 0.85 * (1 - smooth((t - 19.0) / 1.4));

const PHASES = [
  [0, "BELLY-FLOP DESCENT"],
  [T_IGNITE, "LANDING BURN STARTUP"],
  [8.2, "FLIP MANEUVER"],
  [10.6, "LANDING BURN"],
  [17, "TOWER APPROACH"],
  [19.0, "CHOPSTICKS CLOSING"],
  [T_CATCH, "SHIP CAUGHT"],
];

const tmp = [0, 0, 0], tmp2 = [0, 0, 0];
export function flightState(t) {
  const tc = Math.min(t, T_CATCH + 0.0001);
  comAt(tc, tmp);
  comAt(tc + 0.02, tmp2);
  const vel = [(tmp2[0] - tmp[0]) / 0.02, (tmp2[1] - tmp[1]) / 0.02, (tmp2[2] - tmp[2]) / 0.02];
  if (t >= T_CATCH) vel.fill(0);

  // body wobble while gliding on the flaps
  const glide = 1 - smooth((t - 6.5) / 2);
  let pitch = pitchTrack(t) + glide * (2.5 * Math.sin(t * 1.7) + 1.2 * Math.sin(t * 3.1));
  let roll = rollTrack(t) + glide * 2.5 * Math.sin(t * 1.1 + 1);

  // the catch: the arms take the load, flex, and the ship swings a little
  let bounce = 0;
  if (t > T_CATCH) {
    const k = t - T_CATCH;
    bounce = -0.018 * Math.exp(-2.6 * k) * Math.sin(k * 9);
    roll += 1.4 * Math.exp(-0.7 * k) * Math.sin(k * 2.3);
    pitch += 0.8 * Math.exp(-0.9 * k) * Math.sin(k * 1.9 + 0.6);
  }

  // flaps: fluttering on the belly-flop, folded back for the landing burn
  const fwdFold = lerp(0.12 + 0.16 * Math.sin(t * 2.3), 1.25, smooth((t - T_IGNITE) / 2));
  const aftFold = lerp(0.1 + 0.13 * Math.sin(t * 2.3 + 1.4), 1.1, smooth((t - T_IGNITE - 0.5) / 2.5));
  const fwdTrim = 0.12 * glide * Math.sin(t * 1.3); // left/right differential for roll control

  const throttle = throttleTrack(t);
  let phase = PHASES[0][1];
  for (const [t0, name] of PHASES) if (t >= t0) phase = name;

  return {
    com: [tmp[0], tmp[1] + bounce, tmp[2]],
    vel, pitch, roll, throttle, bounce, phase,
    fwdL: fwdFold - fwdTrim, fwdR: fwdFold + fwdTrim, aftL: aftFold + fwdTrim * 0.5, aftR: aftFold - fwdTrim * 0.5,
    arms: armTrack(t),
    plasma: 1 - smooth(t / 4.5),
    caught: t >= T_CATCH,
  };
}

export { smooth, clamp01, lerp };
