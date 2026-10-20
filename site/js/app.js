import config from "./config.js";
import { $, clamp, tween, reducedMotion, safeStorage, formatBytes, nextFrame } from "./util.js";
import { PRESETS, targetSize } from "./engines/instant-core.js";
import { serverHealth, serverEnhance } from "./engines/server.js";
import { fitLut, mergeLut, isValidProfile } from "./tone.js";
import { resolve, stopResolve } from "./resolve.js";
import { makeSample } from "./sample.js";
import { toast, moveBar, paintRange, drawCurves } from "./ui.js";

const store = safeStorage();
const ws = $("workspace"), viewer = $("viewer"), before = $("before"), after = $("after");
const S = {
  src: null, name: "photo", file: null, img: null,       // source canvas, file name, original File (server), drawn bitmap
  out: null, blob: null, outUrl: null,                    // result canvas / blob / object URL
  engine: "instant", preset: "hd", fmt: "jpeg",
  profile: null, models: [], serverOk: false,
  job: 0, busy: false, cancel: null, shown: [0, 0],
};

/* ---------- worker plumbing ---------- */
const worker = new Worker(new URL("./workers/engine.worker.js", import.meta.url), { type: "module" });
const waiting = new Map();
worker.onmessage = ({ data: m }) => waiting.get(m.id)?.(m);
function callWorker(msg, transfer, onProgress) {
  return new Promise((res, rej) => {
    waiting.set(msg.id, (m) => {
      if (m.type === "progress") return onProgress?.(m);
      waiting.delete(msg.id);
      m.type === "done" ? res(m) : rej(Object.assign(new Error(m.message), { cancelled: m.cancelled }));
    });
    worker.postMessage(msg, transfer);
  });
}
const abs = (u) => new URL(u, location.href).href;

/* ---------- canvases ---------- */
function sizeCanvases() {
  const ar = S.src.width / S.src.height;
  viewer.style.setProperty("--ar", ar);
  const cw = clamp(Math.round(viewer.clientWidth * Math.min(devicePixelRatio || 1, 2)), 200, 1800);
  const ch = Math.round(cw / ar);
  for (const c of [before, after]) if (c.width !== cw || c.height !== ch) { c.width = cw; c.height = ch; }
}
function paint(canvas, source) {
  const g = canvas.getContext("2d");
  g.imageSmoothingQuality = "high";
  g.drawImage(source, 0, 0, canvas.width, canvas.height);
}
function setCut(pct) {
  viewer.style.setProperty("--cut", `${pct}%`); viewer.style.setProperty("--x", `${pct}%`);
  $("handle").setAttribute("aria-valuenow", String(Math.round(pct)));
}
new ResizeObserver(() => {
  if (!S.src || S.busy) return;
  sizeCanvases(); paint(before, S.src); if (S.out) paint(after, S.out);
}).observe(viewer);

/* ---------- opening a photo ---------- */
async function decode(file) {
  let bmp;
  try { bmp = await createImageBitmap(file, { imageOrientation: "from-image" }); }
  catch { throw new Error(`Couldn't open “${file.name}”. Try a JPEG, PNG or WebP photo.`); }
  const long = Math.max(bmp.width, bmp.height), k = long > config.maxInputLongSide ? config.maxInputLongSide / long : 1;
  const c = document.createElement("canvas");
  c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
  const g = c.getContext("2d"); g.imageSmoothingQuality = "high"; g.drawImage(bmp, 0, 0, c.width, c.height);
  bmp.close?.();
  return { canvas: c, resized: k < 1 };
}

