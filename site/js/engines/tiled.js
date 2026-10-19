// Tiled neural inference, a JavaScript port of lumionet/infer.py run_tiled().
// `run` is injected (ONNX Runtime Web in the browser), so this file has no dependencies.
//
// Each tile is processed with `pad` extra pixels of context on every side and only its centre
// is kept. The picture is reflect-padded once up front, so its own borders are treated the same
// at every tile size.

export class Cancelled extends Error {
  constructor() { super("Cancelled"); this.name = "Cancelled"; }
}

export function rgbaToPlanar(rgba, w, h) {
  const n = w * h, out = new Float32Array(3 * n);
  for (let i = 0; i < n; i++) {
    out[i] = rgba[4 * i] / 255;
    out[n + i] = rgba[4 * i + 1] / 255;
    out[2 * n + i] = rgba[4 * i + 2] / 255;
  }
  return out;
}

// PyTorch "reflect": the edge pixel is not repeated. Needs pad < n.
const reflect = (i, n) => (i < 0 ? -i : i >= n ? 2 * (n - 1) - i : i);
const replicate = (i, n) => (i < 0 ? 0 : i >= n ? n - 1 : i);

export function padPlanar(chw, h, w, pad, mode) {
  const H = h + 2 * pad, W = w + 2 * pad, map = mode === "reflect" ? reflect : replicate;
  const out = new Float32Array(3 * H * W);
  for (let c = 0; c < 3; c++) {
    for (let y = 0; y < H; y++) {
      const sy = map(y - pad, h);
      for (let x = 0; x < W; x++) out[c * H * W + y * W + x] = chw[c * h * w + sy * w + map(x - pad, w)];
    }
  }
  return { data: out, H, W };
}

/**
 * @param rgba   Uint8ClampedArray, source RGBA (w x h)
 * @param run    async (Float32Array data, [1,3,H,W]) => { data: Float32Array } with shape [1,3,s*H,s*W]
 * @returns      Uint8ClampedArray RGBA of (w*scale) x (h*scale)
 */
export async function tiledInfer({ rgba, w, h, scale, tile, pad, run, onProgress, isCancelled }) {
  if (!(tile > 0)) tile = Math.max(w, h);
  const mode = Math.min(w, h) > pad ? "reflect" : "replicate";
  const planar = rgbaToPlanar(rgba, w, h);
  const { data: padded, H: PH, W: PW } = padPlanar(planar, h, w, pad, mode);
  const OW = w * scale, OH = h * scale;
  const out = new Uint8ClampedArray(OW * OH * 4);
  for (let i = 3; i < out.length; i += 4) out[i] = 255;

  const nx = Math.ceil(w / tile), ny = Math.ceil(h / tile), total = nx * ny;
  let done = 0;
  for (let y0 = 0; y0 < h; y0 += tile) {
    const th = Math.min(tile, h - y0);
    for (let x0 = 0; x0 < w; x0 += tile) {
      if (isCancelled?.()) throw new Cancelled();
      const tw = Math.min(tile, w - x0);
      const cw = tw + 2 * pad, ch = th + 2 * pad;
      const crop = new Float32Array(3 * ch * cw);
      for (let c = 0; c < 3; c++) {
        for (let y = 0; y < ch; y++) {
          const srcOff = c * PH * PW + (y0 + y) * PW + x0;
          crop.set(padded.subarray(srcOff, srcOff + cw), c * ch * cw + y * cw);
        }
      }
      const { data: o } = await run(crop, [1, 3, ch, cw]);
      const Ws = cw * scale, Hs = ch * scale;
      for (let c = 0; c < 3; c++) {
        for (let yy = 0; yy < th * scale; yy++) {
          const rowIn = c * Hs * Ws + (pad * scale + yy) * Ws + pad * scale;
          const rowOut = ((y0 * scale + yy) * OW + x0 * scale) * 4 + c;
          for (let xx = 0; xx < tw * scale; xx++) out[rowOut + xx * 4] = o[rowIn + xx] * 255; // clamps and rounds
        }
      }
      onProgress?.(++done / total);
    }
  }
  return out;
}

/** out = base + strength * (model - base), in place on `model`. Both RGBA, same size. */
export function blendToward(model, base, strength) {
  if (strength >= 0.999) return;
  for (let i = 0; i < model.length; i += 4) {
    model[i] = base[i] + strength * (model[i] - base[i]);
    model[i + 1] = base[i + 1] + strength * (model[i + 1] - base[i + 1]);
    model[i + 2] = base[i + 2] + strength * (model[i + 2] - base[i + 2]);
  }
}
