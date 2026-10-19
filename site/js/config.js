// Site settings. Edit this file, nothing else needs to change.
export default {
  // Optional server engine. null = off. "" = same origin. "https://api.example.com" = another host.
  // The server must provide POST /api/enhance and GET /api/health (see README).
  apiBase: null,

  // Trained LumioNet models for the in-browser AI engine. See models/README.md.
  modelsIndex: "models/models.json",

  // ONNX Runtime Web, loaded only when the LumioNet engine is used.
  // For GPU speed use ort.webgpu.min.mjs and providers: ["webgpu", "wasm"].
  ortUrl: "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.30.0/dist/ort.wasm.min.mjs",
  providers: ["wasm"],

  // Tiled inference: tile edge in input pixels, and context pixels added around each tile.
  tile: 128,
  pad: 24,

  // Limits that keep phones from running out of memory.
  maxInputLongSide: 6000,    // larger photos are scaled down on load
  maxBrowserLongSide: 7680,  // largest output the in-browser engines will make (8K)
};
