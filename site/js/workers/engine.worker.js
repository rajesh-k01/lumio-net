// Runs the heavy pixel work off the main thread so the page's animations never stall.
// Messages in:  { id, type: "instant" | "lumionet" | "cancel", ... }
// Messages out: { id, type: "progress" | "done" | "error", ... }

import { sharpenRadius } from "../engines/instant-core.js";
import { enhanceLanczos } from "../engines/resample.js";
import { applyLut } from "../tone.js";
import { tiledInfer, blendToward, Cancelled } from "../engines/tiled.js";

let ort = null, session = null, sessionKey = "";
const cancelled = new Set();
const send = (msg, transfer) => self.postMessage(msg, transfer || []);

async function getSession(m) {
  const key = `${m.ortUrl}|${m.modelUrl}|${m.providers.join(",")}`;
  if (session && key === sessionKey) return session;
  send({ id: m.id, type: "progress", stage: "Loading AI model", value: 0 });
  if (!ort) {
    ort = await import(m.ortUrl);
    ort.env.wasm.numThreads = self.crossOriginIsolated ? Math.min(4, self.navigator.hardwareConcurrency || 2) : 1;
  }
  session = await ort.InferenceSession.create(m.modelUrl, { executionProviders: m.providers, graphOptimizationLevel: "all" });
  sessionKey = key;
  return session;
}

self.onmessage = async ({ data: m }) => {
  if (m.type === "cancel") { cancelled.add(m.id); return; }
  try {
    if (m.type === "instant") {
      // The whole upscale happens here: the source pixels go in, the finished
      // image comes out. Doing it in the worker (and in bands) is what keeps
      // 8K inside a sane memory budget.
      const src = new Uint8ClampedArray(m.src);
      const radius = sharpenRadius(m.srcWidth, m.outWidth);
      const px = enhanceLanczos(src, m.srcWidth, m.srcHeight, m.outWidth, m.outHeight, {
        amount: m.detail * 1.0,
        radius,
        band: m.outWidth * m.outHeight > 20e6 ? 24 : 48,
        onProgress: (v) => send({ id: m.id, type: "progress", stage: "Upscaling", value: 0.05 + v * 0.85 }),
        isCancelled: () => cancelled.has(m.id),
      });
      if (m.lut && m.toneAmount > 0) applyLut(px, m.lut, m.toneAmount);
      send({ id: m.id, type: "done", pixels: px.buffer, width: m.outWidth, height: m.outHeight }, [px.buffer]);
    } else if (m.type === "lumionet") {
      const sess = await getSession(m);
      const src = new Uint8ClampedArray(m.src);
      const t0 = performance.now();
      const out = await tiledInfer({
        rgba: src, w: m.srcWidth, h: m.srcHeight, scale: m.scale, tile: m.tile, pad: m.pad,
        isCancelled: () => cancelled.has(m.id),
        onProgress: (v) => send({ id: m.id, type: "progress", stage: "Enhancing", value: v, elapsed: performance.now() - t0 }),
        run: async (data, dims) => {
          const res = await sess.run({ input: new ort.Tensor("float32", data, dims) });
          return { data: res.output.data };
        },
      });
      if (m.strength < 0.999) {
        // The honest fallback: a full Lanczos upscale of the same photo, in
        // bands so 8K still fits in memory. Sliding between the two gives the
        // user "AI strength" from plain resampling to full model output.
        const ow = m.srcWidth * m.scale, oh = m.srcHeight * m.scale;
        const base = enhanceLanczos(src, m.srcWidth, m.srcHeight, ow, oh, {
          amount: 0, radius: 1, band: ow * oh > 20e6 ? 24 : 48,
          isCancelled: () => cancelled.has(m.id),
        });
        blendToward(out, base, m.strength);
      }
      if (m.lut && m.toneAmount > 0) applyLut(out, m.lut, m.toneAmount);
      const ow = m.srcWidth * m.scale, oh = m.srcHeight * m.scale;
      if (m.outWidth && (m.outWidth !== ow || m.outHeight !== oh)) {
        // Land on the size the user asked for with the good kernel, not the
        // canvas' bilinear one.
        const final = enhanceLanczos(out, ow, oh, m.outWidth, m.outHeight, {
          amount: 0, radius: 1, band: m.outWidth * m.outHeight > 20e6 ? 24 : 48,
          isCancelled: () => cancelled.has(m.id),
        });
        send({ id: m.id, type: "done", pixels: final.buffer, width: m.outWidth, height: m.outHeight }, [final.buffer]);
        return;
      }
      send({ id: m.id, type: "done", pixels: out.buffer, width: ow, height: oh }, [out.buffer]);
    }
  } catch (err) {
    send({ id: m.id, type: "error", cancelled: err instanceof Cancelled || err?.name === "Cancelled", message: String(err?.message || err) });
  } finally {
    cancelled.delete(m.id);
  }
};
