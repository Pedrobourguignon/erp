/**
 * The beep of the counter: the operator is looking at the customer and the
 * product, not at the screen. A short high tone means "in the cart", a longer
 * low one means "look at the screen".
 */
let context: AudioContext | null = null;

const TONES = {
  ok: { frequency: 1800, seconds: 0.08 },
  error: { frequency: 220, seconds: 0.35 },
} as const;

export function playScanSound(kind: keyof typeof TONES): void {
  try {
    const Ctor = globalThis.AudioContext;
    if (!Ctor) {return;}
    context ??= new Ctor();
    const tone = TONES[kind];
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = kind === "ok" ? "sine" : "square";
    oscillator.frequency.value = tone.frequency;
    gain.gain.value = 0.15;
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start(context.currentTime);
    oscillator.stop(context.currentTime + tone.seconds);
  } catch {
    // No audio is no reason to stop a sale.
  }
}

const SOUND_KEY = "hubscale:scan-sound";

/** Whether this computer wants the reader's beep (a per-device choice). */
export function scanSoundEnabled(): boolean {
  try {
    return window.localStorage.getItem(SOUND_KEY) !== "off";
  } catch {
    return true;
  }
}

export function setScanSoundEnabled(on: boolean): void {
  try {
    window.localStorage.setItem(SOUND_KEY, on ? "on" : "off");
  } catch {
    // Without storage the choice lasts until the page reloads.
  }
}