async function showSource(canvas, name, file, label) {
  if (S.busy) cancelJob();
  if (S.src && ws.dataset.state !== "idle") ws.dataset.state = "idle";
  if (S.src && S.img && !reducedMotion()) { await resolve(before, S.img, { reverse: true, duration: 320 }); }
  S.src = canvas; S.img = canvas; S.name = name; S.file = file; clearResult();
  await nextFrame();
  sizeCanvases(); setCut(100);
  $("meta").textContent = `${label} · ${canvas.width} × ${canvas.height}`;
  updateSize();
  resolve(before, canvas, { duration: 950 });
}
function clearResult() {
  S.out = null; S.blob = null;
  if (S.outUrl) { URL.revokeObjectURL(S.outUrl); S.outUrl = null; }
  $("download").hidden = true; ws.dataset.state = "idle"; $("eta").textContent = "";
  after.getContext("2d").clearRect(0, 0, after.width, after.height);
}
async function openFile(file) {
  if (!file) return;
  if (!file.type.startsWith("image/")) return toast("That isn’t a photo. Choose a JPEG, PNG or WebP image.", "error");
  try {
    const { canvas, resized } = await decode(file);
    await showSource(canvas, file.name.replace(/\.[^.]+$/, "") || "photo", resized ? null : file, `${file.name} (${formatBytes(file.size)})`);
    if (resized) toast(`Large photo scaled down to ${canvas.width} × ${canvas.height} to keep your browser responsive.`);
  } catch (e) { toast(e.message, "error"); }
}
$("file").addEventListener("change", (e) => { openFile(e.target.files[0]); e.target.value = ""; });

let dragDepth = 0;
addEventListener("dragenter", (e) => { if ([...(e.dataTransfer?.types || [])].includes("Files")) { dragDepth++; document.body.classList.add("dragging"); } });
addEventListener("dragleave", () => { dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) document.body.classList.remove("dragging"); });
addEventListener("dragover", (e) => e.preventDefault());
addEventListener("drop", (e) => { e.preventDefault(); dragDepth = 0; document.body.classList.remove("dragging"); openFile(e.dataTransfer?.files?.[0]); });

/* ---------- size readout ---------- */
function outputSize() {
  const [w, h] = targetSize(S.src.width, S.src.height, S.preset);
  if (S.engine === "server") return [w, h];
  const long = Math.max(w, h), cap = config.maxBrowserLongSide;
  return long > cap ? [Math.round((w * cap) / long), Math.round((h * cap) / long)] : [w, h];
}
function updateSize() {
  const [w, h] = outputSize(), [pw, ph] = S.shown;
  S.shown = [w, h];
  const out = $("sizeOut");
  tween(0, 1, 450, (t) => { out.textContent = `${Math.round(pw + (w - pw) * t)} × ${Math.round(ph + (h - ph) * t)}`; });
}

/* ---------- segmented controls and engine list ---------- */
function layoutBars() {
  moveBar($("engines"), document.querySelector(".engine:has(input:checked)"), true);
  moveBar($("sizeSeg"), document.querySelector('#sizeSeg [aria-checked="true"]'));
  moveBar($("fmtSeg"), document.querySelector('#fmtSeg [aria-checked="true"]'));
}
function chooseSeg(seg, btn) {
  seg.querySelectorAll("button").forEach((b) => b.setAttribute("aria-checked", String(b === btn)));
  layoutBars();
}
$("sizeSeg").addEventListener("click", (e) => {
  const b = e.target.closest("button"); if (!b || b.disabled) return;
  S.preset = b.dataset.preset; chooseSeg($("sizeSeg"), b); updateSize();
});
$("fmtSeg").addEventListener("click", (e) => {
  const b = e.target.closest("button"); if (!b) return;
  S.fmt = b.dataset.fmt; chooseSeg($("fmtSeg"), b);
});
document.querySelectorAll('input[name="engine"]').forEach((r) => r.addEventListener("change", () => {
  S.engine = r.value; syncEngineUI(); layoutBars(); updateSize();
}));
function syncEngineUI() {
  const b8 = document.querySelector('#sizeSeg [data-preset="8k"]');
  // 8K runs in the browser now: the worker resamples in bands, so the memory
  // stays bounded. The server engine is still the way past 8K.
  b8.disabled = false;
  b8.title = "8K — heavy on memory, give it a moment";
  $("l-detail").firstElementChild.textContent = S.engine === "instant" ? "Detail" : "AI strength";
}
$("detail").addEventListener("input", (e) => { paintRange(e.target); $("detailVal").textContent = e.target.value; });
$("toneAmt").addEventListener("input", (e) => { paintRange(e.target); $("toneAmtVal").textContent = e.target.value; });
$("toneSel").addEventListener("change", () => { $("toneAmtWrap").hidden = $("toneSel").value === "none"; });
paintRange($("detail")); paintRange($("toneAmt"));

