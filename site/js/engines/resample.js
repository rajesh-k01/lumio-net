// Lanczos-3 resampling + adaptive sharpening, tiled so memory stays bounded
// even at 8K.
//
// Why not just draw the source onto a bigger canvas? Canvas drawImage uses a
// fast bilinear filter: it blurs edges, rings on hard contrast and turns
// fine texture into mush. Lanczos-3 is the classic "photographic" kernel: it
// keeps edges crisp and holds detail far better when a photo is blown up.
//
// The whole image never lives in a float buffer. We walk the output in
// horizontal bands; for each band we only resample the source rows that band
// needs, and sharpen it with a margin so the blur is seamless. At 8K that
// turns a ~600 MB working set into ~25 MB.
//
// Pure pixel code: no DOM, so it runs in a worker and in the Node tests.

export const LANCZOS_A = 3;

/** Lanczos-3 kernel. x is in kernel units, a is the support radius. */
export function lanczos(x, a = LANCZOS_A) {
  if (x === 0) return 1;
  x = Math.abs(x);
  if (x >= a) return 0;
  const px = Math.PI * x;
  return (a * Math.sin(px) * Math.sin(px / a)) / (px * px);
}

/**
 * Per-output-pixel filter taps for one axis.
 * When downscaling, the kernel is widened by the scale factor so the result
 * is anti-aliased instead of aliased.
 * Returns { idx: Int32Array, w: Float32Array, taps }.
 */
export function axisTaps(outLen, srcLen, a = LANCZOS_A) {
  const scale = srcLen / outLen;
  const widen = Math.max(1, scale); // > 1 when downscaling
  const support = a * widen;
  const taps = Math.ceil(2 * support) + 2;
  const idx = new Int32Array(outLen * taps);
  const w = new Float32Array(outLen * taps);
  for (let o = 0; o < outLen; o++) {
    const center = (o + 0.5) * scale - 0.5;
    const start = Math.ceil(center - support);
    const end = Math.floor(center + support);
    let sum = 0, k = 0;
    for (let s = start; s <= end; s++) {
      const weight = lanczos((s - center) / widen, a) / widen;
      idx[o * taps + k] = s;
      w[o * taps + k] = weight;
      sum += weight;
      k++;
    }
    for (let j = 0; j < k; j++) w[o * taps + j] /= sum || 1; // keep flat areas flat
  }
  return { idx, w, taps };
}

const clampIdx = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

/**
 * Resample one horizontal band of the output: output rows [y0, y1).
 * Returns a Float32Array of outW * (y1 - y0) * 4.
 */
export function resampleBand(rgba, srcW, srcH, outW, outH, y0, y1, hx, vy) {
  const needH = srcW !== outW;
  const needV = srcH !== outH;

  // Source rows this band needs.
  let top = srcH - 1, bottom = 0;
  for (let k = 0; k < vy.taps; k++) {
    if (vy.w[y0 * vy.taps + k] === 0) continue;
    const s = vy.idx[y0 * vy.taps + k];
    if (s < top) top = s;
  }
  for (let k = 0; k < vy.taps; k++) {
    if (vy.w[(y1 - 1) * vy.taps + k] === 0) continue;
    const s = vy.idx[(y1 - 1) * vy.taps + k];
    if (s > bottom) bottom = s;
  }
  const srcY0 = clampIdx(top, 0, srcH - 1);
  const srcY1 = clampIdx(bottom, 0, srcH - 1);
  const srcRows = srcY1 - srcY0 + 1;

  // Horizontal pass -> float buffer of those source rows at output width.
  let hbuf = null;
  if (needH) {
    hbuf = new Float32Array(outW * srcRows * 4);
    for (let r = 0; r < srcRows; r++) {
      const srcBase = (srcY0 + r) * srcW * 4;
      const outBase = r * outW * 4;
      for (let ox = 0; ox < outW; ox++) {
        const tb = ox * hx.taps;
        let r0 = 0, g0 = 0, b0 = 0, a0 = 0;
        for (let k = 0; k < hx.taps; k++) {
          const w = hx.w[tb + k];
          if (w === 0) continue;
          const p = srcBase + clampIdx(hx.idx[tb + k], 0, srcW - 1) * 4;
          r0 += rgba[p] * w; g0 += rgba[p + 1] * w; b0 += rgba[p + 2] * w; a0 += rgba[p + 3] * w;
        }
        const o = outBase + ox * 4;
        hbuf[o] = r0; hbuf[o + 1] = g0; hbuf[o + 2] = b0; hbuf[o + 3] = a0;
      }
    }
  }

  // Vertical pass -> the band itself.
  const rows = y1 - y0;
  const vbuf = new Float32Array(outW * rows * 4);
  for (let oy = 0; oy < rows; oy++) {
    const gy = y0 + oy;
    const tb = gy * vy.taps;
    const outBase = oy * outW * 4;
    if (!needV) {
      for (let ox = 0; ox < outW; ox++) {
        const p = gy * srcW * 4 + ox * 4, o = outBase + ox * 4;
        vbuf[o] = rgba[p]; vbuf[o + 1] = rgba[p + 1]; vbuf[o + 2] = rgba[p + 2]; vbuf[o + 3] = rgba[p + 3];
      }
      continue;
    }
    for (let ox = 0; ox < outW; ox++) {
      let r0 = 0, g0 = 0, b0 = 0, a0 = 0;
      for (let k = 0; k < vy.taps; k++) {
        const w = vy.w[tb + k];
        if (w === 0) continue;
        const s = vy.idx[tb + k];
        let p;
        if (needH) {
          p = ((clampIdx(s, 0, srcH - 1) - srcY0) * outW + ox) * 4;
        } else {
          p = (clampIdx(s, 0, srcH - 1) * srcW + ox) * 4;
        }
        r0 += (needH ? hbuf[p] : rgba[p]) * w;
        g0 += (needH ? hbuf[p + 1] : rgba[p + 1]) * w;
        b0 += (needH ? hbuf[p + 2] : rgba[p + 2]) * w;
        a0 += (needH ? hbuf[p + 3] : rgba[p + 3]) * w;
      }
      const o = outBase + ox * 4;
      vbuf[o] = r0; vbuf[o + 1] = g0; vbuf[o + 2] = b0; vbuf[o + 3] = a0;
    }
  }
  return vbuf;
}

