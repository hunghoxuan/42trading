// Injected by the Android wrapper only for its configured HTTPS origin.
type AndroidMessage = { type: "print"; html: string }
  | { type: "saveFile"; filename: string; mime: string; base64: string };

export function sendToAndroid(message: () => AndroidMessage): boolean {
  const bridge = (window as unknown as { PosAndroid?: { postMessage: (value: string) => void } }).PosAndroid;
  if (!bridge || typeof bridge.postMessage !== "function") return false;
  bridge.postMessage(JSON.stringify(message()));
  return true;
}
