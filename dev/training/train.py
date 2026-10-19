#!/usr/bin/env python3
"""Train the in-browser AI upscaler and export it as ONNX.

    python3 dev/training/train.py --data data/train --out models/lumionet-x2.onnx --scale 2

The network is a small EDSR-style residual net: a conv into feature space,
a stack of residual blocks with channel attention, and a pixel-shuffle head
that doubles the resolution. It is deliberately small (~1.5M parameters) so
it can run in a phone browser through ONNX Runtime Web.

The exported file matches what the app expects exactly:
    input  float32 [1, 3, h, w]   RGB in 0..1
    output float32 [1, 3, s*h, s*w]

Drop the file into site/models/ and list it in site/models/models.json and
the app grows a "LumioNet" engine that runs the model in the browser.

Needs: pip install torch onnx pillow numpy
A GPU is strongly recommended. On CPU, train fewer patches and fewer epochs.
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


class ResBlock(nn.Module):
    def __init__(self, ch=64):
        super().__init__()
        self.c1 = nn.Conv2d(ch, ch, 3, 1, 1)
        self.c2 = nn.Conv2d(ch, ch, 3, 1, 1)
        self.att = nn.Sequential(nn.AdaptiveAvgPool2d(1), nn.Conv2d(ch, ch, 1), nn.Sigmoid())

    def forward(self, x):
        y = self.c2(F.relu(self.c1(x)))
        return x + y * self.att(y)


class Net(nn.Module):
    """Compact EDSR-style SR network with a pixel-shuffle head."""

    def __init__(self, ch=64, blocks=8, scale=2):
        super().__init__()
        self.head = nn.Conv2d(3, ch, 3, 1, 1)
        self.body = nn.Sequential(*[ResBlock(ch) for _ in range(blocks)])
        self.body_tail = nn.Conv2d(ch, ch, 3, 1, 1)
        self.upsample = nn.Sequential(
            nn.Conv2d(ch, ch * scale * scale, 3, 1, 1),
            nn.PixelShuffle(scale),
        )
        self.tail = nn.Conv2d(ch, 3, 3, 1, 1)

    def forward(self, x):
        # The network predicts the residual, so it starts from a bicubic
        # upsample of the input: that makes learning far easier.
        base = F.interpolate(x, scale_factor=self.upsample[-1].upscale_factor, mode="bicubic", align_corners=False)
        y = self.head(x)
        y = y + self.body_tail(self.body(y))
        y = self.upsample(y)
        return self.tail(y) + base


def load_pairs(data_dir, scale):
    hr_dir = os.path.join(data_dir, "hr")
    lr_dir = os.path.join(data_dir, "lr")
    names = sorted(os.listdir(hr_dir))
    if not names:
        raise SystemExit(f"no patches in {hr_dir} — run prepare_dataset.py first")
    pairs = []
    for n in names:
        hr = np.asarray(Image.open(os.path.join(hr_dir, n)).convert("RGB"), dtype=np.float32) / 255.0
        lr = np.asarray(Image.open(os.path.join(lr_dir, n)).convert("RGB"), dtype=np.float32) / 255.0
        pairs.append((np.transpose(lr, (2, 0, 1)), np.transpose(hr, (2, 0, 1))))
    print(f"{len(pairs)} patch pairs from {data_dir} (scale {scale})")
    return pairs


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", default="data/train")
    ap.add_argument("--out", default="models/lumionet-x2.onnx")
    ap.add_argument("--scale", type=int, default=2)
    ap.add_argument("--channels", type=int, default=64)
    ap.add_argument("--blocks", type=int, default=8)
    ap.add_argument("--epochs", type=int, default=200)
    ap.add_argument("--batch", type=int, default=16)
    ap.add_argument("--lr", type=float, default=2e-4)
    ap.add_argument("--seed", type=int, default=0)
    args = ap.parse_args()

    torch.manual_seed(args.seed)
    random.seed(args.seed)
    np.random.seed(args.seed)
    device = "cuda" if torch.cuda.is_available() else "cpu"
    print(f"device: {device}  ({torch.cuda.get_device_name(0) if device == 'cuda' else 'no GPU — be patient'})")

    pairs = load_pairs(args.data, args.scale)
    net = Net(args.channels, args.blocks, args.scale).to(device)
    n_params = sum(p.numel() for p in net.parameters())
    print(f"model: {n_params/1e6:.2f}M parameters")

    opt = torch.optim.AdamW(net.parameters(), lr=args.lr, weight_decay=1e-4)
    sched = torch.optim.lr_scheduler.CosineAnnealingLR(opt, T_max=args.epochs)
    l1 = nn.L1Loss()

    tensors_l = torch.from_numpy(np.stack([p[0] for p in pairs]))
    tensors_h = torch.from_numpy(np.stack([p[1] for p in pairs]))

    best = float("inf")
    for epoch in range(args.epochs):
        net.train()
        idx = torch.randperm(len(pairs))
        total = 0.0
        t0 = time.time()
        for i in range(0, len(idx), args.batch):
            sel = idx[i:i + args.batch]
            lr = tensors_l[sel].to(device)
            hr = tensors_h[sel].to(device)
            out = net(lr)
            loss = l1(out, hr)
            opt.zero_grad()
            loss.backward()
            opt.step()
            total += loss.item() * len(sel)
        sched.step()
        mean = total / len(idx)
        if mean < best:
            best = mean
        if epoch % 10 == 0 or epoch == args.epochs - 1:
            print(f"  epoch {epoch:4d}  L1 {mean:.5f}  best {best:.5f}  ({time.time()-t0:.1f}s)")

    os.makedirs(os.path.dirname(os.path.abspath(args.out)), exist_ok=True)
    net.eval()
    dummy = torch.zeros(1, 3, 64, 64)
    torch.onnx.export(
        net, dummy, args.out,
        input_names=["input"], output_names=["output"],
        dynamic_axes={"input": {0: "batch", 2: "h", 3: "w"}, "output": {0: "batch", 2: "oh", 3: "ow"}},
        opset_version=17, dynamo=False,
    )
    size = os.path.getsize(args.out) / 1e6
    print(f"\nexported {args.out} ({size:.1f} MB)")
    print("Put it in site/models/ and add it to site/models/models.json:")
    print(f'  {{ "models": [ {{ "id": "lumionet-x{args.scale}", "name": "LumioNet", "file": "models/{os.path.basename(args.out)}", "scale": {args.scale} }} ] }}')


if __name__ == "__main__":
    main()
