# Product photo segmentation

`u2netp.onnx` is the lightweight U²-Net model by Xuebin Qin et al., used to remove product photo backgrounds locally in the browser.

- Upstream: https://github.com/xuebinqin/U-2-Net
- Model distribution: https://github.com/danielgatis/rembg/releases/download/v0.0.0/u2netp.onnx
- Verified MD5: `8e83ca70e441ab06c318d82300c84806` (matches rembg's published checksum)
- License: Apache 2.0, included in `LICENSE.u2net.txt`.

The model and ONNX Runtime WebAssembly are served with the app; no external inference API or API key is used. The compact model works best with one centered product, good light, and a simple background. POS keeps the largest separated foreground object to remove nearby distractions such as a person's face, then straightens tall products by up to 30 degrees using their silhouette. This is a local image cleanup heuristic; it may need a closer or cleaner capture when the product overlaps another object. If segmentation is unavailable or ambiguous, the original framed photo is retained and the user is informed.
