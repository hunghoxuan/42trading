import { BrowserMultiFormatReader } from "@zxing/browser";
import { DecodeHintType } from "@zxing/library";

type NativeDetector = { detect: (source: HTMLCanvasElement) => Promise<{ rawValue: string }[]> };
type DetectorConstructor = { new(): NativeDetector };

// Keep the browser decoder as an independent first pass, with ZXing for browsers
// without BarcodeDetector. The same preprocessing is used for live and uploaded images.
export class ProductBarcodeReader {
  private reader = new BrowserMultiFormatReader(new Map([[DecodeHintType.TRY_HARDER, true]]));
  private canvas = document.createElement("canvas");
  private native: NativeDetector | undefined;

  constructor() {
    const Detector = (window as unknown as { BarcodeDetector?: DetectorConstructor }).BarcodeDetector;
    try { if (Detector) this.native = new Detector(); } catch { /* ZXing remains available. */ }
  }

  private draw(source: CanvasImageSource, width: number, height: number, variant: number) {
    const cropped = variant !== 0 && variant !== 2;
    const w = width * (variant === 1 ? 0.65 : cropped ? 0.9 : 1);
    const h = height * (variant === 1 ? 0.55 : cropped ? 0.6 : 1);
    const scale = Math.min(cropped ? 2 : 1, 1600 / Math.max(w, h));
    const rotated = variant === 2;
    const canvas = this.canvas;
    canvas.width = Math.max(1, Math.round((rotated ? h : w) * scale));
    canvas.height = Math.max(1, Math.round((rotated ? w : h) * scale));
    const context = canvas.getContext("2d", { willReadFrequently: true })!;
    context.fillStyle = "white"; context.fillRect(0, 0, canvas.width, canvas.height);
    context.translate(canvas.width / 2, canvas.height / 2);
    context.rotate((variant === 2 ? 90 : variant === 3 ? -15 : variant === 4 ? 15 : 0) * Math.PI / 180);
    context.drawImage(source, (width - w) / 2, (height - h) / 2, w, h, -w * scale / 2, -h * scale / 2, w * scale, h * scale);
    if (variant === 5) {
      const image = context.getImageData(0, 0, canvas.width, canvas.height);
      const histogram = new Uint32Array(256);
      for (let i = 0; i < image.data.length; i += 4) histogram[Math.round(image.data[i] * 0.299 + image.data[i + 1] * 0.587 + image.data[i + 2] * 0.114)]++;
      const count = canvas.width * canvas.height;
      let low = 0, high = 255, sum = 0;
      while (low < 254 && sum + histogram[low] < count * 0.02) sum += histogram[low++];
      sum = 0;
      while (high > low + 1 && sum + histogram[high] < count * 0.02) sum += histogram[high--];
      for (let i = 0; i < image.data.length; i += 4) {
        const gray = image.data[i] * 0.299 + image.data[i + 1] * 0.587 + image.data[i + 2] * 0.114;
        image.data[i] = image.data[i + 1] = image.data[i + 2] = (gray - low) * 255 / Math.max(1, high - low);
      }
      context.putImageData(image, 0, 0);
    }
    return canvas;
  }

  async read(source: CanvasImageSource, width: number, height: number, pass = 0): Promise<string> {
    if (!width || !height) return "";
    const full = this.draw(source, width, height, 0);
    if (this.native) {
      try { const found = await this.native.detect(full); if (found[0]?.rawValue) return found[0].rawValue.trim(); }
      catch { /* Some platforms expose the API but cannot decode this frame. */ }
    }
    try { return this.reader.decodeFromCanvas(full).getText().trim(); } catch { /* Try another view. */ }
    // One extra view per live iteration bounds CPU work while cycling through
    // close-up, vertical, tilted, and contrast-enhanced frames.
    const prepared = this.draw(source, width, height, 1 + pass % 5);
    try { return this.reader.decodeFromCanvas(prepared).getText().trim(); } catch { return ""; }
  }
}

export async function readBarcodePhoto(file: File): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const image = new Image(); image.src = url; await image.decode();
    const reader = new ProductBarcodeReader();
    for (let pass = 0; pass < 5; pass++) {
      const code = await reader.read(image, image.naturalWidth, image.naturalHeight, pass);
      if (code) return code;
    }
    return "";
  } finally { URL.revokeObjectURL(url); }
}
