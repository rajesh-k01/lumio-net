// Optional server engine. Talks to any server that implements:
//   GET  {base}/api/health   -> { engine, seedvr2_ready?, presets, tone_profiles }
//   POST {base}/api/enhance  multipart: file, preset, strength (0..1), color_match, fmt
//                            -> image bytes, headers X-Engine and X-Output-Size

import { Cancelled } from "./tiled.js";

export async function serverHealth(base, timeoutMs = 4000) {
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), timeoutMs);
    const res = await fetch(`${base}/api/health`, { signal: ctl.signal });
    clearTimeout(t);
    return res.ok ? await res.json() : null;
  } catch { return null; }
}

/** Upload with progress. onProgress(0..1): upload fills 0..0.3, then it creeps while the server works. */
export function serverEnhance(base, file, { preset, strength, fmt }, { onProgress, signal } = {}) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const form = new FormData();
    form.append("file", file);
    form.append("preset", preset);
    form.append("strength", String(strength));
    form.append("color_match", "true");
    form.append("fmt", fmt);

    let creep = null, p = 0.3;
    const stop = () => creep && clearInterval(creep);
    xhr.open("POST", `${base}/api/enhance`);
    xhr.responseType = "blob";
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress?.((e.loaded / e.total) * 0.3);
    xhr.upload.onload = () => {
      creep = setInterval(() => { p += (0.95 - p) * 0.06; onProgress?.(p); }, 250);
    };
    xhr.onload = async () => {
      stop();
      if (xhr.status >= 200 && xhr.status < 300) {
        onProgress?.(1);
        resolve({ blob: xhr.response, engine: xhr.getResponseHeader("X-Engine") || "server", size: xhr.getResponseHeader("X-Output-Size") || "" });
      } else {
        let detail = `The server answered with an error (${xhr.status}).`;
        try { detail = JSON.parse(await xhr.response.text()).detail || detail; } catch { /* not JSON */ }
        reject(new Error(detail));
      }
    };
    xhr.onerror = () => { stop(); reject(new Error("Couldn't reach the server. Check your connection and the server address.")); };
    xhr.onabort = () => { stop(); reject(new Cancelled()); };
    signal?.addEventListener("abort", () => xhr.abort());
    xhr.send(form);
  });
}
