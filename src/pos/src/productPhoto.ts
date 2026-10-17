import * as ort from "onnxruntime-web/wasm";
import wasmUrl from "onnxruntime-web/ort-wasm-simd-threaded.wasm?url";

const modelUrl = new URL("./models/u2netp.onnx", import.meta.url).href;
let sessionPromise: Promise<ort.InferenceSession> | undefined;

export function warmProductPhoto() {
  if (!sessionPromise) {
    ort.env.wasm.numThreads = 1;
    ort.env.wasm.proxy = true;
    ort.env.wasm.wasmPaths = { wasm: wasmUrl };
    sessionPromise = ort.InferenceSession.create(modelUrl, { executionProviders: ["wasm"] })
      .catch((error) => { sessionPromise = undefined; throw error; });
  }
  return sessionPromise;
}

function canvas(width: number, height = width) {
  const result = document.createElement("canvas");
  result.width = width; result.height = height;
  return result;
}

async function encode(image: HTMLCanvasElement): Promise<string> {
  const blob = await new Promise<Blob>((resolve, reject) => image.toBlob((value) =>
    value ? resolve(value) : reject(new Error("Could not prepare product photo")), "image/webp", 0.9));
  if (blob.size > 3 * 1024 * 1024) throw new Error("Product photo is too large");
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Could not read product photo"));
    reader.readAsDataURL(blob);
  });
}

// Runs locally. Only the finished product image is saved to the POS API.
export async function prepareProductPhoto(file: File): Promise<{ image: string; backgroundRemoved: boolean }> {
  if (!/^image\/(png|jpeg|webp)$/.test(file.type) || file.size > 12 * 1024 * 1024) {
    throw new Error("Choose a PNG, JPEG, or WebP image under 12 MB");
  }
  const url = URL.createObjectURL(file);
  const image = new Image();
  try {
    image.src = url;
    await image.decode();
    const scale = Math.min(1, 1280 / Math.max(image.naturalWidth, image.naturalHeight));
    const source = canvas(Math.max(1, Math.round(image.naturalWidth * scale)), Math.max(1, Math.round(image.naturalHeight * scale)));
    source.getContext("2d")!.drawImage(image, 0, 0, source.width, source.height);
    try {
      const session = await warmProductPhoto();
      const input = canvas(320);
      const context = input.getContext("2d")!;
      context.drawImage(source, 0, 0, 320, 320);
      const pixels = context.getImageData(0, 0, 320, 320).data;
      const area = 320 * 320;
      const data = new Float32Array(area * 3);
      let maximum = 1;
      for (let i = 0; i < pixels.length; i += 4) maximum = Math.max(maximum, pixels[i], pixels[i + 1], pixels[i + 2]);
      const mean = [0.485, 0.456, 0.406], deviation = [0.229, 0.224, 0.225];
      for (let i = 0; i < area; i++) for (let channel = 0; channel < 3; channel++) {
        data[channel * area + i] = (pixels[i * 4 + channel] / maximum - mean[channel]) / deviation[channel];
      }
      const tensor = new ort.Tensor("float32", data, [1, 3, 320, 320]);
      let output: ort.InferenceSession.ReturnType | undefined;
      let mask: Float32Array;
      try {
        output = await session.run({ [session.inputNames[0]]: tensor });
        mask = Float32Array.from(output[session.outputNames[0]].data as Float32Array);
      } finally {
        tensor.dispose();
        Object.values(output || {}).forEach((value) => value.dispose());
      }
      let minimum = Infinity, maximumMask = -Infinity;
      for (let i = 0; i < area; i++) { minimum = Math.min(minimum, mask[i]); maximumMask = Math.max(maximumMask, mask[i]); }
      if (maximumMask - minimum < 0.001) throw new Error("No clear foreground");
      const rgba = context.createImageData(320, 320);
      let left = 320, right = 0, top = 320, bottom = 0, foreground = 0;
      for (let i = 0; i < area; i++) {
        const alpha = Math.round(255 * (mask[i] - minimum) / (maximumMask - minimum));
        rgba.data.set([255, 255, 255, alpha], i * 4);
        if (alpha > 96) {
          const x = i % 320, y = Math.floor(i / 320);
          left = Math.min(left, x); right = Math.max(right, x); top = Math.min(top, y); bottom = Math.max(bottom, y); foreground++;
        }
      }
      if (foreground < area * 0.025 || foreground > area * 0.98) throw new Error("No clear foreground");
      context.putImageData(rgba, 0, 0);
      const cutout = canvas(source.width, source.height);
      const cutoutContext = cutout.getContext("2d")!;
      cutoutContext.drawImage(source, 0, 0);
      cutoutContext.globalCompositeOperation = "destination-in";
      cutoutContext.drawImage(input, 0, 0, source.width, source.height);
      const x = Math.max(0, left - 3) / 320 * source.width;
      const y = Math.max(0, top - 3) / 320 * source.height;
      const width = Math.min(320 - Math.max(0, left - 3), right - left + 7) / 320 * source.width;
      const height = Math.min(320 - Math.max(0, top - 3), bottom - top + 7) / 320 * source.height;
      const result = canvas(768);
      const fit = 704 / Math.max(width, height);
      result.getContext("2d")!.drawImage(cutout, x, y, width, height, (768 - width * fit) / 2, (768 - height * fit) / 2, width * fit, height * fit);
      return { image: await encode(result), backgroundRemoved: true };
    } catch (error) {
      console.warn("POS background removal unavailable; keeping the captured photo", error);
      return { image: await encode(source), backgroundRemoved: false };
    }
  } finally { URL.revokeObjectURL(url); }
}
