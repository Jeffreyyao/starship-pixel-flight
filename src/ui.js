// The game's screens and flight HUD: mission menu, telemetry, a side-view
// radar with the predicted path, contextual hints and the result card.
// Plain DOM; main.js calls update() every frame.

import { U, MIN_THR, predict, shipPoints } from "./physics.js";
import { PLANET_R, ATMO, altOf } from "./orbit.js";
import { TOWER_H, TOWER_HALF, BUILDING, PAD_A, PAD_B, PAD_R, PAD_TOP, LEG_DROP, SHORE_Z, ARM_TOP } from "./model.js";

const CSS = `
.sg { font: 12px/1.45 ui-monospace, "SF Mono", Menlo, monospace; color: #e8ecf3; }
.sg-panel { background: rgba(6,10,26,.84); border: 2px solid #333d5e; box-shadow: 4px 4px 0 #000; }
.sg-tel { position: fixed; right: 14px; top: calc(var(--head-h, 0px) + 14px); z-index: 6; width: 236px; padding: 10px 12px; pointer-events: none; }
.sg h3 { margin: 0 0 6px; font-size: 11px; letter-spacing: .12em; color: #ffa238; }
.sg .row { display: flex; justify-content: space-between; gap: 8px; }
.sg .row b { color: #fff5d6; font-weight: 600; }
.sg .row b.ok { color: #8be0a4; } .sg .row b.warn { color: #ffd674; } .sg .row b.bad { color: #ff6a6a; }
.sg .lim { color: #56617f; font-size: 10px; }
.sg .bar { position: relative; height: 9px; background: #10121c; border: 1px solid #333d5e; margin: 2px 0 5px; }
.sg .bar i { display: block; height: 100%; width: 0; background: #ec661e; }
.sg .bar.fuel i { background: #5a8cc0; } .sg .bar.fuel.low i { background: #ff4848; }
.sg .bar u { position: absolute; top: -2px; bottom: -2px; width: 2px; background: #8590ab; left: ${MIN_THR * 100}%; }
.sg .tgt { margin-top: 6px; padding: 4px 6px; background: #1d2542; color: #ffd674; display: flex; justify-content: space-between; }
.sg-radar { position: fixed; left: 14px; bottom: calc(var(--foot-h, 0px) + 14px); z-index: 6; padding: 6px; pointer-events: none; }
.sg-radar canvas, .with-chrome .sg-radar canvas { position: static; display: block; width: 250px; height: 150px; image-rendering: pixelated; touch-action: auto; }
.sg-radar small { color: #56617f; font-size: 10px; letter-spacing: .1em; }
.sg-hint { position: fixed; left: 50%; transform: translateX(-50%); top: calc(var(--head-h, 0px) + 16px); z-index: 6; pointer-events: none;
  padding: 6px 12px; font-size: 13px; letter-spacing: .06em; color: #fff5d6; text-align: center; max-width: min(520px, calc(100vw - 540px)); }
.sg-hint.urgent { color: #1a0a06; background: #ffa238; border-color: #ffd674; animation: sgblink .5s steps(2) infinite; }
@keyframes sgblink { 50% { background: #ec661e; } }
.sg-toast { position: fixed; left: 50%; top: 30%; transform: translate(-50%, -50%); z-index: 6; pointer-events: none;
  font: 700 22px/1 ui-monospace, Menlo, monospace; letter-spacing: .2em; color: #fff5d6; text-shadow: 3px 3px 0 #ac361a, 5px 5px 0 #000; opacity: 0; transition: opacity .3s; }
.sg-keys { position: fixed; right: 14px; bottom: calc(var(--foot-h, 0px) + 14px); z-index: 6; padding: 8px 10px; font-size: 11px; color: #8590ab; pointer-events: none; }
.sg-keys kbd, .sg-menu kbd, .sg-res kbd { display: inline-block; min-width: 18px; padding: 0 4px; margin-right: 4px; text-align: center; color: #fff5d6; background: #1d2542; border: 1px solid #56617f; box-shadow: 0 2px 0 #000; }
.sg-overlay { position: fixed; inset: 0; z-index: 7; display: flex; align-items: center; justify-content: center; pointer-events: none; }
.sg-menu, .sg-res { pointer-events: auto; width: min(640px, calc(100vw - 32px)); padding: 18px 20px; }
.sg-menu h1, .sg-res h1 { margin: 0 0 2px; font-size: 22px; letter-spacing: .18em; color: #fff5d6; text-shadow: 3px 3px 0 #ac361a; }
.sg-menu .sub { color: #8590ab; margin-bottom: 14px; }
.sg-cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(178px, 1fr)); gap: 10px; }
.sg .sub2 { color: #8590ab; font-size: 10px; }
.sg .bar.heat i { background: #ff4848; } .sg .bar.b1 i { background: #8590ab; }
.sg-card { text-align: left; font: inherit; color: inherit; cursor: pointer; padding: 10px 12px; background: #0e1428; border: 2px solid #333d5e; }
.sg-card.on { border-color: #ffa238; background: #1d2542; }
.sg-card b { display: block; color: #ffd674; letter-spacing: .1em; margin-bottom: 4px; }
.sg-card p { margin: 0 0 6px; color: #b9c2d4; font-size: 11px; }
.sg-card small { color: #8590ab; }
.sg-diff { display: flex; gap: 8px; margin: 12px 0 10px; align-items: center; }
.sg-diff button { font: inherit; cursor: pointer; padding: 5px 10px; color: #b9c2d4; background: #0e1428; border: 2px solid #333d5e; }
.sg-diff button.on { color: #1a0a06; background: #ffa238; border-color: #ffd674; }
.sg-go { font: 700 14px/1 ui-monospace, Menlo, monospace; letter-spacing: .14em; cursor: pointer; padding: 10px 16px; color: #1a0a06; background: #ffa238; border: 2px solid #ffd674; box-shadow: 3px 3px 0 #000; }
.sg-legend { margin-top: 14px; display: grid; grid-template-columns: 1fr 1fr; gap: 3px 14px; color: #8590ab; font-size: 11px; }
.sg-res h1.bad { text-shadow: 3px 3px 0 #6e2230; color: #ff9a9a; }
.sg-res .why { color: #ffd674; margin: 4px 0 12px; }
.sg-res .stats { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px 14px; margin-bottom: 14px; }
.sg-res .stats div { background: #0e1428; padding: 6px 8px; border: 1px solid #333d5e; }
.sg-res .stats span { display: block; color: #8590ab; font-size: 10px; }
.sg-res .btns { display: flex; gap: 10px; flex-wrap: wrap; }
.sg-res .btns button { font: inherit; cursor: pointer; padding: 7px 12px; color: #e8ecf3; background: #1d2542; border: 2px solid #56617f; }
.sg-res .btns button.primary { color: #1a0a06; background: #ffa238; border-color: #ffd674; }
.sg-res .tip { margin-top: 10px; color: #8590ab; font-size: 11px; }
.sg-hide { display: none !important; }
.sg-touch .sg-res kbd, .sg-touch .sg-card kbd, .sg-touch .sg-diff kbd, .sg-touch .sg-go-key { display: none; }
.sg-touch .sg-card, .sg-touch .sg-diff button, .sg-touch .sg-res .btns button { min-height: 44px; }
@media (max-width: 900px) { .sg-hint { max-width: calc(100vw - 32px); top: auto; bottom: calc(var(--foot-h, 0px) + 180px); } .sg-keys { display: none; } }
@media (max-width: 640px) { .sg-tel { width: 168px; font-size: 10px; right: 8px; padding: 8px; } .sg-radar canvas { width: 170px; height: 102px; } .sg-cards { grid-template-columns: 1fr; } }
`;

