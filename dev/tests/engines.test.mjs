import test from "node:test";
import assert from "node:assert/strict";
import { fitLut, mergeLut, applyLut, isValidProfile } from "../../site/js/tone.js";
import { targetSize, gaussBlur, sharpenLuma, sharpenRadius } from "../../site/js/engines/instant-core.js";
import { tiledInfer, blendToward, padPlanar, Cancelled } from "../../site/js/engines/tiled.js";

// ---------- deterministic random
function rng(seed) { let s = seed; return () => (s = (s * 16807) % 2147483647) / 2147483647; }
function randomRGBA(w, h, seed, lo = 30, hi = 225) {
  const r = rng(seed), d = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) { d[4 * i] = lo + r() * (hi - lo); d[4 * i + 1] = lo + r() * (hi - lo); d[4 * i + 2] = lo + r() * (hi - lo); d[4 * i + 3] = 255; }
  return d;
}

// ---------- tone profiles
test("tone: learns a known grade, monotonic, applies it", () => {
  const N = 4000, src = new Uint8ClampedArray(N * 4), ref = new Uint8ClampedArray(N * 4), r = rng(1);
  for (let i = 0; i < N; i++) {
    const R = 40 + r() * 160, G = 40 + r() * 160, B = 40 + r() * 160;
    src.set([R, G, B, 255], 4 * i); ref.set([R * 1.12 + 8, G, B * 0.9 + 8, 255], 4 * i);
  }
  const lut = fitLut(src, ref);
  assert.equal(lut.length, 3); assert.equal(lut[0].length, 256);
  for (const ch of lut) for (let i = 1; i < 256; i++) assert.ok(ch[i] >= ch[i - 1] - 1e-9, "monotonic");
  const px = new Uint8ClampedArray([100, 100, 100, 255]);
  applyLut(px, lut, 1);
  assert.ok(Math.abs(px[0] - 120) < 8 && Math.abs(px[1] - 100) < 8 && Math.abs(px[2] - 98) < 8, `got ${[...px]}`);
});
test("tone: amount 0 is a no-op, half amount is halfway", () => {
  const lut = [Array.from({ length: 256 }, (_, i) => Math.min(255, i + 40)), Array.from({ length: 256 }, (_, i) => i), Array.from({ length: 256 }, (_, i) => i)];
  const a = new Uint8ClampedArray([100, 100, 100, 255]); applyLut(a, lut, 0); assert.deepEqual([...a], [100, 100, 100, 255]);
  const b = new Uint8ClampedArray([100, 100, 100, 255]); applyLut(b, lut, 0.5); assert.equal(b[0], 120); assert.equal(b[3], 255);
});
test("tone: merge averages by pair count; validation rejects junk", () => {
  const one = Array.from({ length: 256 }, () => Array.from({ length: 256 }, () => 10));
  const two = Array.from({ length: 256 }, () => Array.from({ length: 256 }, () => 40));
  assert.equal(mergeLut(one, 2, two)[0][0], 20);
  assert.ok(isValidProfile({ lut: one.slice(0, 3), pairs: 1 }));
  assert.ok(!isValidProfile({ lut: [[1, 2]], pairs: 1 }) && !isValidProfile(null) && !isValidProfile({ lut: one, pairs: 0 }));
});

// ---------- instant engine
test("sizing matches the Python backend", () => {
  assert.deepEqual(targetSize(1000, 500, "4k"), [3840, 1920]);
  assert.deepEqual(targetSize(500, 1000, "hd"), [960, 1920]);
  assert.deepEqual(targetSize(5000, 2500, "hd"), [5000, 2500]);
  assert.equal(sharpenRadius(640, 1920), 2); assert.equal(sharpenRadius(100, 4000), 6); assert.equal(sharpenRadius(4000, 4000), 1);
});
test("blur: constant stays constant, matches a naive reference on random data", () => {
  const w = 23, h = 17, r = 3;
  const flat = gaussBlur(new Float32Array(w * h).fill(100), w, h, r);
  assert.ok(flat.every((v) => Math.abs(v - 100) < 1e-3));
  const src = Float32Array.from({ length: w * h }, (_, i) => (i * 7919) % 251);
  const naive = (a) => { // one shrinking-window box pass in x then y
    const bx = new Float32Array(a.length), by = new Float32Array(a.length);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { let s = 0, n = 0; for (let k = Math.max(0, x - r); k <= Math.min(w - 1, x + r); k++) { s += a[y * w + k]; n++; } bx[y * w + x] = s / n; }
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { let s = 0, n = 0; for (let k = Math.max(0, y - r); k <= Math.min(h - 1, y + r); k++) { s += bx[k * w + x]; n++; } by[y * w + x] = s / n; }
    return by;
  };
  let ref = src; for (let i = 0; i < 3; i++) ref = naive(ref);
  const got = gaussBlur(src, w, h, r);
  let worst = 0; for (let i = 0; i < got.length; i++) worst = Math.max(worst, Math.abs(got[i] - ref[i]));
  assert.ok(worst < 0.01, `worst diff ${worst}`);
});
test("sharpen: edges overshoot, flat areas and alpha untouched", () => {
  const w = 64, h = 32, d = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const v = x < 32 ? 80 : 170, p = 4 * (y * w + x); d[p] = d[p + 1] = d[p + 2] = v; d[p + 3] = 255; }
  sharpenLuma(d, w, h, 1.2, 2);
  const px = (x) => d[4 * (10 * w + x)];
  assert.ok(px(31) < 80 && px(32) > 170, `edge ${px(31)},${px(32)}`);
  assert.equal(px(5), 80); assert.equal(px(58), 170); assert.equal(d[3], 255);
});
test("sharpen: progress callback reaches 1", () => {
  const seen = []; sharpenLuma(randomRGBA(20, 20, 3), 20, 20, 1, 2, (v) => seen.push(v));
  assert.equal(seen.at(-1), 1);
});

