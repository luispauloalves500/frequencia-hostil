import * as THREE from "three";

const cache = new Map<string, THREE.Texture>();

function canvasTex(key: string, size: number, draw: (g: CanvasRenderingContext2D, s: number) => void, repeat = true): THREE.Texture {
  const c = cache.get(key);
  if (c) return c;
  const cv = document.createElement("canvas");
  cv.width = cv.height = size;
  const g = cv.getContext("2d")!;
  draw(g, size);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; }
  t.anisotropy = 4;
  cache.set(key, t);
  return t;
}

function rand(seed: number) { let s = seed; return () => ((s = (s * 16807) % 2147483647) / 2147483647); }

function noise(g: CanvasRenderingContext2D, s: number, alpha: number, r: () => number, dark = true) {
  const img = g.getImageData(0, 0, s, s);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (r() - 0.5) * alpha * 255;
    img.data[i] += dark ? n : n; img.data[i + 1] += n; img.data[i + 2] += n;
  }
  g.putImageData(img, 0, 0);
}

function crack(g: CanvasRenderingContext2D, r: () => number, x: number, y: number, len: number, color: string) {
  g.strokeStyle = color; g.lineWidth = 1.2;
  g.beginPath(); g.moveTo(x, y);
  let a = r() * Math.PI * 2;
  for (let i = 0; i < len; i++) {
    a += (r() - 0.5) * 1.2; x += Math.cos(a) * 6; y += Math.sin(a) * 6; g.lineTo(x, y);
    if (r() < 0.15) { g.moveTo(x, y); }
  }
  g.stroke();
}

/** Azulejo trincado de piso (1 tile = 0,5 m; textura cobre 2 m). */
export const texFloorTile = () => canvasTex("floor", 512, (g, s) => {
  const r = rand(11);
  g.fillStyle = "#3d4a52"; g.fillRect(0, 0, s, s);
  const n = 4, ts = s / n;
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
    const v = 70 + r() * 22;
    const alt = (i + j) % 2 === 0;
    g.fillStyle = alt ? `rgb(${v},${v + 12},${v + 16})` : `rgb(${v * 0.6},${v * 0.72},${v * 0.78})`;
    g.fillRect(i * ts + 2, j * ts + 2, ts - 4, ts - 4);
  }
  noise(g, s, 0.12, r);
  for (let k = 0; k < 9; k++) crack(g, r, r() * s, r() * s, 6 + r() * 14, "rgba(15,20,24,0.75)");
  // manchas de sal e umidade
  for (let k = 0; k < 14; k++) {
    const gr = g.createRadialGradient(r() * s, r() * s, 0, r() * s, r() * s, 30 + r() * 70);
    gr.addColorStop(0, `rgba(${r() < 0.5 ? "220,225,215" : "10,14,18"},${0.08 + r() * 0.1})`); gr.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = gr; g.fillRect(0, 0, s, s);
  }
});

export const texWallTile = () => canvasTex("wall", 512, (g, s) => {
  const r = rand(23);
  g.fillStyle = "#29353a"; g.fillRect(0, 0, s, s);
  const n = 8, ts = s / n;
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
    const lower = j > n * 0.55;
    const v = lower ? 70 + r() * 15 : 150 + r() * 25;
    g.fillStyle = lower ? `rgb(${v * 0.5},${v * 0.95},${v * 0.9})` : `rgb(${v * 0.92},${v * 0.96},${v})`;
    g.fillRect(i * ts + 1.5, j * ts + 1.5, ts - 3, ts - 3);
    if (r() < 0.06) { g.fillStyle = "rgba(20,24,26,0.9)"; g.fillRect(i * ts + 1.5, j * ts + 1.5, ts - 3, ts - 3); }
  }
  g.fillStyle = "rgba(255,170,60,0.25)"; g.fillRect(0, s * 0.55, s, 5);
  noise(g, s, 0.1, r);
  // escorrimento de umidade
  for (let k = 0; k < 18; k++) {
    const x = r() * s, h = 60 + r() * 220;
    const gr = g.createLinearGradient(0, 0, 0, h);
    gr.addColorStop(0, "rgba(30,26,20,0.35)"); gr.addColorStop(1, "rgba(30,26,20,0)");
    g.fillStyle = gr; g.fillRect(x, 0, 3 + r() * 6, h);
  }
  for (let k = 0; k < 6; k++) crack(g, r, r() * s, r() * s, 10, "rgba(10,12,14,0.7)");
});