/* ---------- tone profile ---------- */
function loadProfile() {
  try { const p = JSON.parse(store.get("lumio.profile")); if (isValidProfile(p)) S.profile = p; } catch { /* none saved */ }
  syncProfileUI();
}
function syncProfileUI() {
  const sel = $("toneSel"), had = sel.value;
  sel.querySelectorAll("option[value=mine]").forEach((o) => o.remove());
  if (S.profile) sel.add(new Option(`My profile (${S.profile.pairs} ${S.profile.pairs === 1 ? "pair" : "pairs"})`, "mine"));
  sel.value = had === "mine" && S.profile ? "mine" : "none";
  $("toneAmtWrap").hidden = sel.value === "none";
  $("delProfile").hidden = !S.profile;
  if (S.profile) drawCurves(S.profile.lut); else $("curve").setAttribute("hidden", "");
}
$("toneSel").addEventListener("change", (e) => { e.target.dataset.touched = "1"; });
const refs = { A: null, B: null };
for (const k of ["A", "B"]) $(`ref${k}`).addEventListener("change", (e) => {
  const f = e.target.files[0]; refs[k] = f || null;
  const slot = $(`slot${k}`); slot.classList.toggle("filled", !!f); slot.querySelector("em").textContent = f ? f.name : "Choose file";
  $("learnBtn").disabled = !(refs.A && refs.B);
});
async function pixels(file) {
  const { canvas } = await decode(file);
  const k = Math.min(1, 512 / Math.max(canvas.width, canvas.height));
  const c = document.createElement("canvas"); c.width = Math.max(1, Math.round(canvas.width * k)); c.height = Math.max(1, Math.round(canvas.height * k));
  c.getContext("2d").drawImage(canvas, 0, 0, c.width, c.height);
  return c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
}
$("learnBtn").addEventListener("click", async () => {
  try {
    const lut = fitLut(await pixels(refs.A), await pixels(refs.B));
    if ($("merge").checked && S.profile) S.profile = { lut: mergeLut(S.profile.lut, S.profile.pairs, lut), pairs: S.profile.pairs + 1 };
    else S.profile = { lut, pairs: 1 };
    store.set("lumio.profile", JSON.stringify(S.profile));
    $("toneSel").dataset.touched = "1"; syncProfileUI(); $("toneSel").value = "mine"; $("toneAmtWrap").hidden = false;
    toast("Look learned. It will be applied to your next Enhance.");
  } catch (e) { toast(e.message, "error"); }
});
$("delProfile").addEventListener("click", () => {
  S.profile = null; store.set("lumio.profile", null); $("toneSel").value = "none"; syncProfileUI(); toast("Profile deleted.");
});

/* ---------- compare slider ---------- */
(() => {
  let drag = false;
  const at = (e) => { const r = viewer.getBoundingClientRect(); setCut(clamp(((e.clientX - r.left) / r.width) * 100, 0, 100)); };
  viewer.addEventListener("pointerdown", (e) => { if (ws.dataset.state !== "done") return; drag = true; viewer.setPointerCapture(e.pointerId); at(e); });
  viewer.addEventListener("pointermove", (e) => drag && at(e));
  viewer.addEventListener("pointerup", () => (drag = false));
  $("handle").addEventListener("keydown", (e) => {
    const cur = parseFloat(viewer.style.getPropertyValue("--cut")) || 50, step = e.shiftKey ? 10 : 2;
    if (e.key === "ArrowLeft") setCut(clamp(cur - step, 0, 100)); else if (e.key === "ArrowRight") setCut(clamp(cur + step, 0, 100));
    else if (e.key === "Home") setCut(0); else if (e.key === "End") setCut(100); else return;
    e.preventDefault();
  });
})();

