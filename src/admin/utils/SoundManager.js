/**
 * Sound Manager for Trading Events
 * Uses high-quality notification sounds for institutional-grade feedback.
 */

const SOUNDS = {
  SESSION_START: 'https://assets.mixkit.co/active_storage/sfx/2568/2568-preview.mp3', // Chime
  NEW_SIGNAL: 'https://assets.mixkit.co/active_storage/sfx/2869/2869-preview.mp3',    // Bell Ping
  TRADE_FILLED: 'https://assets.mixkit.co/active_storage/sfx/2012/2012-preview.mp3',  // Cash/Success
  TRADE_CLOSED: 'https://assets.mixkit.co/active_storage/sfx/2569/2569-preview.mp3',  // Soft Success
  NEWS_ALERT: 'https://assets.mixkit.co/active_storage/sfx/951/951-preview.mp3',      // Alert
};

const audioCache = {};
let audioUnlocked = false;
const pendingSoundTypes = new Set();

function flushPendingSounds() {
  if (!audioUnlocked || pendingSoundTypes.size === 0) return;
  const types = Array.from(pendingSoundTypes);
  pendingSoundTypes.clear();
  for (const type of types) {
    playSound(type);
  }
}

function markAudioUnlocked() {
  if (audioUnlocked) return;
  audioUnlocked = true;
  flushPendingSounds();
}

if (typeof window !== "undefined") {
  const unlockAudio = () => markAudioUnlocked();
  window.addEventListener("pointerdown", unlockAudio, { passive: true });
  window.addEventListener("keydown", unlockAudio, { passive: true });
}

export const playSound = (type) => {
  try {
    const url = SOUNDS[type];
    if (!url) return;

    if (!audioCache[type]) {
      audioCache[type] = new Audio(url);
    }

    const audio = audioCache[type];
    audio.currentTime = 0;

    const playPromise = audio.play();
    if (!playPromise || typeof playPromise.catch !== "function") return;
    playPromise.catch((err) => {
      if (err?.name === "NotAllowedError") {
        pendingSoundTypes.add(type);
        return;
      }
      console.error("[SoundManager] Playback error:", err);
    });
  } catch (err) {
    console.error("[SoundManager] Playback error:", err);
  }
};

export const SoundEvents = {
  SESSION_START: 'SESSION_START',
  NEW_SIGNAL: 'NEW_SIGNAL',
  TRADE_FILLED: 'TRADE_FILLED',
  TRADE_CLOSED: 'TRADE_CLOSED',
  NEWS_ALERT: 'NEWS_ALERT',
};