const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };

const TIPS = {
  descent: [
    "Watch the radar: the dotted line is where you're heading. Nose down (→) stretches the glide, nose up (←) shortens it.",
    "Light the engines when the hint flashes. Too early wastes fuel, too late and you can't stop.",
    "Flipping upright pushes you forward. Lean back a little (←) after the flip to brake.",
    "Come in slowly over the last 50 m. The arms close by themselves once you're in the window below them.",
  ],
  hop: [
    "Hovering takes about 50% throttle. Climb above the high bay before you lean towards pad B.",
    "Lean 10–15° to move, then lean the other way to stop. Small, early corrections beat big late ones.",
    "Watch the wind: it pushes harder the higher you fly.",
    "Kill sideways speed before the last 20 m, then settle straight down onto the pad.",
  ],
  orbit: [
    "Climb dead straight until you clear the tower, then follow the guide pitch: it bends over with your flight path.",
    "Burn until APOAPSIS reaches 85–90 km, cut the engines, coast to the top, then burn level until PERIAPSIS passes 80 km.",
    "Deorbit about three quarters of the way round: nose retrograde (+90°), minimum throttle, and stop when LANDING ERROR reads about 0.",
    "On reentry hold the belly into the airflow (the guide pitch). Nose down a little stretches the glide, nose up shortens it.",
  ],
};

