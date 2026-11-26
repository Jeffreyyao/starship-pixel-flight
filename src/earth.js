// The planet for the orbital mission, as splats: a surface (ocean, land,
// desert, ice), a cloud shell and a thin atmosphere. Render units: the planet
// is EARTH_R across its radius, centred on the origin; the launch site is at
// the top (0, EARTH_R, 0) and the flight plane is x = 0. The camera always
// looks from +x, so only that side (plus the limb) is built.

import { vnoise3, mulberry32 } from "./engine/noise.js";
import { PLANET_R } from "./orbit.js";

export const EARTH_R = 25;
export const KM = EARTH_R / PLANET_R; // render units per km
export const EM = { ocean: 0, land: 1, desert: 2, ice: 3, rock: 4 };

const fbm = (x, y, z) => vnoise3(x, y, z) * 0.55 + vnoise3(x * 2.1, y * 2.1, z * 2.1) * 0.28 + vnoise3(x * 4.3, y * 4.3, z * 4.3) * 0.17;

// what is on the surface in direction (x, y, z) (unit vector)
function surface(x, y, z) {
  // continents, with Starbase on a coast: land behind the site (screen right,
  // -z), the Gulf in front (+z)
  const site = Math.max(0, y) ** 24;
  let land = fbm(x * 2.2 + 3, y * 2.2, z * 2.2 + 1) - 0.5;
  land += site * (z < 0.02 ? 0.4 : -0.4);
  const pole = Math.abs(x); // poles at ±x: the orbit is equatorial, the camera looks down from over one
  if (pole > 0.955 - 0.03 * vnoise3(y * 6, z * 6, 1)) return [EM.ice, 0.5 + 0.4 * vnoise3(x * 20, y * 20, z * 20)];
  if (land < 0) return [EM.ocean, Math.min(1, -land * 3)];
  const dry = vnoise3(x * 3.5 + 9, y * 3.5, z * 3.5) + (1 - pole) * 0.15;
  const high = fbm(x * 7, y * 7, z * 7);
  const det = vnoise3(x * 40, y * 40, z * 40);
  if (high > 0.72) return [EM.rock, det];
  return [dry > 0.68 ? EM.desert : EM.land, det];
}

export function buildEarth() {
  const rnd = mulberry32(5);
  const R = EARTH_R;
  // surface: a Fibonacci sphere, about 0.2 units between splats
  const N = Math.round((4 * Math.PI * R * R) / 0.042);
  const sp = [], sa = [];
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < N; i++) {
    const yy = 1 - (2 * (i + 0.5)) / N, r = Math.sqrt(1 - yy * yy), a = i * golden;
    // map the Fibonacci axis onto x so the dense, even band is the visible side
    const x = yy, y = Math.cos(a) * r, z = Math.sin(a) * r;
    if (x < -0.2) continue;
    const [m, det] = surface(x, y, z);
    const lift = m === EM.ocean ? 0 : 0.03 + (m === EM.rock ? 0.06 : 0);
    sp.push(x * (R + lift), y * (R + lift), z * (R + lift));
    sa.push(m, det, 1);
  }
  // clouds: patchy, a little above the surface
  const cp = [], ca = [];
  const NC = 46000;
  for (let i = 0; i < NC; i++) {
    const yy = 1 - (2 * (i + 0.5)) / NC, r = Math.sqrt(1 - yy * yy), a = i * golden * 1.0001 + 0.7;
    const x = yy, y = Math.cos(a) * r, z = Math.sin(a) * r;
    if (x < -0.2) continue;
    const c = fbm(x * 3 + 20, y * 5, z * 5) + 0.25 * vnoise3(x * 14, y * 14, z * 14);
    // keep the sky over the launch site clear
    if (c < 0.665 || y > 0.985) continue;
    const h = R + 0.32 + rnd() * 0.06;
    cp.push(x * h, y * h, z * h);
    ca.push(Math.min(1, (c - 0.665) * 4), rnd());
  }
  // atmosphere: a translucent shell; the shader keeps only the limb
  const ap = [];
  const NA = 9000;
  for (let i = 0; i < NA; i++) {
    const yy = 1 - (2 * (i + 0.5)) / NA, r = Math.sqrt(1 - yy * yy), a = i * golden;
    const x = yy, y = Math.cos(a) * r, z = Math.sin(a) * r;
    if (x < -0.35) continue;
    const h = R + 0.9;
    ap.push(x * h, y * h, z * h);
  }
  return {
    surface: { count: sa.length / 3, p: new Float32Array(sp), attr: new Float32Array(sa) },
    clouds: { count: ca.length / 2, p: new Float32Array(cp), attr: new Float32Array(ca) },
    atmo: { count: ap.length / 3, p: new Float32Array(ap) },
  };
}
