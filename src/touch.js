// On-screen controls for phones and tablets. The buttons hold the same keys
// the keyboard does, so the game logic doesn't know the difference:
//   left thumb:  ← →  pitch          right thumb:  ↑ ↓  throttle
//   middle row:  pause · camera · day/night · restart · menu (and ⏩ warp while gliding)
// Each button tracks its own pointer, so both thumbs work at once.

const CSS = `
.touch, .touch body { -webkit-user-select: none; user-select: none; -webkit-touch-callout: none; overscroll-behavior: none; }
.tc { position: fixed; inset: 0; z-index: 6; pointer-events: none; font: 700 22px/1 ui-monospace, Menlo, monospace; }
.tc button { pointer-events: auto; touch-action: none; -webkit-tap-highlight-color: transparent; font: inherit; color: #fff5d6; cursor: pointer;
  background: rgba(14, 20, 40, .72); border: 2px solid #56617f; box-shadow: 3px 3px 0 #000; padding: 0; display: grid; place-items: center; }
.tc button.on { background: #ec661e; border-color: #ffd674; color: #1a0a06; box-shadow: 1px 1px 0 #000; transform: translate(2px, 2px); }
.tc .big { width: 66px; height: 66px; }
.tc .small { width: 38px; height: 34px; font-size: 13px; }
.tc .pad { position: absolute; display: flex; gap: 10px; bottom: calc(14px + env(safe-area-inset-bottom)); }
.tc .pad.l { left: calc(12px + env(safe-area-inset-left)); }
.tc .pad.r { right: calc(12px + env(safe-area-inset-right)); flex-direction: column; }
.tc .mid { position: absolute; left: 50%; transform: translateX(-50%); bottom: calc(96px + env(safe-area-inset-bottom)); display: flex; gap: 5px; }
.tc .warp { position: absolute; left: calc(12px + env(safe-area-inset-left)); bottom: calc(92px + env(safe-area-inset-bottom)); width: 66px; height: 40px; font-size: 13px; }
.tc-hide { display: none !important; }

/* make room for the thumbs: radar to the top left, hints above the buttons */
.touch .sg-radar { top: calc(8px + env(safe-area-inset-top)); bottom: auto; left: calc(8px + env(safe-area-inset-left)); padding: 4px; }
.touch .sg-radar small { display: none; }
.touch .sg-radar canvas { width: 150px !important; height: 90px !important; }
.touch .sg-tel { top: calc(8px + env(safe-area-inset-top)); right: calc(8px + env(safe-area-inset-right)); }
.touch .sg-hint { top: auto; bottom: calc(170px + env(safe-area-inset-bottom)); max-width: calc(100vw - 32px); font-size: 12px; }
.touch .sg-keys { display: none; }
.touch .sg-menu, .touch .sg-res { max-height: calc(100dvh - 24px); overflow-y: auto; }
@media (orientation: landscape) and (max-height: 520px) {
  .touch .sg-hint { bottom: auto; top: calc(8px + env(safe-area-inset-top)); max-width: calc(100vw - 380px); }
  .touch .sg-tel { width: 168px; font-size: 10px; padding: 6px 8px; }
  .touch .sg-tel .bar { margin: 1px 0 3px; }
  .tc .pad.r { flex-direction: row; }
  .tc .mid { bottom: calc(14px + env(safe-area-inset-bottom)); }
}
`;

export const isTouchDevice = () =>
  new URLSearchParams(location.search).get("touch") === "1" ||
  matchMedia("(pointer: coarse)").matches || (navigator.maxTouchPoints || 0) > 0 && "ontouchstart" in window;

export function createTouchControls({ keys, onPause, onCamera, onRestart, onMenu, onTime }) {
  const st = document.createElement("style");
  st.textContent = CSS;
  document.head.appendChild(st);

  const root = document.createElement("div");
  root.className = "tc tc-hide";
  root.innerHTML = `
    <div class="pad l"><button class="big" data-k="left" aria-label="pitch nose left">←</button><button class="big" data-k="right" aria-label="pitch nose right">→</button></div>
    <div class="pad r"><button class="big" data-k="up" aria-label="throttle up">↑</button><button class="big" data-k="down" aria-label="throttle down">↓</button></div>
    <button class="warp" data-k="warp" aria-label="time warp">⏩ WARP</button>
    <div class="mid">
      <button class="small" data-a="pause" aria-label="pause">II</button>
      <button class="small" data-a="camera" aria-label="camera distance">CAM</button>
      <button class="small" data-a="time" aria-label="day or night">☾</button>
      <button class="small" data-a="restart" aria-label="restart">↺</button>
      <button class="small" data-a="menu" aria-label="menu">☰</button>
    </div>`;
  document.body.appendChild(root);

  // hold-to-fire buttons: pressed while a pointer is down on them
  for (const b of root.querySelectorAll("[data-k]")) {
    const k = b.dataset.k;
    const press = (e) => {
      e.preventDefault();
      keys[k] = true;
      b.classList.add("on");
      try { b.setPointerCapture(e.pointerId); } catch {} // keeps the press if the thumb slides a little
      try { navigator.vibrate?.(8); } catch {}
    };
    const release = () => { keys[k] = false; b.classList.remove("on"); };
    b.addEventListener("pointerdown", press);
    for (const ev of ["pointerup", "pointercancel", "lostpointercapture"]) b.addEventListener(ev, release);
    b.addEventListener("contextmenu", (e) => e.preventDefault());
  }
  const actions = { pause: onPause, camera: onCamera, restart: onRestart, menu: onMenu, time: onTime };
  for (const b of root.querySelectorAll("[data-a]")) {
    b.addEventListener("pointerdown", (e) => { e.preventDefault(); b.classList.add("on"); });
    b.addEventListener("pointerup", () => { b.classList.remove("on"); actions[b.dataset.a](); });
    b.addEventListener("pointercancel", () => b.classList.remove("on"));
  }
  // no double-tap zoom or long-press menus anywhere in the game
  document.addEventListener("dblclick", (e) => e.preventDefault(), { passive: false });
  document.addEventListener("gesturestart", (e) => e.preventDefault());

  const warp = root.querySelector(".warp");
  return {
    show(on) {
      root.classList.toggle("tc-hide", !on);
      if (!on) for (const b of root.querySelectorAll(".on")) b.classList.remove("on");
    },
    // the warp button only appears while it can be used
    setWarp(on) { warp.classList.toggle("tc-hide", !on); },
    setTime(name) { root.querySelector('[data-a="time"]').textContent = name === "day" ? "☀" : "☾"; },
    setPaused(p) { root.querySelector('[data-a="pause"]').textContent = p ? "▶" : "II"; },
  };
}
