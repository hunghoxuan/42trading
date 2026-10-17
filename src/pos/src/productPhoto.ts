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

function mainObject(mask: Float32Array, minimum: number, maximum: number, size: number) {
  const area = size * size;
  const alpha = new Uint8Array(area);
  const active = new Uint8Array(area);
  for (let i = 0; i < area; i++) {
    alpha[i] = Math.round(255 * (mask[i] - minimum) / (maximum - minimum));
    active[i] = alpha[i] > 112 ? 1 : 0;
  }

  // A one-pixel erosion breaks thin mask bridges between adjacent objects.
  // We use the eroded mask only to separate components; the soft original
  // alpha is restored around the chosen component below.
  const core = new Uint8Array(area);
  for (let y = 1; y < size - 1; y++) for (let x = 1; x < size - 1; x++) {
    const i = y * size + x;
    if (active[i] && active[i - size - 1] && active[i - size] && active[i - size + 1]
      && active[i - 1] && active[i + 1] && active[i + size - 1] && active[i + size] && active[i + size + 1]) core[i] = 1;
  }

  // U²-Net can mark both a product and a nearby face as foreground. Keep the
  // largest 8-connected foreground region, which is usually the product.
  const visited = new Uint8Array(area);
  let largest: number[] = [];
  for (let start = 0; start < area; start++) {
    if (!core[start] || visited[start]) continue;
    const component: number[] = [], pending = [start];
    visited[start] = 1;
    while (pending.length) {
      const current = pending.pop()!;
      component.push(current);
      const x = current % size, y = Math.floor(current / size);
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= size || ny >= size) continue;
        const neighbor = ny * size + nx;
        if (core[neighbor] && !visited[neighbor]) { visited[neighbor] = 1; pending.push(neighbor); }
      }
    }
    if (component.length > largest.length) largest = component;
  }

  const keep = new Uint8Array(area);
  let left = size, right = 0, top = size, bottom = 0;
  let sumX = 0, sumY = 0;
  for (const i of largest) {
    keep[i] = 1;
    const x = i % size, y = Math.floor(i / size);
    left = Math.min(left, x); right = Math.max(right, x); top = Math.min(top, y); bottom = Math.max(bottom, y);
    sumX += x; sumY += y;
  }
  if (!largest.length) return { alpha: new Uint8Array(area), left: 0, top: 0, right: size - 1, bottom: size - 1, rotation: 0 };

  // Retain the original soft edge only beside the selected component. This
  // avoids jagged cutouts without reintroducing detached background objects.
  const smooth = new Uint8Array(area);
  for (const i of largest) {
    const x = i % size, y = Math.floor(i / size);
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
      const nx = x + dx, ny = y + dy;
      if (nx >= 0 && ny >= 0 && nx < size && ny < size) smooth[ny * size + nx] = 1;
    }
  }
  const cleanAlpha = new Uint8Array(area);
  for (let i = 0; i < area; i++) if (smooth[i]) cleanAlpha[i] = alpha[i];

  // Align the foreground's principal axis vertically. Ignore wide/round
  // objects and cap correction to avoid aggressive rotations on noisy masks.
  const centerX = sumX / largest.length, centerY = sumY / largest.length;
  let xx = 0, yy = 0, xy = 0;
  for (const i of largest) {
    const dx = i % size - centerX, dy = Math.floor(i / size) - centerY;
    xx += dx * dx; yy += dy * dy; xy += dx * dy;
  }
  let rotation = 0;
  if (bottom - top + 1 > (right - left + 1) * 1.12) {
    const axis = 0.5 * Math.atan2(2 * xy, xx - yy);
    rotation = Math.PI / 2 - axis;
    while (rotation > Math.PI / 2) rotation -= Math.PI;
    while (rotation < -Math.PI / 2) rotation += Math.PI;
    rotation = Math.max(-Math.PI / 6, Math.min(Math.PI / 6, rotation));
  }
  return { alpha: cleanAlpha, left: Math.max(0, left - 2), top: Math.max(0, top - 2),
    right: Math.min(size - 1, right + 2), bottom: Math.min(size - 1, bottom + 2), rotation };
}

function uprightCrop(image: HTMLCanvasElement, left: number, top: number, width: number, height: number, rotation: number) {
  const crop = canvas(Math.max(1, Math.ceil(width)), Math.max(1, Math.ceil(height)));
  crop.getContext("2d")!.drawImage(image, left, top, width, height, 0, 0, crop.width, crop.height);
  const rotatedWidth = Math.ceil(Math.abs(crop.width * Math.cos(rotation)) + Math.abs(crop.height * Math.sin(rotation)));
  const rotatedHeight = Math.ceil(Math.abs(crop.width * Math.sin(rotation)) + Math.abs(crop.height * Math.cos(rotation)));
  const rotated = canvas(rotatedWidth, rotatedHeight);
  const context = rotated.getContext("2d")!;
  context.translate(rotatedWidth / 2, rotatedHeight / 2);
  context.rotate(rotation);
  context.drawImage(crop, -crop.width / 2, -crop.height / 2);
  return rotated;
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
      const detected = mainObject(mask, minimum, maximumMask, 320);
      const rgba = context.createImageData(320, 320);
      let foreground = 0;
      for (let i = 0; i < area; i++) {
        const alpha = detected.alpha[i];
        rgba.data.set([255, 255, 255, alpha], i * 4);
        if (alpha > 96) foreground++;
      }
      if (foreground < area * 0.025 || foreground > area * 0.98) throw new Error("No clear foreground");
      context.putImageData(rgba, 0, 0);
      const cutout = canvas(source.width, source.height);
      const cutoutContext = cutout.getContext("2d")!;
      cutoutContext.drawImage(source, 0, 0);
      cutoutContext.globalCompositeOperation = "destination-in";
      cutoutContext.drawImage(input, 0, 0, source.width, source.height);
      const x = detected.left / 320 * source.width;
      const y = detected.top / 320 * source.height;
      const width = (detected.right - detected.left + 1) / 320 * source.width;
      const height = (detected.bottom - detected.top + 1) / 320 * source.height;
      const upright = uprightCrop(cutout, x, y, width, height, detected.rotation);
      const result = canvas(768);
      const fit = 704 / Math.max(upright.width, upright.height);
      result.getContext("2d")!.drawImage(upright, (768 - upright.width * fit) / 2, (768 - upright.height * fit) / 2,
        upright.width * fit, upright.height * fit);
      return { image: await encode(result), backgroundRemoved: true };
    } catch (error) {
      console.warn("POS background removal unavailable; keeping the captured photo", error);
      return { image: await encode(source), backgroundRemoved: false };
    }
  } finally { URL.revokeObjectURL(url); }
}