// ---------- tiled inference with a synthetic local operator (no ONNX needed)
// "Model": x2 nearest upsample followed by a 5x5 box blur (replicate edges). Receptive field radius = 2 output px = 1 input px.
function fakeRun(scale) {
  return async (data, [, , H, W]) => {
    const OH = H * scale, OW = W * scale, up = new Float32Array(3 * OH * OW), out = new Float32Array(3 * OH * OW);
    for (let c = 0; c < 3; c++) for (let y = 0; y < OH; y++) for (let x = 0; x < OW; x++) up[c * OH * OW + y * OW + x] = data[c * H * W + Math.floor(y / scale) * W + Math.floor(x / scale)];
    for (let c = 0; c < 3; c++) for (let y = 0; y < OH; y++) for (let x = 0; x < OW; x++) {
      let s = 0; for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) s += up[c * OH * OW + Math.min(OH - 1, Math.max(0, y + dy)) * OW + Math.min(OW - 1, Math.max(0, x + dx))];
      out[c * OH * OW + y * OW + x] = s / 25;
    }
    return { data: out };
  };
}
test("tiled: any tile size gives the same picture as one tile (padding covers the receptive field)", async () => {
  const w = 37, h = 29, rgba = randomRGBA(w, h, 5), run = fakeRun(2);
  const whole = await tiledInfer({ rgba, w, h, scale: 2, tile: 0, pad: 4, run });
  assert.equal(whole.length, w * 2 * h * 2 * 4);
  for (const tile of [8, 13, 16, 40]) {
    const t = await tiledInfer({ rgba, w, h, scale: 2, tile, pad: 4, run });
    let worst = 0; for (let i = 0; i < t.length; i++) worst = Math.max(worst, Math.abs(t[i] - whole[i]));
    assert.ok(worst <= 1, `tile ${tile}: worst diff ${worst}`);
  }
});
test("tiled: reflect padding matches PyTorch semantics (edge pixel not repeated)", () => {
  const chw = new Float32Array(3 * 1 * 4); chw.set([10, 20, 30, 40], 0);
  const { data, W } = padPlanar(chw, 1, 4, 2, "replicate");
  assert.deepEqual([...data.subarray(0, W)], [10, 10, 10, 20, 30, 40, 40, 40]);
  const img = new Float32Array(3 * 4 * 4); for (let i = 0; i < 16; i++) img[i] = i;
  const r = padPlanar(img, 4, 4, 2, "reflect"); // row 0 of padded = row 2 of source, mirrored columns
  assert.deepEqual([...r.data.subarray(0, r.W)], [10, 9, 8, 9, 10, 11, 10, 9]);
});
test("tiled: reports progress, and can be cancelled between tiles", async () => {
  const rgba = randomRGBA(30, 30, 9), seen = [];
  await tiledInfer({ rgba, w: 30, h: 30, scale: 2, tile: 10, pad: 2, run: fakeRun(2), onProgress: (v) => seen.push(v) });
  assert.equal(seen.length, 9); assert.equal(seen.at(-1), 1);
  let n = 0;
  await assert.rejects(tiledInfer({ rgba, w: 30, h: 30, scale: 2, tile: 10, pad: 2, run: fakeRun(2), isCancelled: () => ++n > 3 }), Cancelled);
});
test("blend: strength 1 keeps the model, 0 gives the base, 0.5 is halfway", () => {
  const model = new Uint8ClampedArray([200, 100, 0, 255]), base = new Uint8ClampedArray([100, 100, 100, 255]);
  const a = model.slice(); blendToward(a, base, 1); assert.deepEqual([...a], [200, 100, 0, 255]);
  const b = model.slice(); blendToward(b, base, 0); assert.deepEqual([...b], [100, 100, 100, 255]);
  const c = model.slice(); blendToward(c, base, 0.5); assert.deepEqual([...c], [150, 100, 50, 255]);
});

