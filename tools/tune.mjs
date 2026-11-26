// Headless check of the Starship game's difficulty: flies both missions with a
// simple keyboard-only autopilot (it can only press arrows, like a player) and
// reports whether it makes it, with how much fuel and margin.
//   node tools/tune.mjs
import { MISSIONS, DIFFICULTY, newGame, step, shipPoints, stoppingDistance, predict, U, G, MAX_ACC } from "../src/physics.js";
import { CATCH, FINAL_BASE_Y, PAD_B, PAD_TOP, LEG_DROP, BUILDING } from "../src/model.js";

const DT = 1 / 120;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

function fly(mission, diff, { glide = true, burnMargin = 1.25, react = 0, log = false, careful = false } = {}) {
  const g = newGame(mission, diff);
  const tz = mission.target.z;
  const groundY = mission.id === "descent" ? (FINAL_BASE_Y) * U : (PAD_TOP + LEG_DROP) * U;
  let phase = mission.id === "descent" ? "coast" : "climb", lastLog = -1;
  // a human-ish reaction lag: decisions only refresh every `react` seconds
  let held = { up: false, down: false, left: false, right: false }, nextThink = 0;
  while (g.status === "flying" && g.t < 200) {
    if (g.t >= nextThink) {
      nextThink = g.t + react;
      const p = shipPoints(g), h = p.base[1] - groundY, inp = { up: false, down: false, left: false, right: false };
      let pitchCmd = g.pitch, thrCmd = null;
      if (phase === "coast") {
        if (glide) {
          const path = predict(g, 30, 60), end = path[path.length - 1];
          pitchCmd = -90 + clamp((end[0] - tz) * -0.02, -12, 12);
        }
        if (h < stoppingDistance(g) * burnMargin + 120) phase = "burn";
      }
      if (phase === "climb") {
        // straight up past the building, then over
        pitchCmd = 0;
        thrCmd = 0.72;
        if (p.base[1] > (BUILDING.h + 0.9) * U) phase = "cruise";
      }
      if (phase === "burn" || phase === "cruise") {
        const dz = g.z - tz;
        const vzWant = clamp(-dz * 0.12, -18, 18);
        let vyWant = -clamp(Math.sqrt(2 * 5.5 * Math.max(0, h)) * 0.85, 1.2, 90);
        if (phase === "cruise") {
          vyWant = Math.abs(dz) > 40 ? clamp(((BUILDING.h + 1.2) * U - p.base[1]) * 0.3, -6, 6) : vyWant;
          if (Math.abs(dz) < 40) phase = "burn";
        }
        if (careful && h < 70) vyWant = Math.max(vyWant, -(1.0 + h * 0.07));
        if (Math.abs(dz) > 6 && h < 25) vyWant = Math.max(vyWant, -1); // don't settle off-target
        pitchCmd = g.pitch < -60 ? 10 : clamp((vzWant - g.vz) * 1.4, -20, 20);
        const need = G + (vyWant - g.vy) * 1.6;
        thrCmd = clamp(need / MAX_ACC / Math.max(0.5, Math.cos((g.pitch * Math.PI) / 180)), 0, 1);
      }
      if (pitchCmd > g.pitch + 1) inp.left = true;
      else if (pitchCmd < g.pitch - 1) inp.right = true;
      if (thrCmd != null) {
        if (!g.lit) inp.up = true;
        else if (thrCmd > g.thr + 0.02) inp.up = true;
        else if (thrCmd < g.thr - 0.02 && g.thr > 0.41) inp.down = true;
      }
      held = inp;
    }
    step(g, held, DT);
    if (log && Math.floor(g.t) !== lastLog) {
      lastLog = Math.floor(g.t);
      console.log(`  t=${g.t.toFixed(0)} ${phase} alt=${(shipPoints(g).base[1]).toFixed(0)} z=${g.z.toFixed(0)} vy=${g.vy.toFixed(1)} vz=${g.vz.toFixed(1)} p=${g.pitch.toFixed(0)} thr=${g.thr.toFixed(2)} fuel=${g.fuel.toFixed(1)}`);
    }
  }
  return g;
}

const fmt = (g) => g.status === "caught" || g.status === "landed"
  ? `${g.status.toUpperCase()} t=${g.t.toFixed(1)}s fuel left ${(g.result.fuel * 100).toFixed(0)}% vy=${g.result.vy.toFixed(1)} vh=${g.result.vh.toFixed(1)} off=${g.result.offset.toFixed(1)}m score=${g.result.score} ${g.result.rating}`
  : `${g.status.toUpperCase()} t=${g.t.toFixed(1)}s "${g.reason}" z=${g.z.toFixed(0)} fuel=${g.fuel.toFixed(1)}`;

// no input at all: where does the belly-flop come down?
{
  const g = newGame(MISSIONS.descent, DIFFICULTY.pilot);
  while (g.status === "flying") step(g, {}, DT);
  console.log(`descent, hands off: ${fmt(g)} (target z=${MISSIONS.descent.target.z.toFixed(0)})`);
}
for (const m of [MISSIONS.descent, MISSIONS.hop])
  for (const [dn, d] of Object.entries(DIFFICULTY)) {
    console.log(`${m.id}/${dn}: autopilot        ${fmt(fly(m, d))}`);
    console.log(`${m.id}/${dn}: 0.25 s reactions ${fmt(fly(m, d, { react: 0.25 }))}`);
    console.log(`${m.id}/${dn}: careful + 0.2 s  ${fmt(fly(m, d, { react: 0.2, careful: true }))}`);
    if (m.id === "descent") console.log(`${m.id}/${dn}: no glide steer   ${fmt(fly(m, d, { glide: false }))}`);
  }
if (process.argv.includes("--log")) fly(MISSIONS[process.argv[3] || "descent"], DIFFICULTY.pilot, { log: true });

// the orbital mission hands the ship to the catch at 2.4 km; check the range
// of hand-off states tools/tune-orbit.mjs produces can still be caught
if (process.argv.includes("--handoff")) {
  for (const z of [800, 900, 980, 1100, 1200]) for (const vy of [-100, -150]) for (const vz of [-25, -45]) {
    const m = { ...MISSIONS.descent, start: { z, y: 2400, vy, vz, pitch: -90 } };
    console.log(`hand-off z=${z} vy=${vy} vz=${vz}: ${["cadet", "pilot"].map((dn) => fmt(fly(m, DIFFICULTY[dn], { react: 0.2 })).split(" ").slice(0, 2).join(" ")).join(" | ")}`);
  }
}
