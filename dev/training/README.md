# Training the in-browser AI upscaler (LumioNet)

The app has two kinds of engine:

| Engine | What it is | Quality |
|---|---|---|
| **Instant** | Lanczos-3 resampling + adaptive sharpening, in a Web Worker | Sharp, honest, no invented detail. Now runs up to 8K. |
| **LumioNet** | A trained neural network (ONNX) that runs **in the browser** | Can invent plausible fine detail — the "AI look". Needs a trained model. |

**No trained model ships with this repo.** The Instant engine is what you get out of
the box, and it is a good one. This folder is how you build the AI one.

## What you need

- A GPU. 8 GB of VRAM is enough for the small model below. On CPU it still runs,
  but expect it to crawl.
- A folder of photos you have the right to train on. A few hundred good photos
  already teaches the model a lot. More and more diverse is better.
- `pip install torch onnx pillow numpy`

## 1. Build the training set

```bash
python3 dev/training/prepare_dataset.py ~/photos --out data/train --size 256 --scale 2
```

That writes matched `hr/` and `lr/` patch pairs. The "low quality" side is made
the way real bad photos arrive: bicubic downscale, then JPEG compression, then
optional sensor noise. Training on clean bicubic pairs teaches the model to
sharpen nothing — the degradations are the whole point.

## 2. Train

```bash
python3 dev/training/train.py --data data/train --out models/lumionet-x2.onnx --scale 2 --epochs 200
```

The model is a small EDSR-style residual net with channel attention (~1.5M
parameters). It predicts the *residual* over a bicubic upsample, which makes it
learn much faster than predicting the whole image.

It exports ONNX with exactly the interface the app expects:

```
input  float32 [1, 3, h, w]   RGB in 0..1
output float32 [1, 3, 2h, 2w]
```

## 3. Put it in the app

```bash
cp models/lumionet-x2.onnx site/models/
```

Then list it in `site/models/models.json`:

```json
{ "models": [ { "id": "lumionet-x2", "name": "LumioNet", "file": "models/lumionet-x2.onnx", "scale": 2 } ] }
```

Publish the site (see the repo README) and the app grows a **LumioNet** engine.
It runs the model in tiles, so memory stays bounded on a phone, and the *AI
strength* slider blends the model against the plain Lanczos result — at 0 you get
the honest upscale, at 1 you get the full hallucinated detail.

## Using a pretrained model instead

Training your own is optional. State-of-the-art super-resolution models
(Real-ESRGAN, SwinIR, SeedVR2) are better than anything you will train here in
an afternoon. To use one:

1. Get the checkpoint and the model code (Real-ESRGAN's `RealESRGAN_x4plus.pth`
   is the usual starting point).
2. Export it to ONNX with the interface above — `input` / `output`, float32,
   `[1,3,h,w]` in `0..1`. A `scale` of 4 is normal for Real-ESRGAN; the app
   supports any integer scale.
3. Drop the file into `site/models/` and list it in `models.json` as above.

Keep the model small (a few MB to tens of MB). It is downloaded by every
visitor, and ONNX Runtime Web runs it on the phone's CPU.

## Honest expectations

- The AI engine **invents** detail. That is what makes it look good and also
  what makes it wrong sometimes: text, faces and fine patterns can come out
  garbled. The Instant engine never does that.
- The models above are small on purpose so they can run in a browser. A server
  engine running SeedVR2 on a GPU will beat both, at the price of uploading the
  photo.
- Training on your own photos (rather than generic ones) is what makes the
  result look like *your* camera's photos.