export function createUI({ missions, difficulties, time, onTime, onStart, onRetry, onNext, onMenu }) {
  const st = document.createElement("style");
  st.textContent = CSS;
  document.head.appendChild(st);

  // ---- flight HUD
  const tel = el("div", "sg sg-panel sg-tel sg-hide", `
    <h3 data-k="title"></h3>
    <div class="row"><span>ALTITUDE</span><b data-k="alt"></b></div>
    <div class="row"><span>VERTICAL <span class="lim" data-k="vylim"></span></span><b data-k="vy"></b></div>
    <div class="row"><span>SIDEWAYS <span class="lim" data-k="vhlim"></span></span><b data-k="vh"></b></div>
    <div class="row"><span>TILT <span class="lim" data-k="tlim"></span></span><b data-k="tilt"></b></div>
    <div class="row"><span>THROTTLE</span><b data-k="thr"></b></div>
    <div class="bar"><i data-k="thrbar"></i><u></u></div>
    <div class="row"><span>FUEL</span><b data-k="fuel"></b></div>
    <div class="bar fuel" data-k="fuelbox"><i data-k="fuelbar"></i></div>
    <div class="tgt"><span data-k="tgtname"></span><b data-k="tgt"></b></div>`);
  const otel = el("div", "sg sg-panel sg-tel sg-hide", `
    <h3 data-o="title"></h3>
    <div class="row"><span>ALTITUDE</span><b data-o="alt"></b></div>
    <div class="row"><span>SPEED <span class="lim">orbit ≈ 2.3</span></span><b data-o="speed"></b></div>
    <div class="row"><span>APOAPSIS</span><b data-o="ap"></b></div>
    <div class="row"><span>PERIAPSIS <span class="lim">&gt; 80</span></span><b data-o="pe"></b></div>
    <div class="row"><span>PITCH <span class="lim" data-o="guide"></span></span><b data-o="pitch"></b></div>
    <div class="row"><span>THROTTLE</span><b data-o="thr"></b></div>
    <div class="bar"><i data-o="thrbar"></i><u></u></div>
    <div class="row"><span data-o="f1name">BOOSTER</span><b data-o="f1"></b></div>
    <div class="bar b1"><i data-o="f1bar"></i></div>
    <div class="row"><span>SHIP FUEL</span><b data-o="f2"></b></div>
    <div class="bar fuel" data-o="f2box"><i data-o="f2bar"></i></div>
    <div class="row" data-o="heatrow"><span>HEAT SHIELD</span><b data-o="heat"></b></div>
    <div class="bar heat" data-o="heatbox"><i data-o="heatbar"></i></div>
    <div class="tgt"><span data-o="tname">ORBIT</span><b data-o="tgt"></b></div>
    <div class="row sub2"><span data-o="phase"></span><span data-o="warp"></span></div>`);
  const qo = (k) => otel.querySelector(`[data-o="${k}"]`);
  const O = Object.fromEntries(["title", "alt", "speed", "ap", "pe", "pitch", "guide", "thr", "thrbar", "f1name", "f1", "f1bar", "f2", "f2bar", "f2box", "heatrow", "heat", "heatbox", "heatbar", "tname", "tgt", "phase", "warp"].map((k) => [k, qo(k)]));
  const radar = el("div", "sg sg-panel sg-radar sg-hide", `<small data-k="radarname">SIDE RADAR · dotted: predicted path</small><canvas width="250" height="150"></canvas>`);
  const hint = el("div", "sg sg-panel sg-hint sg-hide");
  const toast = el("div", "sg sg-toast");
  const keys = el("div", "sg sg-panel sg-keys sg-hide", `
    <div><kbd>↑</kbd><kbd>↓</kbd> throttle (hold ↓ at min to cut)</div>
    <div><kbd>←</kbd><kbd>→</kbd> pitch the ship</div>
    <div><kbd>space</kbd> time warp (descent, engines off)</div>
    <div><kbd>C</kbd> camera · <kbd>-</kbd><kbd>=</kbd> pixels · <kbd>P</kbd> pause</div>
    <div><kbd>T</kbd> day/night · <kbd>R</kbd> restart · <kbd>esc</kbd> menu</div>`);
  const q = (k) => tel.querySelector(`[data-k="${k}"]`);
  const F = Object.fromEntries(["title", "alt", "vy", "vh", "tilt", "thr", "thrbar", "fuel", "fuelbar", "fuelbox", "tgt", "tgtname", "vylim", "vhlim", "tlim"].map((k) => [k, q(k)]));

  // ---- menu
  const overlay = el("div", "sg sg-overlay");
  const menu = el("div", "sg-panel sg-menu");
  let pick = "descent", diff = "cadet", touch = false;
  const best = (m, d) => { try { return Number(localStorage.getItem(`starship-best-${m}-${d}`)) || 0; } catch { return 0; } };
  const renderMenu = () => {
    menu.innerHTML = `
      <h1>STARSHIP · PIXEL FLIGHT</h1>
      <div class="sub">${touch ? "Fly it yourself. Hold the on-screen buttons." : "Fly it yourself. Arrow keys only."}</div>
      <div class="sg-cards">${Object.values(missions).map((m, i) => `
        <button class="sg-card ${m.id === pick ? "on" : ""}" data-m="${m.id}">
          <b><kbd>${i + 1}</kbd>${m.label}</b><p>${m.blurb}</p>
          <small>best (${difficulties[diff].label.toLowerCase()}): ${best(m.id, diff) || "—"}</small>
        </button>`).join("")}</div>
      <div class="sg-diff"><span><kbd>D</kbd>difficulty</span>${Object.entries(difficulties).map(([k, d]) => `<button data-d="${k}" class="${k === diff ? "on" : ""}">${d.label}</button>`).join("")}
        <small style="color:#8590ab">${diff === "cadet" ? "more fuel, calm air, softer limits" : "tight fuel, gusty wind, real limits · score ×1.5"}</small></div>
      <div class="sg-diff"><span><kbd>T</kbd>time</span>${[["night", "☾ NIGHT"], ["day", "☀ DAY"]].map(([k, l]) => `<button data-t="${k}" class="${time() === k ? "on" : ""}">${l}</button>`).join("")}</div>
      <button class="sg-go">LAUNCH<span class="sg-go-key">  ⏎</span></button>
      ${touch ? `<div class="sg-legend">
        <span><kbd>↑</kbd> right thumb: light engines / throttle up</span><span><kbd>↓</kbd> throttle down (hold at 40% to cut)</span>
        <span><kbd>←</kbd><kbd>→</kbd> left thumb: pitch the nose</span><span><kbd>⏩</kbd> time warp while gliding</span>
        <span><kbd>II</kbd> pause · <kbd>CAM</kbd> camera · <kbd>☾</kbd> day/night</span><span><kbd>↺</kbd> restart · <kbd>☰</kbd> menu</span>
        <span>Landscape gives the widest view.</span>
      </div>` : `<div class="sg-legend">
        <span><kbd>↑</kbd> light engines / throttle up</span><span><kbd>↓</kbd> throttle down (hold at 40% to cut)</span>
        <span><kbd>←</kbd> pitch nose left</span><span><kbd>→</kbd> pitch nose right</span>
        <span><kbd>space</kbd> time warp while gliding</span><span><kbd>C</kbd> camera distance</span>
        <span><kbd>P</kbd> pause · <kbd>R</kbd> restart · <kbd>esc</kbd> menu</span><span><kbd>-</kbd><kbd>=</kbd> pixel size · <kbd>T</kbd> day/night</span>
      </div>`}`;
    menu.querySelectorAll("[data-m]").forEach((b) => (b.onclick = () => { pick = b.dataset.m; renderMenu(); }));
    menu.querySelectorAll("[data-d]").forEach((b) => (b.onclick = () => { diff = b.dataset.d; renderMenu(); }));
    menu.querySelectorAll("[data-t]").forEach((b) => (b.onclick = () => onTime(b.dataset.t)));
    menu.querySelector(".sg-go").onclick = () => onStart(pick, diff);
  };
  renderMenu();

  // ---- result
  const res = el("div", "sg-panel sg-res sg-hide");
  overlay.append(menu, res);
  document.body.append(tel, otel, radar, hint, toast, keys, overlay);

  const ctx = radar.querySelector("canvas").getContext("2d");
  let toastTimer = 0, tipIdx = 0;

  const api = {
    get pick() { return pick; }, get diff() { return diff; },
    menuKey(k) {
      if (k === "1" || k === "2" || k === "3") { pick = Object.keys(missions)[Number(k) - 1]; renderMenu(); }
      else if (k === "d") { diff = diff === "cadet" ? "pilot" : "cadet"; renderMenu(); }
      else if (k === "Enter") onStart(pick, diff);
    },
    showMenu() {
      renderMenu();
      overlay.classList.remove("sg-hide");
      menu.classList.remove("sg-hide");
      res.classList.add("sg-hide");
      [tel, otel, radar, hint, keys].forEach((e) => e.classList.add("sg-hide"));
    },
    showOrbit(o) {
      overlay.classList.add("sg-hide");
      [otel, radar, keys].forEach((e) => e.classList.remove("sg-hide"));
      tel.classList.add("sg-hide");
      O.title.textContent = `ORBITAL FLIGHT · ${o.diffKey.toUpperCase()}`;
      radar.querySelector("small").textContent = "ORBIT MAP · dotted: predicted path";
    },
    showFlight(g) {
      overlay.classList.add("sg-hide");
      otel.classList.add("sg-hide");
      radar.querySelector("small").textContent = "SIDE RADAR · dotted: predicted path";
      [tel, radar, keys].forEach((e) => e.classList.remove("sg-hide"));
      F.title.textContent = `${g.mission.label} · ${g.diff.label}`;
      F.vylim.textContent = `≤${g.diff.vy}`; F.vhlim.textContent = `≤${g.diff.vh}`; F.tlim.textContent = `≤${g.diff.tilt}°`;
      F.tgtname.textContent = g.mission.id === "descent" ? "TO TOWER" : "TO PAD B";
    },
    toast(text) { toast.textContent = text; toast.style.opacity = 1; clearTimeout(toastTimer); toastTimer = setTimeout(() => (toast.style.opacity = 0), 1100); },
    setTime() { renderMenu(); },
    setTouch(on) { touch = on; document.documentElement.classList.toggle("sg-touch", on); renderMenu(); },
    hint(text, urgent) {
      if (text && touch) text = text.replace(/space: (time |faster )?warp/, "⏩ WARP to speed up");
      hint.classList.toggle("sg-hide", !text);
      if (text && hint.textContent !== text) hint.textContent = text;
      hint.classList.toggle("urgent", !!urgent);
    },
    showResult(g) {
      const ok = g.status === "caught" || g.status === "landed";
      let record = false;
      if (ok) {
        const key = `starship-best-${g.missionKey || g.mission.id}-${g.diff === difficulties.pilot ? "pilot" : "cadet"}`;
        try { if (g.result.score > (Number(localStorage.getItem(key)) || 0)) { localStorage.setItem(key, g.result.score); record = true; } } catch {}
      }
      const id = g.missionKey || g.mission.id, ids = Object.keys(missions);
      const tips = TIPS[id], r = g.result;
      const other = missions[ids[(ids.indexOf(id) + 1) % ids.length]];
      res.innerHTML = ok ? `
        <h1>${g.status === "caught" ? "SHIP CAUGHT" : "TOUCHDOWN"} · ${r.rating}</h1>
        <div class="why">${g.reason}${record ? " · new best!" : ""}</div>
        <div class="stats">
          <div><span>SCORE</span>${r.score}</div><div><span>DESCENT</span>${r.vy.toFixed(1)} m/s</div><div><span>SIDEWAYS</span>${r.vh.toFixed(1)} m/s</div>
          <div><span>TILT</span>${r.tilt.toFixed(1)}°</div><div><span>OFF CENTRE</span>${r.offset.toFixed(1)} m</div><div><span>FUEL LEFT</span>${Math.round(r.fuel * 100)}%</div>
        </div>
        <div class="btns"><button class="primary" data-a="retry"><kbd>⏎</kbd>FLY AGAIN</button><button data-a="next"><kbd>N</kbd>${other.label}</button><button data-a="menu"><kbd>esc</kbd>MENU</button></div>`
        : `
        <h1 class="bad">${g.status === "missed" ? "MISSION FAILED" : "RAPID UNSCHEDULED DISASSEMBLY"}</h1>
        <div class="why">${g.reason}</div>
        <div class="stats">
          <div><span>TIME</span>${g.t >= 120 ? `${Math.floor(g.t / 60)} min ${Math.round(g.t % 60)} s` : `${g.t.toFixed(1)} s`}</div><div><span>FUEL LEFT</span>${Math.round((g.fuel / g.fuel0) * 100)}%</div><div><span>MAX ALT</span>${g.maxAlt >= 10000 ? `${(g.maxAlt / 1000).toFixed(0)} km` : `${Math.round(g.maxAlt)} m`}</div>
        </div>
        <div class="btns"><button class="primary" data-a="retry"><kbd>⏎</kbd>TRY AGAIN</button><button data-a="next"><kbd>N</kbd>${other.label}</button><button data-a="menu"><kbd>esc</kbd>MENU</button></div>
        <div class="tip">TIP · ${tips[tipIdx++ % tips.length]}</div>`;
      res.querySelector('[data-a="retry"]').onclick = onRetry;
      res.querySelector('[data-a="next"]').onclick = onNext;
      res.querySelector('[data-a="menu"]').onclick = onMenu;
      overlay.classList.remove("sg-hide");
      menu.classList.add("sg-hide");
      res.classList.remove("sg-hide");
      [hint, keys].forEach((e) => e.classList.add("sg-hide"));
    },

    update(g) {
      const p = shipPoints(g), d = g.diff;
      const alt = Math.max(0, p.base[1] - (g.mission.legs ? (PAD_TOP + LEG_DROP) * U : 0));
      const vy = -g.vy, vh = Math.abs(g.vz), tilt = Math.abs(g.pitch);
      const grade = (v, lim) => (v <= lim ? "ok" : v <= lim * 2 ? "warn" : "bad");
      const near = Math.hypot(g.z - g.mission.target.z, g.y - g.mission.target.y) < 200;
      F.alt.textContent = `${alt.toFixed(0)} m`;
      F.vy.textContent = `${vy < -0.05 ? "▲" : vy > 0.05 ? "▼" : ""} ${Math.abs(vy).toFixed(1)} m/s`; F.vy.className = near ? grade(Math.max(0, vy), d.vy) : "";
      F.vh.textContent = `${vh.toFixed(1)} m/s`; F.vh.className = near ? grade(vh, d.vh) : "";
      F.tilt.textContent = `${tilt.toFixed(1)}°`; F.tilt.className = near ? grade(tilt, d.tilt) : "";
      F.thr.textContent = g.lit ? `${Math.round(g.thr * 100)}%` : g.fuel <= 0 ? "NO FUEL" : "OFF";
      F.thrbar.style.width = `${g.lit ? g.thr * 100 : 0}%`;
      const fuel = g.fuel / g.fuel0;
      F.fuel.textContent = `${Math.round(fuel * 100)}%`;
      F.fuelbar.style.width = `${fuel * 100}%`;
      F.fuelbox.classList.toggle("low", fuel < 0.2);
      const dz = g.mission.target.z - g.z;
      // screen right is -z
      F.tgt.textContent = `${Math.abs(dz) < 1.5 ? "•" : dz < 0 ? "→" : "←"} ${Math.abs(dz).toFixed(0)} m`;
      drawRadar(g, p);
    },
  };

  api.updateOrbit = (o, info) => {
    const alt = altOf(o), el = info.el, speed = Math.hypot(o.vu, o.vv);
    const km = (v) => (!Number.isFinite(v) ? "—" : v < -50 ? "none" : `${v.toFixed(v < 10 ? 1 : 0)} km`);
    O.alt.textContent = alt < 10 ? `${(alt * 1000).toFixed(0)} m` : `${alt.toFixed(1)} km`;
    O.speed.textContent = `${speed.toFixed(2)} km/s`;
    O.ap.textContent = km(el.ap);
    O.pe.textContent = km(el.pe);
    O.pe.className = o.inOrbit || el.pe > ATMO ? "ok" : "";
    O.pitch.textContent = `${o.pitch.toFixed(0)}°`;
    O.guide.textContent = `guide ${Math.round(info.guide)}°`;
    const off = Math.abs(((o.pitch - info.guide + 540) % 360) - 180);
    O.pitch.className = o.phase === "pad" ? "" : off < 5 ? "ok" : off < 15 ? "warn" : "bad";
    O.thr.textContent = o.lit ? `${Math.round(o.thr * 100)}%` : "OFF";
    O.thrbar.style.width = `${o.lit ? o.thr * 100 : 0}%`;
    O.f1name.textContent = o.stage === 1 ? "BOOSTER" : "BOOSTER (gone)";
    O.f1.textContent = `${Math.round((o.fuel1 / o.fuel1_0) * 100)}%`;
    O.f1bar.style.width = `${(o.fuel1 / o.fuel1_0) * 100}%`;
    const f2 = o.fuel2 / o.fuel2_0;
    O.f2.textContent = `${Math.round(f2 * 100)}%`;
    O.f2bar.style.width = `${f2 * 100}%`;
    O.f2box.classList.toggle("low", f2 < 0.15);
    const showHeat = o.deorbited;
    O.heatrow.classList.toggle("sg-hide", !showHeat);
    O.heatbox.classList.toggle("sg-hide", !showHeat);
    O.heat.textContent = `${Math.round(o.heat * 100)}%`;
    O.heatbar.style.width = `${Math.min(1, o.heat) * 100}%`;
    if (o.inOrbit && info.err != null) {
      O.tname.textContent = "LANDING";
      O.tgt.textContent = Math.abs(info.err) < 3 ? "ON TARGET" : `${Math.abs(info.err).toFixed(0)} km ${info.err > 0 ? "short" : "long"}`;
    } else {
      O.tname.textContent = "AROUND";
      O.tgt.textContent = `${Math.max(0, Math.round(o.swept))}° / 360°`;
    }
    O.phase.textContent = { pad: "ON THE PAD", ascent: o.stage === 1 ? "ASCENT · STAGE 1" : "ASCENT · SHIP", orbit: "IN ORBIT", reentry: "REENTRY" }[o.phase] || "";
    O.warp.textContent = info.warp > 1 ? `WARP ×${info.warp}` : "";
    drawMap(o, info);
  };

  // the orbit map: the planet, the air, Starbase, the predicted path and the ship
  function drawMap(o, info) {
    const W = 250, H = 150, alt = altOf(o);
    ctx.fillStyle = "#020309"; ctx.fillRect(0, 0, W, H);
    // zoom: the whole orbit once up there, the launch area before that
    const view = o.inOrbit || alt > 40 ? PLANET_R + Math.max(130, (info.el.ap || 0) + 30) : PLANET_R * 0.25 + alt * 3;
    const sc = (H / 2 - 6) / view;
    const cx = W / 2, cy = o.inOrbit || alt > 40 ? H / 2 : H / 2 + PLANET_R * sc - 20;
    const X = (u) => cx + u * sc, Y = (v) => cy - v * sc;
    ctx.fillStyle = "#0b2a55"; ctx.beginPath(); ctx.arc(cx, cy, (PLANET_R + ATMO) * sc, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#1f64b0"; ctx.beginPath(); ctx.arc(cx, cy, PLANET_R * sc, 0, Math.PI * 2); ctx.fill();
    // how far round so far
    if (o.swept > 1) {
      ctx.strokeStyle = "#ffd674"; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(cx, cy, PLANET_R * sc - 3, -Math.PI / 2, -Math.PI / 2 + Math.min(2 * Math.PI, (o.swept * Math.PI) / 180)); ctx.stroke();
    }
    // Starbase
    ctx.fillStyle = "#4fd0b0"; ctx.fillRect(X(0) - 2, Y(PLANET_R) - 5, 4, 6);
    ctx.fillStyle = "#ffd674";
    info.path.forEach((p, i) => { if (i % 2 === 0) ctx.fillRect(Math.round(X(p[0])) - 1, Math.round(Y(p[1])) - 1, 2, 2); });
    // the ship and where its nose points
    const r = Math.hypot(o.u, o.v), ru = o.u / r, rv = o.v / r, tu = rv, tv = -ru;
    const c = Math.cos((o.pitch * Math.PI) / 180), s = Math.sin((o.pitch * Math.PI) / 180), nu = c * ru - s * tu, nv = c * rv - s * tv;
    ctx.strokeStyle = "#e8ecf3"; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(X(o.u), Y(o.v)); ctx.lineTo(X(o.u) + nu * 9, Y(o.v) - nv * 9); ctx.stroke();
    ctx.fillStyle = o.lit ? "#ec661e" : "#e8ecf3"; ctx.fillRect(X(o.u) - 2, Y(o.v) - 2, 4, 4);
  }

  // side view, auto-zoomed to keep the ship and the target in frame.
  // Screen right is -z, as in the 3D view.
  function drawRadar(g, p) {
    const W = 250, H = 150, tz = g.mission.target.z, ty = g.mission.target.y;
    const path = predict(g, g.lit ? 8 : 14, 40);
    const zs = [g.z, tz, ...path.map((q) => q[0])], ys = [g.y, 0, ty, ...path.map((q) => q[1])];
    let z0 = Math.min(...zs), z1 = Math.max(...zs), y1 = Math.max(...ys, 120);
    const span = Math.max(z1 - z0, y1 * 1.4, 160) * 1.15, cz = (z0 + z1) / 2;
    const sc = Math.min(W / span, (H - 16) / (y1 * 1.12));
    const X = (z) => W / 2 - (z - cz) * sc, Y = (y) => H - 10 - y * sc;
    ctx.fillStyle = "#060a1a"; ctx.fillRect(0, 0, W, H);
    // ground and sea
    ctx.fillStyle = "#463a3e"; ctx.fillRect(0, Y(0), W, H - Y(0));
    const sea = X(SHORE_Z * U);
    ctx.fillStyle = "#1d4878"; if (sea > 0) ctx.fillRect(0, Y(0), Math.min(W, sea), H - Y(0));
    // structures
    ctx.fillStyle = "#59627f";
    const rect = (zA, zB, h) => { const a = X(zA), b = X(zB); ctx.fillRect(Math.min(a, b), Y(h), Math.max(1, Math.abs(b - a)), Y(0) - Y(h)); };
    rect(-TOWER_HALF * U, TOWER_HALF * U, TOWER_H * U);
    rect((BUILDING.z - BUILDING.hz) * U, (BUILDING.z + BUILDING.hz) * U, BUILDING.h * U);
    ctx.fillStyle = "#8590ab";
    rect((PAD_A - PAD_R) * U, (PAD_A + PAD_R) * U, 2); rect((PAD_B - PAD_R) * U, (PAD_B + PAD_R) * U, 2);
    // target
    ctx.strokeStyle = "#4fd0b0"; ctx.lineWidth = 2;
    const ty2 = g.mission.id === "descent" ? ARM_TOP * U : 0;
    ctx.beginPath(); ctx.moveTo(X(tz) - 7, Y(ty2)); ctx.lineTo(X(tz) + 7, Y(ty2)); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(X(tz), Y(ty2) - 3); ctx.lineTo(X(tz), Y(ty2) - 14); ctx.stroke();
    // predicted path
    ctx.fillStyle = "#ffd674";
    path.forEach((q, i) => { if (i % 2 === 0) ctx.fillRect(Math.round(X(q[0])) - 1, Math.round(Y(q[1] - 21)) - 1, 2, 2); });
    // the ship, drawn along its axis
    const L = Math.max(7, 50 * sc);
    const bx = X(p.base[0]), by = Y(p.base[1]), nx = bx - p.axis[0] * L, ny = by - p.axis[1] * L;
    ctx.strokeStyle = "#e8ecf3"; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(nx, ny); ctx.stroke();
    if (g.lit) { ctx.strokeStyle = "#ec661e"; ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(bx + p.axis[0] * L * 0.6 * g.thr, by + p.axis[1] * L * 0.6 * g.thr); ctx.stroke(); }
    ctx.fillStyle = "#56617f"; ctx.font = "9px ui-monospace, monospace";
    ctx.fillText(`${Math.round(span)} m`, W - 40, 10);
  }

  return api;
}
