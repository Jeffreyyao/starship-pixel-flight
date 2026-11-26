// Page basics: a full-window canvas, a loading message, and the art-pixel
// size picked from the window.

const style = document.createElement("style");
style.textContent = `
html, body { margin: 0; height: 100%; background: #060a1a; overflow: hidden; }
body > canvas { display: block; width: 100vw; height: 100vh; height: 100dvh; touch-action: none; }
.ss-load { position: fixed; inset: 0; display: grid; place-items: center; color: #8590ab; font: 12px ui-monospace, Menlo, monospace; letter-spacing: .1em; pointer-events: none; }
`;
document.head.appendChild(style);

export function showLoading(text) {
  const d = document.createElement("div");
  d.className = "ss-load";
  d.textContent = text;
  document.body.appendChild(d);
  return () => d.remove();
}

export const viewportSize = () => ({ w: window.innerWidth, h: Math.max(1, window.innerHeight) });

// 5 CSS px per art pixel on a desktop window, proportionally smaller on phones
export const defaultPixel = () => {
  const m = Math.min(window.innerWidth, window.innerHeight);
  return m >= 700 ? 5 : Math.max(2, Math.round(m / 150));
};
// portrait screens are narrower than the action: pull the camera back
export const portraitFit = (aspect) => Math.max(1, 0.9 / aspect);
