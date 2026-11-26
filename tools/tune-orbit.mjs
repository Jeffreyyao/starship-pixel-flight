// Headless check of the orbital mission: a keyboard-only autopilot flies the
// gravity turn, circularises, goes once round, deorbits and reenters, and
// reports where it hands over to the catch.
//   node tools/tune-orbit.mjs [--log]
import { newOrbitGame, step, altOf, elements, guidePitch, landingError, handoff, attitude, reentryPitch, ORBIT_DIFF, HANDOFF_ALT } from "../src/orbit.js";

const LOG = process.argv.includes("--log");
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

function fly(diffKey, { react = 0, sloppy = 0, deorbitAt = 260 } = {}) {
  const o = newOrbitGame(diffKey);
  let phase = "ascent", nextThink = 0, held = {}, err = null, lastLog = -1, errAt = -1; const log = [];
  const dt = 0.05;
  while (o.status === "flying" && !(o.inOrbit && altOf(o) < HANDOFF_ALT) && o.t < 6000) {
    if (o.t >= nextThink) {
      nextThink = o.t + react;
      const alt = altOf(o), el = elements(o), inp = {};
      const a = attitude(o), vr = o.vu * a.f.ru + o.vv * a.f.rv;
      let pitch = o.pitch, thrUp = false, thrOff = false;
      if (phase === "ascent") {
        pitch = guidePitch(o) + (alt > 1.5 ? sloppy * Math.sin(o.t * 0.3) * 5 : 0);
        thrUp = true;
        if (el.ap > 90) { phase = "coast"; thrOff = true; }
      } else if (phase === "coast") {
        pitch = -90; thrOff = true;
        if (vr < 0.002) phase = "circ";
      } else if (phase === "circ") {
        pitch = -90; thrUp = true;
        if (el.pe > 82) { phase = "orbit"; thrOff = true; }
      } else if (phase === "orbit") {
        pitch = 90; thrOff = true; // point retrograde, ready
        if (o.swept > deorbitAt) phase = "deorbit";
      } else if (phase === "deorbit") {
        pitch = 90;
        // light at minimum throttle and stay there: fine control of the landing point
        if (!o.lit && Math.abs(o.pitch - 90) < 8) thrUp = true;
        if (o.t > errAt) { errAt = o.t + 0.1; err = landingError(o); }
        if ((err !== null && err > -2) || o.fuel2 <= 0) { phase = "reentry"; thrOff = true; log.push(`deorbit cut at err ${err.toFixed(1)}, swept ${o.swept.toFixed(0)}`); }
      } else if (phase === "reentry") {
        thrOff = true;
        if (o.t > errAt) { errAt = o.t + 3; err = landingError(o); }
        // belly into the flow; less angle of attack stretches the glide, more shortens it
        pitch = reentryPitch(o, 75 - (err === null ? 0 : clamp(err * 0.6, -15, 25)));
      }
      const dp = ((pitch - o.pitch + 540) % 360) - 180;
      if (dp > 1) inp.left = true; else if (dp < -1) inp.right = true;
      if (thrUp) inp.up = true;
      if (thrOff && o.lit) inp.down = true;
      held = inp;
    }
    step(o, held, dt);
    if (LOG && Math.floor(o.t / 10) !== lastLog) {
      lastLog = Math.floor(o.t / 10);
      const el = elements(o);
      console.log(`  t=${o.t.toFixed(0)} ${phase}/${o.phase} st${o.stage} alt=${altOf(o).toFixed(1)} v=${Math.hypot(o.vu, o.vv).toFixed(3)} ap=${el.ap.toFixed(0)} pe=${el.pe.toFixed(0)} p=${o.pitch.toFixed(0)} swept=${o.swept.toFixed(0)} f1=${o.fuel1.toFixed(0)} f2=${o.fuel2.toFixed(1)} heat=${o.heat.toFixed(2)} err=${err?.toFixed(1)}`);
    }
  }
  if (LOG || process.argv.includes("--sweep")) console.log("   ", log.join("; "));
  if (o.status !== "flying") return `CRASHED t=${o.t.toFixed(0)} "${o.reason}" fuel2=${o.fuel2.toFixed(1)}`;
  const h = handoff(o);
  return `${h.ok ? "HANDOFF" : "OFF TARGET"} t=${o.t.toFixed(0)}s err=${h.err.toFixed(1)} km (window ±${o.d.window}) start z=${h.start.z.toFixed(0)} vy=${h.start.vy.toFixed(0)} vz=${h.start.vz.toFixed(0)} ship fuel left ${((o.fuel2 / o.fuel2_0) * 100).toFixed(0)}% heat=${o.heat.toFixed(2)}`;
}

if (process.argv.includes("--sweep")) {
  for (let at = 180; at <= 320; at += 10) console.log(`deorbit at ${at}°: ${fly("cadet", { deorbitAt: at })}`);
  process.exit(0);
}
for (const dk of Object.keys(ORBIT_DIFF)) {
  console.log(`orbit/${dk}: autopilot       ${fly(dk)}`);
  console.log(`orbit/${dk}: 0.3 s, sloppy   ${fly(dk, { react: 0.3, sloppy: 1 })}`);
}
