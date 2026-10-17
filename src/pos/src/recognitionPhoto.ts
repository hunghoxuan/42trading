import { prepareProductPhoto } from "./productPhoto";

export type PhotoColor = { color: string; weight: number };
const referenceCache = new Map<string, Promise<PhotoColor[]>>();

function colorName(r: number, g: number, b: number): string {
  const max = Math.max(r, g, b), min = Math.min(r, g, b), delta = max - min;
  if (max < 55) return "black";
  if (delta / Math.max(1, max) < 0.18) return max > 190 ? "white" : "gray";
  const hue = (((max === r ? (g - b) / delta : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4) * 60) + 360) % 360;
  if (hue < 18 || hue >= 345) return "red";
  if (hue < 45) return max < 165 ? "brown" : "orange";
  if (hue < 70) return "yellow";
  if (hue < 170) return "green";
  if (hue < 260) return "blue";
  if (hue < 300) return "purple";
  return "pink";
}

function extractColors(image: HTMLImageElement): PhotoColor[] {
  const canvas = document.createElement("canvas"); canvas.width = canvas.height = 96;
  const context = canvas.getContext("2d", { willReadFrequently: true })!;
  context.drawImage(image, 0, 0, 96, 96);
  const pixels = context.getImageData(0, 0, 96, 96).data;
  const counts = new Map<string, number>(); let total = 0;
  for (let i = 0; i < pixels.length; i += 4) {
    if (pixels[i + 3] < 180) continue;
    const name = colorName(pixels[i], pixels[i + 1], pixels[i + 2]);
    counts.set(name, (counts.get(name) || 0) + 1); total++;
  }
  return [...counts].map(([color, count]) => ({ color, weight: count / Math.max(1, total) }))
    .sort((a, b) => b.weight - a.weight).filter((item) => item.weight >= 0.04);
}

async function loadImage(src: string) {
  const image = new Image(); image.src = src; await image.decode(); return image;
}

export async function prepareRecognitionPhoto(file: File, products: { sid: string; image: string }[]) {
  const prepared = await prepareProductPhoto(file);
  const image = await loadImage(prepared.image);
  const colors = prepared.backgroundRemoved ? extractColors(image) : [];
  const boundsCanvas = document.createElement("canvas"); boundsCanvas.width = image.naturalWidth; boundsCanvas.height = image.naturalHeight;
  const boundsContext = boundsCanvas.getContext("2d", { willReadFrequently: true })!;
  boundsContext.drawImage(image, 0, 0);
  const rgba = boundsContext.getImageData(0, 0, boundsCanvas.width, boundsCanvas.height).data;
  let left = image.naturalWidth, top = image.naturalHeight, right = 0, bottom = 0;
  for (let y = 0; y < boundsCanvas.height; y++) for (let x = 0; x < boundsCanvas.width; x++) {
    if (rgba[(y * boundsCanvas.width + x) * 4 + 3] < 180) continue;
    left = Math.min(left, x); right = Math.max(right, x); top = Math.min(top, y); bottom = Math.max(bottom, y);
  }
  if (right <= left || bottom <= top) { left = top = 0; right = image.naturalWidth - 1; bottom = image.naturalHeight - 1; }
  const width = right - left + 1, height = bottom - top + 1;
  function ocrImage(x: number, y: number, w: number, h: number, contrast = false, fixedScale?: number) {
    const canvas = document.createElement("canvas");
    const scale = fixedScale ?? Math.min(3, 1800 / Math.max(w, h));
    canvas.width = Math.round(w * scale); canvas.height = Math.round(h * scale);
    const context = canvas.getContext("2d")!;
    context.fillStyle = "white"; context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, x, y, w, h, 0, 0, canvas.width, canvas.height);
    if (contrast) {
      const frame = context.getImageData(0, 0, canvas.width, canvas.height);
      for (let i = 0; i < frame.data.length; i += 4) {
        const gray = (frame.data[i] * 0.299 + frame.data[i + 1] * 0.587 + frame.data[i + 2] * 0.114 - 128) * 1.5 + 128;
        frame.data[i] = frame.data[i + 1] = frame.data[i + 2] = gray;
      }
      context.putImageData(frame, 0, 0);
    }
    return canvas.toDataURL("image/jpeg", 0.94);
  }
  // White backing is essential: transparent cutouts otherwise lose white label text in OCR.
  const full = ocrImage(left, top, width, height);
  const label = ocrImage(left, top + height * 0.12, width, height * 0.42);
  const enhanced = ocrImage(left, top, width, height, true);
  // Brand logos are often treated as graphics in page OCR. Overlapping line views
  // let the OCR read the lettering separately from the surrounding logo/decoration.
  const line_images = Array.from({ length: 8 }, (_, index) =>
    ocrImage(left, top + height * (0.12 + index * 0.08), width, height * 0.09, false, Math.min(3, 1800 / height)));
  const visual_matches: { product_sid: string; similarity: number }[] = [];
  if (colors.length) await Promise.all(products.filter((product) => product.image.startsWith("data:image/")).slice(0, 200).map(async (product) => {
    try {
      let reference = referenceCache.get(product.image);
      if (!reference) {
        reference = loadImage(product.image).then(extractColors);
        referenceCache.set(product.image, reference);
        if (referenceCache.size > 200) referenceCache.delete(referenceCache.keys().next().value!);
      }
      const values = await reference;
      const similarity = colors.reduce((sum, item) => sum + Math.min(item.weight, values.find((value) => value.color === item.color)?.weight || 0), 0);
      if (similarity >= 0.6) visual_matches.push({ product_sid: product.sid, similarity });
    } catch { /* A missing/invalid reference image contributes no color evidence. */ }
  }));
  return { image: full, capture_image: prepared.image, background_removed: prepared.backgroundRemoved,
    ocr_images: [label, enhanced], line_images, colors,
    visual_matches: visual_matches.sort((a, b) => b.similarity - a.similarity).slice(0, 30) };
}
