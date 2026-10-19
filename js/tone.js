// Tone profiles: a 3x256 lookup table learned from an (original, reference) pair of the
// same photo. Per-channel histogram specification, as in the Python tool. No DOM access.

/** Histogram-match the tones of srcRGBA onto refRGBA (both RGBA byte arrays). Returns [R[256], G[256], B[256]]. */
export function fitLut(srcRGBA, refRGBA) {
  const hist = (d) => {
    const H = [new Float64Array(256), new Float64Array(256), new Float64Array(256)];
    for (let i = 0; i < d.length; i += 4) { H[0][d[i]]++; H[1][d[i + 1]]++; H[2][d[i + 2]]++; }
    return H;
  };
  const cdf = (h) => {
    const c = new Float64Array(256);
    let t = 0;
    for (let i = 0; i < 256; i++) { t += h[i]; c[i] = t; }
    for (let i = 0; i < 256; i++) c[i] /= t;
    return c;
  };
  const hs = hist(srcRGBA), hr = hist(refRGBA);
  const lut = [];
  for (let c = 0; c < 3; c++) {
    const cs = cdf(hs[c]), cr = cdf(hr[c]), m = new Float64Array(256);
    for (let i = 0; i < 256; i++) {            // first tone in the reference whose cdf reaches ours
      let lo = 0, hi = 255;
      while (lo < hi) { const mid = (lo + hi) >> 1; if (cr[mid] >= cs[i] - 1e-12) hi = mid; else lo = mid + 1; }
      m[i] = lo;
    }
    let first = 0; while (first < 255 && hs[c][first] === 0) first++;
    let last = 255; while (last > 0 && hs[c][last] === 0) last--;
    // Tones the original never contains carry no information: continue the curve with slope 1.
    for (let i = 0; i < first; i++) m[i] = Math.max(0, m[first] - (first - i));
    for (let i = last + 1; i < 256; i++) m[i] = Math.min(255, m[last] + (i - last));
    const sm = new Float64Array(256);
    for (let i = 0; i < 256; i++) {            // smooth, then force monotonic
      let t = 0;
      for (let k = -4; k <= 4; k++) t += m[Math.min(255, Math.max(0, i + k))];
      sm[i] = t / 9;
    }
    for (let i = 1; i < 256; i++) sm[i] = Math.max(sm[i], sm[i - 1]);
    lut.push(Array.from(sm, (v) => Math.min(255, Math.max(0, v))));
  }
  return lut;
}

/** Weighted average of an existing profile (built from oldPairs pairs) and a new curve. */
export function mergeLut(oldLut, oldPairs, newLut) {
  return oldLut.map((ch, c) => ch.map((v, i) => (v * oldPairs + newLut[c][i]) / (oldPairs + 1)));
}

/** Apply a profile in place to RGBA bytes. amount 0..1 blends between original and graded. */
export function applyLut(data, lut, amount = 1) {
  if (amount <= 0) return;
  const lr = Uint8ClampedArray.from(lut[0], (v) => v), lg = Uint8ClampedArray.from(lut[1], (v) => v), lb = Uint8ClampedArray.from(lut[2], (v) => v);
  if (amount >= 0.999) {
    for (let i = 0; i < data.length; i += 4) { data[i] = lr[data[i]]; data[i + 1] = lg[data[i + 1]]; data[i + 2] = lb[data[i + 2]]; }
    return;
  }
  const a = 1 - amount;
  for (let i = 0; i < data.length; i += 4) {
    data[i] = data[i] * a + lr[data[i]] * amount;
    data[i + 1] = data[i + 1] * a + lg[data[i + 1]] * amount;
    data[i + 2] = data[i + 2] * a + lb[data[i + 2]] * amount;
  }
}

export function isValidProfile(p) {
  return !!p && Array.isArray(p.lut) && p.lut.length === 3 && p.lut.every((c) => Array.isArray(c) && c.length === 256 && c.every(Number.isFinite)) && Number.isInteger(p.pairs) && p.pairs > 0;
}
