# Models

`lumionet-x2.onnx` ships with the site: a trained ×2 super-resolution network
(140k parameters, 0.57 MB) that runs in the browser through ONNX Runtime Web.
It is listed in `models.json`, which is what makes the app show the
**LumioNet** engine.

To add or replace a model, put the `.onnx` file here and list it:

```json
{ "models": [ { "id": "lumionet-x2", "name": "LumioNet", "file": "models/lumionet-x2.onnx", "scale": 2 } ] }
```

Input must be float32 `[1,3,h,w]` RGB in `0..1`, output `[1,3,scale*h,scale*w]`.
The first model in the list is the one that runs.

The ONNX Runtime itself lives in `site/vendor/` and is loaded from there, so the
AI engine works offline and without a third-party CDN. `js/config.js` points
at it via `ortUrl`.

To build your own model, see [`dev/training/README.md`](../../dev/training/README.md).
