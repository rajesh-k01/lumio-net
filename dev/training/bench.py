import time, torch, torch.nn as nn, torch.nn.functional as F
torch.set_num_threads(2)

class RB(nn.Module):
    def __init__(s, ch):
        super().__init__(); s.c1 = nn.Conv2d(ch, ch, 3, 1, 1); s.c2 = nn.Conv2d(ch, ch, 3, 1, 1)
    def forward(s, x): return x + s.c2(F.relu(s.c1(x)))

class Net(nn.Module):
    def __init__(s, ch=32, b=5, sc=2):
        super().__init__(); s.sc = sc
        s.head = nn.Conv2d(3, ch, 3, 1, 1); s.body = nn.Sequential(*[RB(ch) for _ in range(b)])
        s.bt = nn.Conv2d(ch, ch, 3, 1, 1)
        s.up = nn.Sequential(nn.Conv2d(ch, ch * sc * sc, 3, 1, 1), nn.PixelShuffle(sc))
        s.tail = nn.Conv2d(ch, 3, 3, 1, 1)
    def forward(s, x):
        base = F.interpolate(x, scale_factor=s.sc, mode="bicubic", align_corners=False)
        y = s.head(x); y = y + s.bt(s.body(y)); y = s.up(y)
        return s.tail(y) + base

for (ch, b, patch, bs) in [(32, 5, 32, 12), (32, 6, 48, 16), (48, 4, 32, 12), (32, 4, 32, 16)]:
    net = Net(ch, b); opt = torch.optim.AdamW(net.parameters(), lr=2e-3)
    x = torch.rand(bs, 3, patch, patch); y = torch.rand(bs, 3, patch * 2, patch * 2)
    for _ in range(2):
        out = net(x); loss = (out - y).abs().mean(); opt.zero_grad(); loss.backward(); opt.step()
    t0 = time.time(); n = 15
    for _ in range(n):
        out = net(x); loss = (out - y).abs().mean(); opt.zero_grad(); loss.backward(); opt.step()
    dt = (time.time() - t0) / n
    print(f"  ch{ch} blocks{b} patch{patch} batch{bs}: {dt*1000:.0f} ms/iter -> 2000 iters = {dt*2000/60:.1f} min", flush=True)