/* ---------- enhancing ---------- */
const go = $("go");
function setProgress(v, text) {
  go.style.setProperty("--prog", String(clamp(v, 0, 1)));
  $("goText").textContent = `Cancel · ${Math.round(clamp(v, 0, 1) * 100)}%`;
  if (text) $("eta").textContent = text;
}
function cancelJob() {
  const id = S.job; S.job++;
  worker.postMessage({ id, type: "cancel" }); S.cancel?.abort(); S.cancel = null;
  endBusy(); $("eta").textContent = "Cancelled.";
}
function endBusy() {
  S.busy = false; go.classList.remove("busy"); go.style.setProperty("--prog", "0"); $("goText").textContent = "Enhance";
  ws.dataset.state = S.out ? "done" : "idle";
}
function scaled(src, w, h) {
  if (src.width === w && src.height === h) return src;
  const c = document.createElement("canvas"); c.width = w; c.height = h;
  const g = c.getContext("2d"); g.imageSmoothingQuality = "high"; g.drawImage(src, 0, 0, w, h); return c;
}
const eta = (stage, value, elapsed) => {
  if (value > 0.08 && elapsed) { const left = Math.max(0, (elapsed / value) * (1 - value) / 1000); return `${stage} · about ${left < 90 ? `${Math.ceil(left)} s` : `${Math.ceil(left / 60)} min`} left`; }
  return `${stage}…`;
};
function toneArgs() {
  const on = $("toneSel").value === "mine" && S.profile;
  return { lut: on ? S.profile.lut : null, toneAmount: on ? $("toneAmt").value / 100 : 0 };
}

async function runInstant(id, [w, h]) {
  // The worker does the resample and the sharpen, band by band, so an 8K
  // result never needs the whole image in float buffers at once.
  const src = S.src.getContext("2d").getImageData(0, 0, S.src.width, S.src.height);
  const r = await callWorker({ id, type: "instant", src: src.data.buffer, srcWidth: S.src.width, srcHeight: S.src.height,
    outWidth: w, outHeight: h, detail: $("detail").value / 100, ...toneArgs() },
    [src.data.buffer], (m) => { setProgress(m.value, `${m.stage}…`); });
  const c = document.createElement("canvas"); c.width = r.width; c.height = r.height;
  c.getContext("2d").putImageData(new ImageData(new Uint8ClampedArray(r.pixels), r.width, r.height), 0, 0);
  return c;
}
async function runLumioNet(id, [w, h]) {
  const model = S.models[0], s = model.scale;
  let src = S.src;
  const long = Math.max(src.width, src.height) * s;
  if (long > config.maxBrowserLongSide) { const k = config.maxBrowserLongSide / long; src = scaled(src, Math.round(src.width * k), Math.round(src.height * k)); }
  const sw = src.width, sh = src.height;
  const srcPx = src.getContext("2d").getImageData(0, 0, sw, sh).data;
  const r = await callWorker({
    id, type: "lumionet", ortUrl: abs(config.ortUrl), modelUrl: abs(model.file), providers: config.providers,
    src: srcPx.buffer.slice(0), srcWidth: sw, srcHeight: sh, scale: s, tile: config.tile, pad: config.pad,
    outWidth: w, outHeight: h, strength: $("detail").value / 100, ...toneArgs(),
  }, [], (m) => setProgress(m.value * 0.97, eta(m.stage, m.value, m.elapsed)));
  const c = document.createElement("canvas"); c.width = r.width; c.height = r.height;
  c.getContext("2d").putImageData(new ImageData(new Uint8ClampedArray(r.pixels), r.width, r.height), 0, 0);
  return c;
}
async function runServer() {
  S.cancel = new AbortController();
  let file = S.file;
  if (!file) file = await new Promise((r) => S.src.toBlob(r, "image/png"));
  const res = await serverEnhance(config.apiBase, file, { preset: S.preset, strength: $("detail").value / 100, fmt: S.fmt },
    { signal: S.cancel.signal, onProgress: (v) => setProgress(v * 0.97, v < 0.3 ? "Uploading…" : "The server is enhancing your photo…") });
  const bmp = await createImageBitmap(res.blob);
  const c = document.createElement("canvas"); c.width = bmp.width; c.height = bmp.height; c.getContext("2d").drawImage(bmp, 0, 0);
  S.blob = res.blob; return c;
}

