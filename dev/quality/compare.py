"""Compare an enhanced image with a reference photo: sharpness + PSNR + SSIM.

    python3 dev/quality/compare.py reference.jpg input.jpg enhanced.jpg
"""
import sys, math
import numpy as np
from PIL import Image


def luma(img):
    a = np.asarray(img.convert("RGB"), dtype=np.float32)
    return 0.299 * a[..., 0] + 0.587 * a[..., 1] + 0.114 * a[..., 2]


def laplacian_var(img):
    g = luma(img)
    k = np.array([[0, 1, 0], [1, -4, 1], [0, 1, 0]], dtype=np.float32)
    h, w = g.shape
    p = np.pad(g, 1, mode="reflect")
    out = np.zeros_like(g)
    for dy in range(3):
        for dx in range(3):
            if k[dy, dx]:
                out += k[dy, dx] * p[dy:dy + h, dx:dx + w]
    return float(out.var())


def psnr(a, b):
    mse = float(np.mean((luma(a) - luma(b)) ** 2))
    if mse <= 1e-9:
        return 99.0
    return 10 * math.log10(255.0 * 255.0 / mse)


def ssim(a, b, win=7):
    """Mean SSIM with a box window (no SciPy needed)."""
    x, y = luma(a), luma(b)
    h, w = x.shape
    win = max(3, min(win, h // 8, w // 8))
    C1, C2 = (0.01 * 255) ** 2, (0.03 * 255) ** 2
    k = np.ones((win, win), dtype=np.float32) / (win * win)

    def filt(img):
        p = np.pad(img, ((win // 2, win // 2), (win // 2, win // 2)), mode="reflect")
        out = np.zeros_like(img)
        for dy in range(win):
            for dx in range(win):
                out += k[dy, dx] * p[dy:dy + h, dx:dx + w]
        return out

    mx, my = filt(x), filt(y)
    mxx, myy, mxy = filt(x * x), filt(y * y), filt(x * y)
    vx = np.maximum(mxx - mx * mx, 0)
    vy = np.maximum(myy - my * my, 0)
    cov = mxy - mx * my
    s = ((2 * mx * my + C1) * (2 * cov + C2)) / ((mx * mx + my * my + C1) * (vx + vy + C2))
    return float(s.mean())


def load(path, size=None):
    im = Image.open(path).convert("RGB")
    if size:
        im = im.resize(size, Image.LANCZOS)
    return im


def sharpness_at(img, size):
    """Laplacian variance measured at a fixed resolution.

    Comparing sharpness across different pixel sizes is meaningless: a bigger
    image spreads the same detail over more pixels, so the per-pixel gradient
    drops. Always measure at the same size.
    """
    return laplacian_var(img.resize(size, Image.LANCZOS))


def main():
    ref_path, in_path, out_path = sys.argv[1:4]
    ref = Image.open(ref_path).convert("RGB")
    inp = Image.open(in_path).convert("RGB")
    out = Image.open(out_path).convert("RGB")
    W, H = ref.size

    # Everything is compared at the reference's resolution.
    out_r = out.resize((W, H), Image.LANCZOS)
    in_r = inp.resize((W, H), Image.BICUBIC)

    print(f"reference   : {W} x {H}")
    print(f"input       : {inp.width} x {inp.height}")
    print(f"enhanced    : {out.width} x {out.height}")
    print()
    print(f"sharpness (Laplacian variance, all measured at {W}x{H})")
    print(f"  input      : {sharpness_at(inp, (W, H)):10.1f}")
    print(f"  enhanced   : {sharpness_at(out, (W, H)):10.1f}")
    print(f"  reference  : {sharpness_at(ref, (W, H)):10.1f}")
    print()
    print("similarity to the reference (at reference resolution)")
    print(f"  input (bicubic) : PSNR {psnr(in_r, ref):6.2f} dB   SSIM {ssim(in_r, ref):.4f}")
    print(f"  enhanced        : PSNR {psnr(out_r, ref):6.2f} dB   SSIM {ssim(out_r, ref):.4f}")


if __name__ == "__main__":
    main()