// ---------- Lanczos resampling (the 8K / quality path)
import { enhanceLanczos, axisTaps, lanczos, blurLumaBand } from "../../site/js/engines/resample.js";

test("lanczos: kernel peaks at 1 and vanishes past the support", () => {
  assert.equal(lanczos(0), 1);
  assert.ok(Math.abs(lanczos(1)) < 0.1);
  assert.equal(lanczos(3), 0);
  assert.equal(lanczos(-3), 0);
});
test("axisTaps: weights are normalised, so flat areas stay exactly flat", () => {
  const { w, taps } = axisTaps(64, 128);
  for (let o = 0; o < 64; o++) {
    let sum = 0;
    for (let k = 0; k < taps; k++) sum += w[o * taps + k];
    assert.ok(Math.abs(sum - 1) < 1e-5, `row ${o} sums to ${sum}`);
  }
});
test("resample: a flat image stays perfectly flat (no ringing)", () => {
  const w = 40, h = 40, px = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) px.set([120, 90, 60, 255], 4 * i);
  const out = enhanceLanczos(px, w, h, 200, 200, { amount: 0, radius: 1 });
  for (let i = 0; i < 200 * 200; i++) {
    assert.equal(out[4 * i], 120); assert.equal(out[4 * i + 1], 90); assert.equal(out[4 * i + 2], 60);
  }
});
test("resample: a hard edge stays hard instead of smearing", () => {
  const w = 40, h = 40, px = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) px.set([x < w / 2 ? 20 : 220, 0, 0, 255], 4 * (y * w + x));
  const out = enhanceLanczos(px, w, h, 160, 160, { amount: 0, radius: 1 });
  const row = 80, vals = [];
  for (let x = 0; x < 160; x++) vals.push(out[4 * (row * 160 + x)]);
  const lo = vals.findIndex((v) => v > 120), hi = vals.findIndex((v) => v > 200);
  assert.ok(hi - lo <= 2, `edge transition was ${hi - lo} px wide, expected 1-2`);
});
test("resample: downscaling a checkerboard averages instead of aliasing", () => {
  const w = 40, h = 40, px = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) px.set([(x + y) % 2 ? 220 : 20, 0, 0, 255], 4 * (y * w + x));
  const out = enhanceLanczos(px, w, h, 20, 20, { amount: 0, radius: 1 });
  const mid = out[4 * (10 * 20 + 10)];
  assert.ok(mid > 60 && mid < 200, `mid pixel was ${mid}, expected an average around 120`);
});
test("resample: bands do not shift the picture (every band lands in the right rows)", () => {
  // A bright band low down in the image must stay low down after a tiled
  // resample with sharpening on — this is what a band-offset bug breaks.
  const w = 64, h = 256, px = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const v = y > 200 ? 240 : 30;
    px.set([v, v, v, 255], 4 * (y * w + x));
  }
  const out = enhanceLanczos(px, w, h, w, h * 2, { amount: 0.8, radius: 2, band: 32 });
  const rowAt = (y) => out[4 * (y * w + w / 2)];
  assert.ok(rowAt(10) < 80, `top of the image should stay dark, got ${rowAt(10)}`);
  assert.ok(rowAt(450) > 200, `the bright band should still be at the bottom, got ${rowAt(450)}`);
  // the transition must land near the expected place, not smeared over the image
  let first = 0;
  for (let y = 0; y < h * 2; y++) if (rowAt(y) > 128) { first = y; break; }
  assert.ok(Math.abs(first - 400) < 12, `band edge moved to row ${first}, expected ~400`);
});
test("resample: sharpening raises edge contrast without moving anything", () => {
  const w = 64, h = 64, px = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) px.set([x < w / 2 ? 40 : 200, 40, 40, 255], 4 * (y * w + x));
  const soft = enhanceLanczos(px, w, h, w * 2, h * 2, { amount: 0, radius: 1 });
  const sharp = enhanceLanczos(px, w, h, w * 2, h * 2, { amount: 0.9, radius: 2 });
  // biggest step between neighbouring pixels along the row that holds the edge
  const step = (arr) => {
    const row = 64;
    let best = 0;
    for (let x = 1; x < w * 2; x++) {
      const d = Math.abs(arr[4 * (row * w * 2 + x)] - arr[4 * (row * w * 2 + x - 1)]);
      if (d > best) best = d;
    }
    return best;
  };
  assert.ok(step(sharp) > step(soft), `sharpened step ${step(sharp)} should beat soft ${step(soft)}`);
  assert.ok(step(sharp) > 90, `sharpened step ${step(sharp)} is too weak to count as sharpening`);
});
test("blurLumaBand: flat rows stay flat, edges do not bleed", () => {
  const w = 8, h = 4, luma = new Float32Array(w * h).fill(100);
  const out = blurLumaBand(luma, w, h, 1);
  for (let i = 0; i < w * h; i++) assert.ok(Math.abs(out[i] - 100) < 1e-3);
});
