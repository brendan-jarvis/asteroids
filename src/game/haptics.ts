export type HapticKind = "tick" | "fire" | "hit" | "boom" | "die" | "hyper" | "life" | "ufo";

const PATTERNS: Record<HapticKind, number[]> = {
  tick: [12],
  fire: [16],
  hit: [14, 28, 18],
  boom: [22, 30, 36],
  die: [40, 36, 80, 40, 120],
  hyper: [10, 22, 10, 22, 28],
  life: [16, 40, 16, 40, 22],
  ufo: [18, 50, 18],
};

let enabled = true;
let label: HTMLLabelElement | null = null;

export function setHapticsEnabled(on: boolean) {
  enabled = on;
}

export function bindHapticLabel(el: HTMLLabelElement | null) {
  label = el;
}

export function haptic(kind: HapticKind) {
  if (!enabled || typeof window === "undefined") return;
  const pattern = PATTERNS[kind];
  try {
    if (typeof navigator.vibrate === "function") navigator.vibrate(pattern);
  } catch {
    /* some browsers throw if vibration is blocked */
  }
  // iOS Safari has no vibrate API. A label click on <input switch> fires the Taptic Engine
  // when this runs inside a user gesture (Safari 17.4+).
  if (label) label.click();
}
