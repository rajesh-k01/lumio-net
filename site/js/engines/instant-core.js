// Pure pixel code for the Instant engine. No DOM access, so it runs in a worker and in Node tests.

export const PRESETS = { hd: 1920, "2k": 2560, "4k": 3840, "8k": 7680 }; // long side, px

/** Output size for a preset: long side = preset, aspect kept, never smaller than the source. */
export function targetSize(w, h, preset) {
  const long = Math.max(PRESETS[preset], Math.max(w, h));
  const s = long / Math.max(w, h);
  return [Math.max(1, Math.round(w * s)), Math.max(1, Math.round(h * s))];
}

/** One box-blur pass along a line (edges use a shrinking window, so flat areas stay flat). */
function boxLine(src, dst, n, r, start, stride, prefix) {
  prefix[0] = 0;
  for (let i = 0; i < n; i++) prefix[i + 1] = prefix[i] + src[start + i * stride];
  for (let i = 0; i < n; i++) {
    const lo = Math.max(0, i - r), hi = Math.min(n - 1, i + r);
    dst[start + i * stride] = (prefix[hi + 1] - prefix[lo]) / (hi - lo + 1);
  }
}

/** Approximate Gaussian blur: three box passes in each direction. Returns a new Float32Array. */
export function gaussBlur(src, w, h, r, onPass) {
  let a = Float32Array.from(src), b = new Float32Array(src.length);
  const prefix = new Float64Array(Math.max(w, h) + 1);
  for (let pass = 0; pass < 3; pass++) {
    for (let y = 0; y < h; y++) boxLine(a, b, w, r, y * w, 1, prefix);
    for (let x = 0; x < w; x++) boxLine(b, a, h, r, x, w, prefix);
    onPass?.((pass + 1) / 3);
  }
  return a;
}

/** Unsharp mask on luminance only (no colour fringes), with a soft threshold that spares noise. RGBA bytes, in place. */
export function sharpenLuma(data, w, h, amount, radius, onProgress) {
  const n = w * h, L = new Float32Array(n);
  for (let i = 0; i < n; i++) L[i] = 0.299 * data[4 * i] + 0.587 * data[4 * i + 1] + 0.114 * data[4 * i + 2];
  const B = gaussBlur(L, w, h, radius, onProgress);
  for (let i = 0; i < n; i++) {
    const diff = L[i] - B[i];
    const d = diff * (Math.abs(diff) / (Math.abs(diff) + 3)) * amount;
    const p = 4 * i;
    data[p] += d; data[p + 1] += d; data[p + 2] += d; // Uint8ClampedArray clamps
  }
}

/** Radius that scales with how much the photo was enlarged. */
export function sharpenRadius(srcW, outW) {
  return Math.max(1, Math.min(6, Math.round((outW / srcW) * 0.6)));
}
