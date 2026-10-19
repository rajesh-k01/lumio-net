#!/usr/bin/env python3
"""Build a low/high resolution training set from a folder of photos.

    python3 dev/training/prepare_dataset.py ~/photos --out data/train --size 256 --scale 2

Every photo is cropped into HR patches, and each patch gets a matching LR
patch made the way a bad photo actually arrives: bicubic downscale, then JPEG
compression, then a little sensor noise. Training on clean bicubic pairs
teaches the network to sharpen nothing; training on real degradations is what
makes the result look like a photograph.

Output: data/train/hr/*.png and data/train/lr/*.png, same names.
"""
import argparse
import os
import random

import numpy as np
from PIL import Image

IMG_EXT = {".jpg", ".jpeg", ".png", ".webp", ".bmp", ".tif", ".tiff"}


def collect(folder):
    out = []
    for root, _, files in os.walk(folder):
        for f in files:
            if os.path.splitext(f)[1].lower() in IMG_EXT:
                out.append(os.path.join(root, f))
    return sorted(out)


def degrade(hr: Image.Image, scale: int, quality: int, noise: float, rng) -> Image.Image:
    """Make the 'low quality' version the network has to fix."""
    w, h = hr.size
    lw, lh = max(1, w // scale), max(1, h // scale)
    lr = hr.resize((lw, lh), Image.BICUBIC)
    if noise > 0:
        arr = np.asarray(lr).astype(np.float32)
        arr += rng.normal(0, noise * 255.0, arr.shape)
        lr = Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8))
    lr.save("/tmp/_lumio_lr.jpg", quality=quality)
    return Image.open("/tmp/_lumio_lr.jpg").convert("RGB")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("folder", help="folder with your photos")
    ap.add_argument("--out", default="data/train")
    ap.add_argument("--size", type=int, default=256, help="HR patch size")
    ap.add_argument("--scale", type=int, default=2, help="downscale factor")
    ap.add_argument("--patches", type=int, default=24, help="patches per photo")
    ap.add_argument("--quality", type=int, default=60, help="JPEG quality of the LR patch")
    ap.add_argument("--noise", type=float, default=0.0, help="sensor noise on the LR patch (0..0.1)")
    ap.add_argument("--seed", type=int, default=0)
    args = ap.parse_args()

    rng = np.random.default_rng(args.seed)
    py = random.Random(args.seed)

    files = collect(args.folder)
    if not files:
        raise SystemExit(f"no images found in {args.folder}")
    hr_dir = os.path.join(args.out, "hr")
    lr_dir = os.path.join(args.out, "lr")
    os.makedirs(hr_dir, exist_ok=True)
    os.makedirs(lr_dir, exist_ok=True)

    n = 0
    for path in files:
        try:
            im = Image.open(path).convert("RGB")
        except Exception:
            continue
        if min(im.size) < args.size:
            continue
        for i in range(args.patches):
            s = args.size
            x = py.randint(0, im.width - s)
            y = py.randint(0, im.height - s)
            hr = im.crop((x, y, x + s, y + s))
            lr = degrade(hr, args.scale, args.quality, args.noise, rng)
            name = f"{os.path.splitext(os.path.basename(path))[0]}_{i:03d}.png"
            hr.save(os.path.join(hr_dir, name))
            lr.save(os.path.join(lr_dir, name))
            n += 1
        print(f"  {os.path.basename(path)} -> {args.patches} patches")

    print(f"\n{n} patch pairs written to {args.out}")
    print("Next: python3 dev/training/train.py --data data/train --out models/lumionet-x2.onnx")


if __name__ == "__main__":
    main()