export const texMetal = () => canvasTex("metal", 256, (g, s) => {
  const r = rand(5);
  g.fillStyle = "#4a5056"; g.fillRect(0, 0, s, s);
  for (let y = 0; y < s; y += 16) for (let x = (y / 16) % 2 ? 8 : 0; x < s; x += 16) {
    g.save(); g.translate(x + 4, y + 8); g.rotate(0.6); g.fillStyle = "#6a7178"; g.fillRect(-5, -1.5, 10, 3); g.restore();
  }
  noise(g, s, 0.15, r);
  for (let k = 0; k < 10; k++) { g.fillStyle = `rgba(120,70,30,${0.1 + r() * 0.2})`; g.beginPath(); g.arc(r() * s, r() * s, 6 + r() * 26, 0, 7); g.fill(); }
});

export const texConcrete = () => canvasTex("concrete", 256, (g, s) => {
  const r = rand(9);
  g.fillStyle = "#555a5c"; g.fillRect(0, 0, s, s);
  noise(g, s, 0.22, r);
  for (let k = 0; k < 40; k++) { g.fillStyle = `rgba(${r() < 0.5 ? 30 : 140},${r() < 0.5 ? 34 : 140},${r() < 0.5 ? 36 : 135},0.12)`; g.beginPath(); g.arc(r() * s, r() * s, 2 + r() * 18, 0, 7); g.fill(); }
  g.strokeStyle = "rgba(20,20,20,0.4)"; g.strokeRect(1, 1, s - 2, s - 2);
});

export const texWood = () => canvasTex("wood", 256, (g, s) => {
  const r = rand(17);
  g.fillStyle = "#5a3d26"; g.fillRect(0, 0, s, s);
  for (let y = 0; y < s; y += 32) {
    g.fillStyle = `rgb(${80 + r() * 30},${52 + r() * 20},${30 + r() * 10})`; g.fillRect(0, y + 1, s, 30);
    for (let k = 0; k < 6; k++) { g.strokeStyle = "rgba(30,18,10,0.35)"; g.beginPath(); g.moveTo(0, y + 4 + r() * 24); g.bezierCurveTo(s * 0.3, y + r() * 30, s * 0.6, y + r() * 30, s, y + 4 + r() * 24); g.stroke(); }
  }
  noise(g, s, 0.12, r);
});

export const texGrate = () => canvasTex("grate", 256, (g, s) => {
  g.clearRect(0, 0, s, s);
  g.strokeStyle = "#8a9399"; g.lineWidth = 5;
  const n = 8;
  for (let i = 0; i <= n; i++) {
    g.beginPath(); g.moveTo((i * s) / n, 0); g.lineTo((i * s) / n, s); g.stroke();
    g.beginPath(); g.moveTo(0, (i * s) / n); g.lineTo(s, (i * s) / n); g.stroke();
  }
  g.strokeStyle = "rgba(120,70,40,0.6)"; g.lineWidth = 2;
  for (let i = 0; i < n; i++) { g.beginPath(); g.moveTo((i * s) / n + 3, 0); g.lineTo((i * s) / n + 3, s); g.stroke(); }
});

export const texShutter = () => canvasTex("shutter", 256, (g, s) => {
  for (let y = 0; y < s; y += 16) {
    const gr = g.createLinearGradient(0, y, 0, y + 16);
    gr.addColorStop(0, "#8a8f7a"); gr.addColorStop(0.5, "#5d6150"); gr.addColorStop(1, "#33362c");
    g.fillStyle = gr; g.fillRect(0, y, s, 16);
  }
  const r = rand(3);
  for (let k = 0; k < 20; k++) { g.fillStyle = `rgba(110,60,25,${0.2 + r() * 0.3})`; g.fillRect(r() * s, r() * s, 4 + r() * 30, 2 + r() * 8); }
  g.fillStyle = "rgba(255,190,40,0.85)";
  for (let x = -s; x < s * 2; x += 48) { g.beginPath(); g.moveTo(x, s - 30); g.lineTo(x + 24, s - 30); g.lineTo(x + 54, s); g.lineTo(x + 30, s); g.fill(); }
});

