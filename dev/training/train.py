#!/usr/bin/env python3
"""Train the in-browser AI upscaler and export it as ONNX.

    python3 dev/training/train.py --photos ~/photos --out models/lumionet-x2.onnx --scale 2

The network is a compact EDSR-style residual net with a pixel-shuffle head.
It is deliberately small (~120k parameters) so it can run in a phone browser
through ONNX Runtime Web.

Two things matter for the result looking like a photograph instead of a
smooth blur:

* the network predicts the **residual** over a bicubic upsample, so it only
  has to learn the detail, not the whole image;
* the loss has a **gradient term**. A plain L1 loss is happy with a blurry
  average, which is exactly how a model trained on L1 ends up. Matching the
  gradients of the target is what forces edges, hair and fabric weave.

The exported file matches what the app expects exactly:
    input  float32 [1, 3, h, w]   RGB in 0..1
    output float32 [1, 3, s*h, s*w]

Needs: pip install torch onnx pillow numpy
A GPU is strongly recommended. On CPU it still runs, but expect it to crawl.
"""
import argparse
import os
import random
import time

import numpy as np
from PIL import Image

try:
    import torch
    import torch.nn as nn
    import torch.nn.functional as F
except ImportError:
    raise SystemExit("torch is not installed. Try: pip install torch")

IMG_EXT = {".jpg", ".jpeg", ".png", ".webp", ".bmp", ".tif", ".tiff"}
SOBEL_X = torch.tensor([[-1.0, 0.0, 1.0], [-2.0, 0.0, 2.0], [-1.0, 0.0, 1.0]]).view(1, 1, 3, 3)
SOBEL_Y = SOBEL_X.transpose(2, 3).contiguous()


class ResBlock(nn.Module):
    def __init__(self, ch=32):
        super().__init__()
        self.c1 = nn.Conv2d(ch, ch, 3, 1, 1)
        self.c2 = nn.Conv2d(ch, ch, 3, 1, 1)

    def forward(self, x):
        return x + self.c2(F.relu(self.c1(x)))


class Net(nn.Module):
    """Compact EDSR-style SR network with a pixel-shuffle head."""

    def __init__(self, ch=32, blocks=6, scale=2):
        super().__init__()
        self.scale = scale
        self.head = nn.Conv2d(3, ch, 3, 1, 1)
        self.body = nn.Sequential(*[ResBlock(ch) for _ in range(blocks)])
        self.body_tail = nn.Conv2d(ch, ch, 3, 1, 1)
        self.upsample = nn.Sequential(nn.Conv2d(ch, ch * scale * scale, 3, 1, 1), nn.PixelShuffle(scale))
        self.tail = nn.Conv2d(ch, 3, 3, 1, 1)

    def forward(self, x):
        base = F.interpolate(x, scale_factor=self.scale, mode="bicubic", align_corners=False)
        y = self.head(x)
        y = y + self.body_tail(self.body(y))
        y = self.upsample(y)
        return self.tail(y) + base


def build_patches(files, patch, scale, per_image, quality, noise, seed):
    """HR patches and their degraded LR counterparts, as float arrays in 0..1."""
    rng = np.random.default_rng(seed)
    py = random.Random(seed)
    hrs, lrs = [], []
    for path in files:
        try:
            im = Image.open(path).convert("RGB")
        except Exception:
            continue
        if min(im.size) < patch * scale + 4:
            continue
        for _ in range(per_image):
            x = py.randint(0, im.width - patch * scale)
            y = py.randint(0, im.height - patch * scale)
            hr = im.crop((x, y, x + patch * scale, y + patch * scale))
            lr = hr.resize((patch, patch), Image.BICUBIC)
            arr = np.asarray(lr, dtype=np.float32)
            if noise > 0:
                arr += rng.normal(0, noise * 255.0, arr.shape)
            lr = Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8))
            lr.save("/tmp/_lumio_lr.jpg", quality=quality)
            lr = Image.open("/tmp/_lumio_lr.jpg").convert("RGB")
            hrs.append(np.asarray(hr, dtype=np.float32) / 255.0)
            lrs.append(np.asarray(lr, dtype=np.float32) / 255.0)
    return (np.stack(lrs).transpose(0, 3, 1, 2).copy(),
            np.stack(hrs).transpose(0, 3, 1, 2).copy())


