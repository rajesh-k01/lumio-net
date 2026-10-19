"""Sweep sharpening settings for the Instant engine and score them.

    python3 dev/quality/sweep.py input.jpg reference.jpg [target_long_side]

Runs the real engine (site/js/engines/resample.js) over a range of
sharpening amounts and radii, and reports sharpness and fidelity against a
reference photo. Used to pick the defaults, not in production.
"""
import os
import subprocess
import sys
import tempfile

import numpy as np
from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from compare import laplacian_var, psnr, ssim  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
ENGINE = os.path.join(HERE, "run_engine.mjs")


def to_raw(img, path):
    arr = np.asarray(img.convert("RGB"), dtype=np.uint8)
    rgba = np.zeros((arr.shape[0], arr.shape[1], 4), dtype=np.uint8)
    rgba[..., :3] = arr
    rgba[..., 3] = 255
    rgba.tofile(path)
    return arr.shape[1], arr.shape[0]


def from_raw(path, w, h, out_path):
    arr = np.fromfile(path, dtype=np.uint8).reshape(h, w, 4)
    Image.fromarray(arr[..., :3]).save(out_path, quality=95)


def run(src_raw, sw, sh, ow, oh, amount, radius, tmp):
    out_raw = os.path.join(tmp, "out.raw")
    out_img = os.path.join(tmp, "out.jpg")
    subprocess.run(
        ["node", ENGINE, src_raw, str(sw), str(sh), out_raw, str(ow), str(oh), str(amount), str(radius)],
        check=True,
    )
    from_raw(out_raw, ow, oh, out_img)
    return Image.open(out_img).convert("RGB")


def main():
    inp = Image.open(sys.argv[1]).convert("RGB")
    ref = Image.open(sys.argv[2]).convert("RGB")
    target_long = int(sys.argv[3]) if len(sys.argv) > 3 else 3840
    W, H = ref.size

    scale = target_long / max(inp.size)
    ow, oh = round(inp.width * scale), round(inp.height * scale)

    with tempfile.TemporaryDirectory() as tmp:
        src_raw = os.path.join(tmp, "in.raw")
        sw, sh = to_raw(inp, src_raw)
        print(f"input {sw}x{sh} -> target {ow}x{oh} (scale {scale:.2f}x)")
        print(f"{'amount':>7} {'radius':>7} | {'sharpness':>10} {'PSNR':>8} {'SSIM':>7}")
        print("-" * 48)
        for amount in (0.3, 0.5, 0.7):
            for radius in (1, 2, 3):
                out = run(src_raw, sw, sh, ow, oh, amount, radius, tmp)
                half = (W // 2, H // 2)
                out_r = out.resize(half, Image.LANCZOS)
                ref_h = ref.resize(half, Image.LANCZOS)
                sh_a = laplacian_var(out_r)
                p = psnr(out_r, ref_h)
                s = ssim(out_r, ref_h)
                print(f"{amount:7.2f} {radius:7} | {sh_a:10.1f} {p:7.2f} {s:7.4f}")


if __name__ == "__main__":
    main()