export const texDoor = () => canvasTex("door", 256, (g, s) => {
  g.fillStyle = "#3a4f5c"; g.fillRect(0, 0, s, s);
  g.strokeStyle = "#22303a"; g.lineWidth = 6; g.strokeRect(14, 14, s - 28, s - 28);
  g.fillStyle = "#c9a23a"; g.fillRect(0, s - 26, s, 10);
  noise(g, s, 0.15, rand(31));
});

export const texKiosk = () => canvasTex("kiosk", 512, (g, s) => {
  g.fillStyle = "#24343f"; g.fillRect(0, 0, s, s);
  const r = rand(41);
  const cols = ["#c44d2c", "#e0b34a", "#3f8fa0", "#d8d2c0"];
  for (let k = 0; k < 7; k++) {
    g.fillStyle = cols[k % 4]; const x = r() * s * 0.8, y = r() * s * 0.6;
    g.globalAlpha = 0.85; g.fillRect(x, y, 70 + r() * 60, 100 + r() * 60);
    g.globalAlpha = 1; g.fillStyle = "rgba(0,0,0,0.5)"; g.font = "bold 18px sans-serif"; g.fillText(["BALSA", "SAL", "PORTO", "HORÁRIO"][k % 4], x + 6, y + 26);
  }
  noise(g, s, 0.15, r);
  g.fillStyle = "#11181d"; g.fillRect(0, s * 0.82, s, s * 0.18);
});

export const texLocker = () => canvasTex("locker", 256, (g, s) => {
  g.fillStyle = "#3f5a68"; g.fillRect(0, 0, s, s);
  for (let x = 0; x < s; x += 64) {
    g.fillStyle = "#2a3d48"; g.fillRect(x, 0, 3, s);
    for (let y = 20; y < 70; y += 8) { g.fillStyle = "#1b272e"; g.fillRect(x + 16, y, 32, 3); }
    g.fillStyle = "#b8c0c4"; g.fillRect(x + 50, s * 0.5, 6, 18);
  }
  noise(g, s, 0.12, rand(8));
});

export const texCounter = () => canvasTex("counter", 256, (g, s) => {
  g.fillStyle = "#6b4b32"; g.fillRect(0, 0, s, s);
  g.fillStyle = "#2c3a40"; g.fillRect(0, 0, s, 24);
  noise(g, s, 0.15, rand(12));
  for (let k = 0; k < 6; k++) crack(g, rand(k + 50), Math.random() * s, 30 + Math.random() * 200, 8, "rgba(20,14,8,0.6)");
});

export const texCeiling = () => canvasTex("ceiling", 256, (g, s) => {
  g.fillStyle = "#2a2e31"; g.fillRect(0, 0, s, s);
  g.strokeStyle = "#1a1d20"; g.lineWidth = 3;
  for (let i = 0; i <= 4; i++) { g.beginPath(); g.moveTo((i * s) / 4, 0); g.lineTo((i * s) / 4, s); g.stroke(); g.beginPath(); g.moveTo(0, (i * s) / 4); g.lineTo(s, (i * s) / 4); g.stroke(); }
  noise(g, s, 0.1, rand(77));
  for (let k = 0; k < 4; k++) { g.fillStyle = "rgba(60,45,25,0.35)"; g.beginPath(); g.arc(Math.random() * s, Math.random() * s, 20 + Math.random() * 30, 0, 7); g.fill(); }
});

