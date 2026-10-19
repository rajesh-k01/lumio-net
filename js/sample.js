// A generated sample photo (dusk over a lake), so the page opens with something real to enhance.
// Deterministic, 640x427, deliberately soft and a little noisy like a small phone shot.

function prng(seed) {
  let a = seed;
  return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

export function makeSample() {
  const W = 1280, H = 854, HZ = Math.round(H * 0.56), rnd = prng(20261019);
  const c = document.createElement("canvas");
  c.width = W; c.height = H;
  const g = c.getContext("2d");

  const sky = g.createLinearGradient(0, 0, 0, HZ);
  [[0, "#1d2d63"], [0.35, "#5b4a8f"], [0.62, "#d9728a"], [0.82, "#f6a56a"], [1, "#ffd9a0"]].forEach(([o, col]) => sky.addColorStop(o, col));
  g.fillStyle = sky; g.fillRect(0, 0, W, HZ + 2);

  const sx = W * 0.64, sy = HZ - 18;
  const glow = g.createRadialGradient(sx, sy, 0, sx, sy, 380);
  glow.addColorStop(0, "rgba(255,236,190,.95)"); glow.addColorStop(0.18, "rgba(255,200,140,.55)"); glow.addColorStop(1, "rgba(255,160,120,0)");
  g.fillStyle = glow; g.fillRect(0, 0, W, HZ + 2);
  g.fillStyle = "#fff6dc"; g.beginPath(); g.arc(sx, sy, 38, 0, 7); g.fill();

  for (let i = 0; i < 9; i++) {
    g.fillStyle = `rgba(255,${180 + ((rnd() * 40) | 0)},${170 + ((rnd() * 50) | 0)},${0.18 + rnd() * 0.22})`;
    g.beginPath(); g.ellipse(rnd() * W, 60 + rnd() * HZ * 0.55, 120 + rnd() * 260, 8 + rnd() * 16, 0, 0, 7); g.fill();
  }

  const ridge = (base, amp, f1, f2, col) => {
    const p1 = rnd() * 100, p2 = rnd() * 100;
    g.fillStyle = col; g.beginPath(); g.moveTo(0, HZ + 2);
    for (let x = 0; x <= W; x += 4) g.lineTo(x, base - amp * (0.55 * Math.sin(x * f1 + p1) + 0.3 * Math.sin(x * f2 + p2) + 0.15 * Math.sin(x * f2 * 3.1 + p1)));
    g.lineTo(W, HZ + 2); g.closePath(); g.fill();
  };
  ridge(HZ - 70, 60, 0.004, 0.011, "#6d5a8e"); ridge(HZ - 40, 48, 0.006, 0.017, "#4a4478"); ridge(HZ - 14, 30, 0.009, 0.026, "#2c3463");

  const lake = g.createLinearGradient(0, HZ, 0, H);
  [[0, "#f2a37a"], [0.12, "#a8618a"], [0.5, "#2d3b77"], [1, "#0f1d45"]].forEach(([o, col]) => lake.addColorStop(o, col));
  g.fillStyle = lake; g.fillRect(0, HZ, W, H - HZ);
  for (let y = HZ + 2; y < H; y += 3) {           // the sun's reflection, broken into ripples
    const t = (y - HZ) / (H - HZ), half = 14 + t * 120, jit = (rnd() - 0.5) * 40 * t;
    g.fillStyle = `rgba(255,225,170,${0.55 * (1 - t * 0.85) * rnd()})`;
    g.fillRect(sx + jit - half * rnd(), y, half * 2 * rnd() + 6, 1.4);
  }
  for (let i = 0; i < 340; i++) {
    const y = HZ + 6 + Math.pow(rnd(), 1.6) * (H - HZ);
    g.fillStyle = `rgba(255,255,255,${0.03 + rnd() * 0.07})`;
    g.fillRect(rnd() * W, y, 20 + rnd() * 140 * ((y - HZ) / (H - HZ + 1)), 1);
  }

  g.lineCap = "round";                            // reeds: thin curved strokes are what upscaling blurs first
  for (let i = 0; i < 190; i++) {
    const x = rnd() * W, h = 90 + Math.pow(rnd(), 0.8) * 330, lean = (rnd() - 0.5) * 90, tone = (14 + rnd() * 26) | 0;
    g.strokeStyle = `rgb(${tone},${tone + 10},${tone + 28})`; g.lineWidth = 1.2 + rnd() * 2.6;
    g.beginPath(); g.moveTo(x, H + 8); g.quadraticCurveTo(x + lean * 0.2, H - h * 0.55, x + lean, H - h); g.stroke();
    if (rnd() < 0.22) { g.fillStyle = "#0a1330"; g.beginPath(); g.ellipse(x + lean, H - h - 10, 3.2, 14, lean * 0.004, 0, 7); g.fill(); }
  }

  g.strokeStyle = "rgba(20,20,50,.7)"; g.lineWidth = 2;
  for (const [bx, by, s] of [[300, 150, 14], [340, 175, 10], [420, 120, 12], [880, 210, 9], [930, 190, 11]]) {
    g.beginPath(); g.moveTo(bx - s, by); g.quadraticCurveTo(bx - s / 2, by - s / 2, bx, by); g.quadraticCurveTo(bx + s / 2, by - s / 2, bx + s, by); g.stroke();
  }

  // Make it a small, soft, slightly noisy photo.
  const mid = document.createElement("canvas"); mid.width = 480; mid.height = 320;
  const mg = mid.getContext("2d"); mg.imageSmoothingQuality = "high"; mg.drawImage(c, 0, 0, 480, 320);
  const out = document.createElement("canvas"); out.width = 640; out.height = 427;
  const og = out.getContext("2d"); og.imageSmoothingQuality = "high"; og.drawImage(mid, 0, 0, 640, 427);
  const px = og.getImageData(0, 0, 640, 427), n = prng(7);
  for (let i = 0; i < px.data.length; i += 4) {
    const d = (n() + n() + n() - 1.5) * 10;
    px.data[i] += d; px.data[i + 1] += d; px.data[i + 2] += d;
  }
  og.putImageData(px, 0, 0);
  return out;
}
