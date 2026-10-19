// The signature motion: a photo "resolves" from coarse pixel blocks to full detail, top to bottom,
// like focus being pulled. Used when a photo opens, when a result arrives, and (reversed) when a
// photo is replaced. Draws onto a canvas sized to the frame, so even an 8K result stays cheap.

import { clamp, easeOutCubic, reducedMotion } from "./util.js";

const LEVELS = [32, 16, 8, 4, 2, 1]; // block size in canvas pixels, coarse to fine
const BAND = 32;                     // rows resolve in bands this tall, so 32px blocks stay square
const tiny = document.createElement("canvas");

function drawFrame(ctx, img, cw, ch, t) {
  const iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height;
  const sy = ih / ch, lag = 0.75;
  for (let y = 0; y < ch; y += BAND) {
    const bh = Math.min(BAND, ch - y);
    const local = clamp(t * (1 + lag) - (y / ch) * lag, 0, 1); // the top of the picture leads
    const level = LEVELS[Math.min(LEVELS.length - 1, Math.floor(easeOutCubic(local) * LEVELS.length))];
    if (level === 1) {
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(img, 0, y * sy, iw, bh * sy, 0, y, cw, bh);
      continue;
    }
    const tw = Math.ceil(cw / level), th = Math.max(1, Math.ceil(bh / level));
    tiny.width = tw; tiny.height = th;
    const tc = tiny.getContext("2d");
    tc.imageSmoothingQuality = "high";
    tc.drawImage(img, 0, y * sy, iw, bh * sy, 0, 0, tw, th);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(tiny, 0, 0, tw, th, 0, y, tw * level, th * level);
  }
}

/** Resolve `img` into `canvas`. reverse=true goes sharp to blocks. Resolves when finished or superseded. */
export function resolve(canvas, img, { duration = 900, reverse = false } = {}) {
  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingQuality = "high";
  const token = (canvas._rz = {});
  const cw = canvas.width, ch = canvas.height;
  if (reducedMotion()) {
    reverse ? ctx.clearRect(0, 0, cw, ch) : drawFrame(ctx, img, cw, ch, 1);
    return Promise.resolve();
  }
  return new Promise((done) => {
    const t0 = performance.now();
    const tick = (now) => {
      if (canvas._rz !== token) return done();
      const p = clamp((now - t0) / duration, 0, 1);
      drawFrame(ctx, img, cw, ch, reverse ? 1 - p : p);
      p < 1 ? requestAnimationFrame(tick) : done();
    };
    requestAnimationFrame(tick);
  });
}

/** Stop any running resolve on this canvas. */
export function stopResolve(canvas) { canvas._rz = null; }