def gradient_loss(pred, target, sx, sy):
    """L1 on the gradients of the luminance. This is what keeps the output crisp."""
    def luma(x):
        return 0.299 * x[:, 0:1] + 0.587 * x[:, 1:2] + 0.114 * x[:, 2:3]
    p, t = luma(pred), luma(target)
    px = F.conv2d(p, sx, padding=1)
    tx = F.conv2d(t, sx, padding=1)
    py = F.conv2d(p, sy, padding=1)
    ty = F.conv2d(t, sy, padding=1)
    return (px - tx).abs().mean() + (py - ty).abs().mean()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--photos", default="", help="folder with photos (comma separated ok)")
    ap.add_argument("--extra", default="", help="extra image files to include")
    ap.add_argument("--out", default="models/lumionet-x2.onnx")
    ap.add_argument("--scale", type=int, default=2)
    ap.add_argument("--patch", type=int, default=48, help="LR patch size")
    ap.add_argument("--per-image", type=int, default=8)
    ap.add_argument("--quality", type=int, default=70, help="JPEG quality of the LR patch")
    ap.add_argument("--noise", type=float, default=0.0)
    ap.add_argument("--channels", type=int, default=32)
    ap.add_argument("--blocks", type=int, default=6)
    ap.add_argument("--iters", type=int, default=3000)
    ap.add_argument("--batch", type=int, default=16)
    ap.add_argument("--lr", type=float, default=2e-3)
    ap.add_argument("--grad-weight", type=float, default=1.0)
    ap.add_argument("--seed", type=int, default=0)
    args = ap.parse_args()

    torch.manual_seed(args.seed)
    random.seed(args.seed)
    np.random.seed(args.seed)
    torch.set_num_threads(max(1, (os.cpu_count() or 2)))
    device = "cuda" if torch.cuda.is_available() else "cpu"
    print(f"device: {device}", flush=True)

    files = []
    for folder in [f for f in args.photos.split(",") if f]:
        for root, _, names in os.walk(folder):
            for n in names:
                if os.path.splitext(n)[1].lower() in IMG_EXT:
                    files.append(os.path.join(root, n))
    for f in [f for f in args.extra.split(",") if f]:
        files.append(f)
    files = sorted(set(files))
    if not files:
        raise SystemExit("no photos found — pass --photos <folder>")
    print(f"{len(files)} source photos", flush=True)

    lrs, hrs = build_patches(files, args.patch, args.scale, args.per_image, args.quality, args.noise, args.seed)
    print(f"{len(lrs)} patch pairs ({args.patch}px LR -> {args.patch*args.scale}px HR)", flush=True)

    net = Net(args.channels, args.blocks, args.scale).to(device)
    print(f"model: {sum(p.numel() for p in net.parameters())/1e3:.1f}k parameters", flush=True)
    opt = torch.optim.AdamW(net.parameters(), lr=args.lr, weight_decay=1e-5)
    sched = torch.optim.lr_scheduler.CosineAnnealingLR(opt, T_max=args.iters)
    sx, sy = SOBEL_X.to(device), SOBEL_Y.to(device)

    t_l = torch.from_numpy(lrs)
    t_h = torch.from_numpy(hrs)
    n = len(t_l)
    best = float("inf")
    t0 = time.time()
    ckpt = os.path.splitext(args.out)[0] + ".pt"
    for it in range(args.iters):
        idx = torch.randint(0, n, (args.batch,))
        lr = t_l[idx].to(device)
        hr = t_h[idx].to(device)
        out = net(lr)
        loss_p = (out - hr).abs().mean()
        loss_g = gradient_loss(out, hr, sx, sy)
        loss = loss_p + args.grad_weight * loss_g
        opt.zero_grad()
        loss.backward()
        torch.nn.utils.clip_grad_norm_(net.parameters(), 1.0)
        opt.step()
        sched.step()
        if it % 100 == 0 or it == args.iters - 1:
            print(f"  iter {it:5d}  pixel {loss_p.item():.4f}  grad {loss_g.item():.4f}  "
                  f"total {loss.item():.4f}  ({time.time()-t0:.0f}s)", flush=True)
            best = min(best, loss.item())
        if it % 500 == 0 and it:
            torch.save({"model": net.state_dict(), "args": vars(args), "iter": it}, ckpt)

    os.makedirs(os.path.dirname(os.path.abspath(args.out)), exist_ok=True)
    net.eval()
    dummy = torch.zeros(1, 3, 32, 32)
    torch.onnx.export(
        net, dummy, args.out,
        input_names=["input"], output_names=["output"],
        dynamic_axes={"input": {0: "b", 2: "h", 3: "w"}, "output": {0: "b", 2: "oh", 3: "ow"}},
        opset_version=17, dynamo=False,
    )
    print(f"\nexported {args.out} ({os.path.getsize(args.out)/1e6:.2f} MB)", flush=True)
    print('Add to site/models/models.json:', flush=True)
    print(f'  {{ "models": [ {{ "id": "lumionet-x{args.scale}", "name": "LumioNet", "file": "models/{os.path.basename(args.out)}", "scale": {args.scale} }} ] }}', flush=True)


if __name__ == "__main__":
    main()
