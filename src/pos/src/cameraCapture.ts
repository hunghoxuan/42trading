export class StablePhotoTrigger {
  private previous: Uint8ClampedArray | null = null;
  private steadySince: number | null = null;
  constructor(private openedAt: number, private holdMs = 1400) {}

  reset(now: number) {
    this.previous = null; this.steadySince = null; this.openedAt = now;
  }

  update(pixels: Uint8ClampedArray, now: number) {
    let brightness = 0, contrast = 0, movement = 0;
    const count = pixels.length / 4;
    for (let i = 0; i < pixels.length; i += 4) {
      const value = (pixels[i] + pixels[i + 1] + pixels[i + 2]) / 3;
      brightness += value; contrast += value * value;
      if (this.previous) movement += Math.abs(value - (this.previous[i] + this.previous[i + 1] + this.previous[i + 2]) / 3);
    }
    brightness /= count;
    const clear = brightness > 20 && brightness < 240 && Math.sqrt(Math.max(0, contrast / count - brightness * brightness)) > 9;
    const stable = clear && this.previous !== null && movement / count < 4.5 && now - this.openedAt >= 1100;
    this.previous = new Uint8ClampedArray(pixels);
    if (!stable) this.steadySince = null;
    else this.steadySince ??= now;
    const remaining = this.steadySince === null ? this.holdMs : Math.max(0, this.holdMs - (now - this.steadySince));
    return { capture: stable && remaining === 0, remaining, clear };
  }
}

export function cameraCrop(width: number, height: number) {
  const side = Math.min(width, height) * 0.86;
  return { x: (width - side) / 2, y: (height - side) / 2, side };
}

export async function captureCameraPhoto(video: HTMLVideoElement, fullFrame = false): Promise<File> {
  if (!video.videoWidth || !video.videoHeight) throw new Error("Camera is not ready yet");
  const square = cameraCrop(video.videoWidth, video.videoHeight);
  const crop = fullFrame ? { x: 0, y: 0, width: video.videoWidth, height: video.videoHeight }
    : { x: square.x, y: square.y, width: square.side, height: square.side };
  const canvas = document.createElement("canvas");
  const scale = Math.min(1, (fullFrame ? 1920 : 1280) / Math.max(crop.width, crop.height));
  canvas.width = Math.round(crop.width * scale); canvas.height = Math.round(crop.height * scale);
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Could not capture photo. Try again.");
  context.drawImage(video, crop.x, crop.y, crop.width, crop.height, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((value) =>
    value ? resolve(value) : reject(new Error("Could not capture photo. Try again.")), "image/jpeg", 0.92));
  return new File([blob], "pos-camera.jpg", { type: "image/jpeg" });
}
