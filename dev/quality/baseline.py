"""Baseline for the quality work: reproduce the old pipeline so the new one
can be measured against it.

The old app upscaled with the canvas' bilinear filter and then applied an
unsharp mask. This script does the same thing with PIL, so compare.py can
say "old vs new" on the same photo.

    python3 dev/quality/baseline.py input.jpg old_output.jpg
"""
import sys
import numpy as np
from PIL import Image, ImageFilter


def unsharp(img, amount=0.66, radius=2):
    """The old unsharp mask: blur, then add back the difference."""
    a = np.asarray(img.convert("RGB"), dtype=np.float32)
    blurred = np.asarray(img.convert("RGB").filter(ImageFilter.GaussianBlur(radius)), dtype=np.float32)
    diff = a - blurred
    # Soft threshold, same shape as the app's: no ringing on flat noise.
    d = diff * (np.abs(diff) / (np.abs(diff) + 3)) * amount
    return Image.fromarray(np.clip(a + d, 0, 255).astype(np.uint8))


def main():
    src, dst = sys.argv[1], sys.argv[2]
    im = Image.open(src).convert("RGB")
    long = max(im.size)
    scale = 3840 / long
    size = (round(im.width * scale), round(im.height * scale))
    # Canvas drawImage with imageSmoothingQuality = high is closest to
    # bilinear + a little smoothing.
    out = im.resize(size, Image.BILINEAR)
    out = unsharp(out)
    out.save(dst, quality=95)
    print(f"baseline written: {dst} {out.size}")


if __name__ == "__main__":
    main()
