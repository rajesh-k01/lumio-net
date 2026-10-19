// The real check: run the exported toy LumioNet through the JavaScript tiler with ONNX Runtime Web
// and compare with the canonical Python run_tiled() output (fixtures/parity.json).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { tiledInfer } from "../../site/js/engines/tiled.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const fx = JSON.parse(fs.readFileSync(path.join(here, "../fixtures/parity.json"), "utf8"));
const modelBytes = fs.readFileSync(path.join(here, "../fixtures/toy_small_x2.onnx"));

const ort = await import("onnxruntime-web");
ort.env.wasm.numThreads = 1;
const session = await ort.InferenceSession.create(new Uint8Array(modelBytes), { executionProviders: ["wasm"] });
const run = async (data, dims) => ({ data: (await session.run({ input: new ort.Tensor("float32", data, dims) })).output.data });

for (const [name, c] of Object.entries(fx.cases)) {
  test(`JS tiler + ONNX Runtime matches Python run_tiled (${name}: tile ${c.tile}, pad ${c.pad})`, async () => {
    const out = await tiledInfer({ rgba: Uint8ClampedArray.from(fx.input), w: fx.w, h: fx.h, scale: fx.scale, tile: c.tile, pad: c.pad, run });
    assert.equal(out.length, c.rgba.length);
    let worst = 0, off = 0;
    for (let i = 0; i < out.length; i++) { const d = Math.abs(out[i] - c.rgba[i]); worst = Math.max(worst, d); if (d > 1) off++; }
    assert.ok(worst <= 1, `worst diff ${worst} levels, ${off} values off by more than 1`);
  });
}
