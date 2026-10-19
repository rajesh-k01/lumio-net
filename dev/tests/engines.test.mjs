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