/**
 * Box-blur a float luma band (rows x w) with 3 box passes per axis.
 * Edges use a shrinking window, so flat areas stay exactly flat.
 */
export function blurLumaBand(src, w, rows, radius) {
  const n = w * rows;
  const a = Float32Array.from(src);
  const b = new Float32Array(n);
  const prefix = new Float64Array(Math.max(w, rows) + 1);
  const boxLine = (src, dst, count, r, start, stride) => {
    prefix[0] = 0;
    for (let i = 0; i < count; i++) prefix[i + 1] = prefix[i] + src[start + i * stride];
    for (let i = 0; i < count; i++) {
      const lo = Math.max(0, i - r), hi = Math.min(count - 1, i + r);
      dst[start + i * stride] = (prefix[hi + 1] - prefix[lo]) / (hi - lo + 1);
    }
  };
  for (let pass = 0; pass < 3; pass++) {
    for (let y = 0; y < rows; y++) boxLine(a, b, w, radius, y * w, 1);
    for (let x = 0; x < w; x++) boxLine(b, a, rows, radius, x, w);
  }
  return a;
}

/**
 * Resample and sharpen in one tiled pass.
 *
 * @param {Uint8ClampedArray} rgba  source pixels (srcW * srcH * 4)
 * @param {number} srcW
 * @param {number} srcH
 * @param {number} outW
 * @param {number} outH
 * @param {object} opts
 * @param {number} opts.amount        0..1.4 sharpening strength (0 = off)
 * @param {number} opts.radius        blur radius in output pixels
 * @param {number} opts.band          output rows per band (memory knob)
 * @param {(v:number)=>void} opts.onProgress
 * @param {()=>boolean} opts.isCancelled
 * @returns {Uint8ClampedArray} outW * outH * 4
 */
export function enhanceLanczos(rgba, srcW, srcH, outW, outH, opts = {}) {
  const { amount = 0, radius = 1, band = 48, onProgress, isCancelled } = opts;
  const out = new Uint8ClampedArray(outW * outH * 4);

  if (srcW === outW && srcH === outH) {
    out.set(rgba.subarray(0, Math.min(rgba.length, out.length)));
    return out;
  }

  const hx = axisTaps(outW, srcW);
  const vy = axisTaps(outH, srcH);

  // Margin rows so the vertical blur of every written row is seamless.
  const margin = amount > 0 ? 3 * radius + 2 : 0;

  for (let y0 = 0; y0 < outH; y0 += band) {
    if (isCancelled?.()) throw new Error("Cancelled");
    const y1 = Math.min(outH, y0 + band);
    const ey0 = Math.max(0, y0 - margin);
    const ey1 = Math.min(outH, y1 + margin);

    const buf = resampleBand(rgba, srcW, srcH, outW, outH, ey0, ey1, hx, vy);
    const rows = ey1 - ey0;

    if (amount > 0) {
      // Luma of the band, then its blur, then the unsharp mask.
      const luma = new Float32Array(outW * rows);
      for (let i = 0; i < outW * rows; i++) {
        const p = 4 * i;
        luma[i] = 0.299 * buf[p] + 0.587 * buf[p + 1] + 0.114 * buf[p + 2];
      }
      const blur = blurLumaBand(luma, outW, rows, radius);
      const top = (y0 - ey0) * outW;                 // first row we keep
      const count = (y1 - y0) * outW;
      for (let i = top; i < top + count; i++) {
        const diff = luma[i] - blur[i];
        // Soft threshold: no ringing on flat noise, full bite on real edges.
        const d = diff * (Math.abs(diff) / (Math.abs(diff) + 3)) * amount;
        const p = 4 * i;
        buf[p] += d; buf[p + 1] += d; buf[p + 2] += d;
      }
    }

    // Write the band out. The buffer starts at the margin row ey0, so the
    // rows we keep start at (y0 - ey0).
    const skip = (y0 - ey0) * outW * 4;
    for (let r = 0; r < y1 - y0; r++) {
      const from = skip + r * outW * 4;
      out.set(buf.subarray(from, from + outW * 4), (y0 + r) * outW * 4);
    }

    onProgress?.((y1 / outH) * 0.9);
  }

  return out;
}
