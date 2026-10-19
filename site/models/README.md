# Models

Put trained LumioNet `.onnx` files here and list them in `models.json`:

```json
{ "models": [ { "id": "lumionet-x2", "name": "LumioNet", "file": "models/lumionet-x2.onnx", "scale": 2 } ] }
```

Export with `python -m lumionet.export_onnx` from the lumionet project. Input is float32 [1,3,h,w] RGB 0..1, output [1,3,scale*h,scale*w].
The LumioNet engine only appears on the page when this list is not empty. The first model in the list is used.
