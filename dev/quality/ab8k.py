import numpy as np, subprocess
from PIL import Image

inp = Image.open("/workspace/testdata/input_q60.jpg").convert("RGB")
a = np.asarray(inp, dtype=np.uint8)
rgba = np.zeros((a.shape[0], a.shape[1], 4), dtype=np.uint8)
rgba[..., :3] = a
rgba[..., 3] = 255
rgba.tofile("/tmp/in.raw")
sw, sh = inp.size
ow, oh = 4294, 7680
outs = {}
for r in (2, 3, 5):
    subprocess.run(["node", "dev/quality/run_engine.mjs", "/tmp/in.raw", str(sw), str(sh),
                    f"/tmp/k{r}.raw", str(ow), str(oh), "0.6", str(r)], check=True)
    arr = np.fromfile(f"/tmp/k{r}.raw", dtype=np.uint8).reshape(oh, ow, 4)
    outs[r] = Image.fromarray(arr[..., :3])

ref = Image.open("/workspace/testdata/reference_full.jpg").convert("RGB")
W, H = ref.size
box = (330, 1250, 1230, 1700)
labels = [("input", inp), ("8K r2", outs[2]), ("8K r3", outs[3]), ("8K r5", outs[5]), ("reference", ref)]
cw, ch = box[2] - box[0], box[3] - box[1]
sheet = Image.new("RGB", (cw, (ch + 12) * len(labels)), "white")
for i, (n, im) in enumerate(labels):
    im2 = im.resize((W, H), Image.LANCZOS) if im.size != (W, H) else im
    sheet.paste(im2.crop(box), (0, i * (ch + 12)))
sheet.save("/workspace/testdata/8k_radius_ab.png")
print("ok", sheet.size)
