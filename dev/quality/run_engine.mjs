// Run the app's enhance pipeline on a raw RGBA file.
//   node run_engine.mjs in.raw srcW srcH out.raw outW outH amount radius
// Lets the quality scripts sweep parameters without a browser.
import { readFileSync, writeFileSync } from "node:fs";
import { enhanceLanczos } from "../../site/js/engines/resample.js";

const [, , inPath, srcW, srcH, outPath, outW, outH, amountArg, radiusArg] = process.argv;
const amount = Number(amountArg ?? 0.6), radius = Number(radiusArg ?? 2);
const src = new Uint8ClampedArray(readFileSync(inPath));
const out = enhanceLanczos(src, Number(srcW), Number(srcH), Number(outW), Number(outH), { amount, radius });
writeFileSync(outPath, Buffer.from(out.buffer));
