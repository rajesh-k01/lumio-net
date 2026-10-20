"""Evaluate a trained ONNX model against the plain Lanczos upscale.

    python3 dev/quality/eval_model.py model.onnx reference.jpg [degraded_input.jpg]

Builds the test pair from the reference itself (so the ground truth is known),
runs both the model and the Lanczos path, and reports sharpness / PSNR / SSIM
plus a side-by-side crop.
"""
import os
import sys

import numpy as np
from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from compare import laplacian_var, psnr, ssim  # noqa: E402

import onnxruntime as ort  # noqa: E402


def to_planar(img):
    a = np.asarray(img.convert("RGB"), dtype=np.float32) / 255.0
    return np.transpose(a, (2, 0, 1))[None]


def to_image(t):
    a = np.transpose(t[0], (1, 2, 0))
    return Image.fromarray(np.clip(a * 255.0, 0, 255).astype(np.uint8))


def model_scale(sess, probe=32):
    """Read the model's scale factor from its output shape."""
    t = sess.run(None, {sess.get_inputs()[0].name: np.zeros((1, 3, probe, probe), dtype=np.float32)})[0]
    return t.shape[2] // probe


def run_model(path, img, tile=128, pad=16, scale=2):
    sess = ort.InferenceSession(path, providers=["CPUExecutionProvider"])
    inp = sess.get_inputs()[0]
    src = np.asarray(img.convert("RGB"), dtype=np.uint8)
    H, W = src.shape[:2]
    out = np.zeros((H * scale, W * scale, 3), dtype=np.float32)
    srcf = src.astype(np.float32) / 255.0
    for y0 in range(0, H, tile):
        th = min(tile, H - y0)
        for x0 in range(0, W, tile):
            tw = min(tile, W - x0)
            # reflect pad, like the app does
            yp0, yp1 = max(0, y0 - pad), min(H, y0 + th + pad)
            xp0, xp1 = max(0, x0 - pad), min(W, x0 + tw + pad)
            patch = srcf[yp0:yp1, xp0:xp1]
            ph, pw = patch.shape[:2]
            t = np.transpose(patch, (2, 0, 1))[None]
            res = sess.run(None, {inp.name: t})[0][0]
            # crop the padded border back off
            oy = (y0 - yp0) * scale
            ox = (x0 - xp0) * scale
            out[y0 * scale:(y0 + th) * scale, x0 * scale:(x0 + tw) * scale] = np.transpose(
                res[:, oy:oy + th * scale, ox:ox + tw * scale], (1, 2, 0))
    return Image.fromarray(np.clip(out * 255.0, 0, 255).astype(np.uint8))


def lanczos(img, scale=2):
    return img.resize((img.width * scale, img.height * scale), Image.LANCZOS)


def main():
    model_path, ref_path = sys.argv[1], sys.argv[2]
    ref = Image.open(ref_path).convert("RGB")
    sess = ort.InferenceSession(model_path, providers=["CPUExecutionProvider"])
    scale = model_scale(sess)
    print(f"model scale : x{scale}")
    # ground truth at the model's output size
    target = ref.resize((ref.width // scale, ref.height // scale), Image.LANCZOS)
    target = target.crop((0, 0, target.width - target.width % 2, target.height - target.height % 2))
    # the degraded input the model will see
    lr = target.resize((target.width // scale, target.height // scale), Image.BICUBIC)
    lr.save("/tmp/_eval_lr.jpg", quality=70)
    lr = Image.open("/tmp/_eval_lr.jpg").convert("RGB")

    print(f"reference   : {ref.size}")
    print(f"target (2x) : {target.size}")
    print(f"input       : {lr.size}  (the degraded photo the model receives)")
    print()

    ai = run_model(model_path, lr, scale=scale)
    lz = lanczos(lr, scale)

    rows = [("AI model", ai), ("Lanczos", lz)]
    print(f"{'method':10} | {'sharpness':>10} {'PSNR':>8} {'SSIM':>7}")
    print("-" * 42)
    for name, im in rows:
        sh = laplacian_var(im)
        p = psnr(im, target)
        s = ssim(im, target)
        print(f"{name:10} | {sh:10.1f} {p:7.2f} {s:7.4f}")
    print(f"{'target':10} | {laplacian_var(target):10.1f}")
    print(f"{'input':10} | {laplacian_var(lr):10.1f}  (at input size)")

    # side-by-side crop
    W, H = target.size
    box = (int(W * 0.235), int(H * 0.345), int(W * 0.395), int(H * 0.395))  # the lanyard text
    labels = [("input", lr), ("Lanczos", lz), ("AI model", ai), ("target", target)]
    cw, ch = box[2] - box[0], box[3] - box[1]
    sheet = Image.new("RGB", (cw, (ch + 10) * len(labels)), "white")
    for i, (n, im) in enumerate(labels):
        # every panel is shown at the target's scale
        k = im.width / target.width
        b = (int(box[0] * k), int(box[1] * k), int(box[2] * k), int(box[3] * k))
        sheet.paste(im.crop(b), (0, i * (ch + 10)))
    out_png = os.path.join(os.path.dirname(os.path.abspath(__file__)), "model_vs_lanczos.png")
    sheet.save(out_png)
    print(f"\ncrop written: {out_png}")


if __name__ == "__main__":
    main()