async function enhance() {
  if (S.busy) return cancelJob();
  if (S.engine === "lumionet" && !S.models.length) return toast("LumioNet needs a trained model. See models/README.md.", "error");
  const id = ++S.job, size = outputSize();
  warnIfHeavy(size);
  S.busy = true; clearResult(); ws.dataset.state = "busy"; go.classList.add("busy"); setProgress(0, "Starting…");
  const t0 = performance.now();
  try {
    const out = S.engine === "server" ? await runServer() : S.engine === "lumionet" ? await runLumioNet(id, size) : await runInstant(id, size);
    if (id !== S.job) return;
    S.out = out;
    if (!S.blob) S.blob = await new Promise((r) => out.toBlob(r, S.fmt === "png" ? "image/png" : "image/jpeg", 0.95));
    S.outUrl = URL.createObjectURL(S.blob);
    const dl = $("download"); dl.href = S.outUrl; dl.download = `${S.name}-lumio-${out.width}x${out.height}.${S.fmt === "png" ? "png" : "jpg"}`;
    dl.textContent = `Download ${formatBytes(S.blob.size)}`;
    S.busy = false; go.classList.remove("busy"); go.style.setProperty("--prog", "0"); $("goText").textContent = "Enhance again";
    ws.dataset.state = "done"; dl.hidden = false;
    $("meta").textContent = `${S.src.width} × ${S.src.height} → ${out.width} × ${out.height}`;
    $("eta").textContent = `Done in ${((performance.now() - t0) / 1000).toFixed(1)} s.`;
    sizeCanvases(); paint(before, S.src); setCut(0);
    await resolve(after, out, { duration: 1100 });
    if (id === S.job) tween(0, 50, 700, setCut);
  } catch (e) {
    if (id !== S.job) return;
    endBusy();
    if (e.cancelled || e.name === "Cancelled") $("eta").textContent = "Cancelled.";
    else { $("eta").textContent = ""; toast(friendly(e), "error", 7000); }
  }
}
/** Big outputs can eat a phone's memory. Warn before we start, not after. */
function warnIfHeavy([w, h]) {
  const px = w * h;
  if (px < 12e6) return;
  const mb = Math.round((px * 4 * 2.5) / 1e6);
  const device = navigator.deviceMemory || 4;
  if (device <= 4) {
    toast(`${w} × ${h} needs about ${mb} MB. This device may struggle — if it stalls, pick 4K.`, "info", 7000);
  } else {
    $("eta").textContent = `Big one: ${w} × ${h} (~${mb} MB). This takes a moment.`;
  }
}

function friendly(e) {
  const m = String(e.message || e);
  if (S.engine === "lumionet" && /fetch|import|network|Failed|load/i.test(m)) return `LumioNet couldn't load (${m}). Check the model file and the ONNX Runtime address in js/config.js.`;
  if (/memory|alloc/i.test(m)) return "Your browser ran out of memory. Try a smaller size or a smaller photo.";
  return m;
}
go.addEventListener("click", enhance);

/* ---------- palette ---------- */
function setPalette(name, animate) {
  const apply = () => {
    document.documentElement.dataset.palette = name;
    document.querySelectorAll(".swatches button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.palette === name)));
    document.querySelector('meta[name="theme-color"]').content = { cyanotype: "#0c2d57", daylight: "#f3efe6", darkroom: "#121214" }[name];
    store.set("lumio.palette", name);
  };
  animate && document.startViewTransition && !reducedMotion() ? document.startViewTransition(apply) : apply();
}
document.querySelector(".swatches").addEventListener("click", (e) => { const b = e.target.closest("button"); if (b) setPalette(b.dataset.palette, true); });
const savedPalette = store.get("lumio.palette"); if (["cyanotype", "daylight", "darkroom"].includes(savedPalette)) setPalette(savedPalette, false);

/* ---------- start-up ---------- */
async function discover() {
  try {
    const r = await fetch(config.modelsIndex, { cache: "no-cache" });
    if (r.ok) S.models = ((await r.json()).models || []).filter((m) => m.file && Number.isInteger(m.scale));
  } catch { /* no models folder: fine */ }
  if (S.models.length) { $("engineNet").hidden = false; $("netNote").textContent = `${S.models[0].name || "AI model"} · ${S.models[0].scale}× · runs in your browser.`; }
  if (config.apiBase !== null) {
    const h = await serverHealth(config.apiBase);
    if (h) { S.serverOk = true; $("engineSrv").hidden = false; $("srvNote").textContent = `${h.engine || "Server"} · strongest quality, uploads your photo.`; }
  }
  layoutBars();
}

(async () => {
  loadProfile();
  const sample = makeSample();
  await document.fonts?.ready;
  await showSource(sample, "sample", null, "Sample photo");
  layoutBars(); syncEngineUI();
  addEventListener("resize", layoutBars);
  discover();
})();

// Exposed for automated tests only; harmless in production.
window.__lumio = { S, enhance, openFile, setPalette };