/** Texto emissivo para placas e letreiros. */
export function texSign(text: string, color: string, w = 1024, h = 128): THREE.Texture {
  return canvasTex(`sign:${text}:${color}:${w}`, w, (g) => {
    g.canvas.height = h;
    g.fillStyle = "#06090c"; g.fillRect(0, 0, w, h);
    g.strokeStyle = color; g.lineWidth = 4; g.globalAlpha = 0.6; g.strokeRect(6, 6, w - 12, h - 12); g.globalAlpha = 1;
    g.font = `700 ${Math.floor(h * 0.52)}px "Trebuchet MS", "DejaVu Sans", sans-serif`;
    g.textAlign = "center"; g.textBaseline = "middle";
    g.shadowColor = color; g.shadowBlur = 18; g.fillStyle = color;
    let fs = Math.floor(h * 0.52);
    while (g.measureText(text).width > w - 40 && fs > 10) { fs -= 2; g.font = `700 ${fs}px "Trebuchet MS", "DejaVu Sans", sans-serif`; }
    g.fillText(text, w / 2, h / 2 + 2);
  }, false);
}

export const texChalk = () => canvasTex("chalk", 256, (g, s) => {
  g.clearRect(0, 0, s, s);
  g.strokeStyle = "rgba(235,235,220,0.9)"; g.lineWidth = 7; g.lineCap = "round";
  g.beginPath(); g.arc(s / 2, s / 2, s * 0.36, 0, Math.PI * 2); g.stroke();
  g.beginPath(); g.moveTo(s * 0.32, s * 0.32); g.lineTo(s * 0.68, s * 0.68); g.moveTo(s * 0.68, s * 0.32); g.lineTo(s * 0.32, s * 0.68); g.stroke();
  g.lineWidth = 3;
  for (let i = 0; i < 3; i++) { g.beginPath(); g.arc(s / 2, s / 2, s * (0.42 + i * 0.03), -0.6 + i * 0.2, 0.6 - i * 0.2); g.stroke(); }
}, false);

export const texRing = () => canvasTex("ring", 512, (g, s) => {
  g.clearRect(0, 0, s, s);
  g.strokeStyle = "rgba(255,255,255,1)"; g.lineWidth = 6; g.setLineDash([22, 16]);
  g.beginPath(); g.arc(s / 2, s / 2, s / 2 - 6, 0, Math.PI * 2); g.stroke();
}, false);

export const texGlow = () => canvasTex("glow", 128, (g, s) => {
  const gr = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  gr.addColorStop(0, "rgba(255,255,255,1)"); gr.addColorStop(0.3, "rgba(255,255,255,0.5)"); gr.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = gr; g.fillRect(0, 0, s, s);
}, false);

export const texFish = () => canvasTex("fish", 256, (g, s) => {
  g.fillStyle = "#0b1a20"; g.fillRect(0, 0, s, s);
  g.strokeStyle = "#7fe6ff"; g.shadowColor = "#7fe6ff"; g.shadowBlur = 16; g.lineWidth = 9;
  g.beginPath(); g.ellipse(s * 0.45, s / 2, s * 0.26, s * 0.14, 0, 0, Math.PI * 2); g.stroke();
  g.beginPath(); g.moveTo(s * 0.71, s / 2); g.lineTo(s * 0.88, s * 0.36); g.lineTo(s * 0.88, s * 0.64); g.closePath(); g.stroke();
  g.fillStyle = "#7fe6ff"; g.beginPath(); g.arc(s * 0.3, s * 0.47, 7, 0, 7); g.fill();
}, false);

export const texSky = () => canvasTex("sky", 512, (g, s) => {
  const gr = g.createLinearGradient(0, 0, 0, s);
  gr.addColorStop(0, "#02040a"); gr.addColorStop(0.55, "#0c1830"); gr.addColorStop(0.75, "#1b2a40"); gr.addColorStop(1, "#2a2a30");
  g.fillStyle = gr; g.fillRect(0, 0, s, s);
  const r = rand(99);
  for (let k = 0; k < 160; k++) { g.fillStyle = `rgba(220,230,255,${r() * 0.5})`; g.fillRect(r() * s, r() * s * 0.5, 1.2, 1.2); }
}, false);
