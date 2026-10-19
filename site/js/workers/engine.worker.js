// Runs the heavy pixel work off the main thread so the page's animations never stall.
// Messages in:  { id, type: "instant" | "lumionet" | "cancel", ... }
// Messages out: { id, type: "progress" | "done" | "error", ... }

import { sharpenLuma, sharpenRadius } from "../engines/instant-core.js";
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
      const px = new Uint8ClampedArray(m.pixels);
      if (m.detail > 0) {
        send({ id: m.id, type: "progress", stage: "Sharpening", value: 0.05 });
        sharpenLuma(px, m.width, m.height, m.detail * 1.1, sharpenRadius(m.srcWidth, m.width),
          (v) => send({ id: m.id, type: "progress", stage: "Sharpening", value: 0.05 + v * 0.85 }));
      }
      if (m.lut && m.toneAmount > 0) applyLut(px, m.lut, m.toneAmount);
      send({ id: m.id, type: "done", pixels: px.buffer, width: m.width, height: m.height }, [px.buffer]);
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
      if (m.base && m.strength < 0.999) blendToward(out, new Uint8ClampedArray(m.base), m.strength);
      if (m.lut && m.toneAmount > 0) applyLut(out, m.lut, m.toneAmount);
      send({ id: m.id, type: "done", pixels: out.buffer, width: m.srcWidth * m.scale, height: m.srcHeight * m.scale }, [out.buffer]);
    }
  } catch (err) {
    send({ id: m.id, type: "error", cancelled: err instanceof Cancelled || err?.name === "Cancelled", message: String(err?.message || err) });
  } finally {
    cancelled.delete(m.id);
  }
};
