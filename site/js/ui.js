// Small UI helpers: toasts, sliding selection bars, range fill, tone-curve drawing.
import { $ } from "./util.js";

export function toast(message, kind = "info", ms = 4200) {
  const el = document.createElement("div");
  el.className = `toast ${kind}`;
  el.textContent = message;
  $("toasts").append(el);
  const kill = () => { el.classList.add("out"); setTimeout(() => el.remove(), 320); };
  setTimeout(kill, ms);
  el.addEventListener("click", kill);
}

/** Slide a .bar element behind `target`. vertical=true for the engine list. */
export function moveBar(container, target, vertical = false) {
  const bar = container.querySelector(".bar");
  if (!bar || !target) return;
  if (vertical) { bar.style.setProperty("--y", `${target.offsetTop}px`); bar.style.setProperty("--h", `${target.offsetHeight}px`); }
  else { bar.style.setProperty("--x", `${target.offsetLeft}px`); bar.style.setProperty("--w", `${target.offsetWidth}px`); }
}

/** Keep a range input's filled portion in step with its value. */
export function paintRange(input) {
  const p = ((input.value - input.min) / (input.max - input.min)) * 100;
  input.style.setProperty("--p", `${p}%`);
}

const pathFor = (ch) => ch.map((v, i) => `${i ? "L" : "M"}${((i / 255) * 120).toFixed(1)} ${(120 - (v / 255) * 120).toFixed(1)}`).join("");

/** Draw R, G, B curves of a profile LUT; the lines draw themselves in. */
export function drawCurves(lut) {
  const svg = $("curve");
  svg.removeAttribute("hidden");
  ["cR", "cG", "cB"].forEach((id, c) => {
    const p = $(id);
    p.setAttribute("d", pathFor(lut[c]));
    p.classList.remove("draw"); void p.getBoundingClientRect(); p.classList.add("draw");
  });
}
