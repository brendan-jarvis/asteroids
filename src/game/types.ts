export type Phase = "boot" | "attract" | "play" | "pause" | "over";

export type Hud = {
  phase: Phase;
  score: number;
  best: number;
  wave: number;
  lives: number;
  banner: string | null;
  sound: boolean;
  haptics: boolean;
  tilt: boolean;
};

export type ActionName = "left" | "right" | "thrust" | "fire";

export type GameApi = {
  start: () => void;
  resume: () => void;
  togglePause: () => void;
  unlockAudio: () => void;
  setAction: (name: ActionName, down: boolean) => void;
  tapHyper: () => void;
  setSound: (on: boolean) => void;
  setHaptics: (on: boolean) => void;
  setTiltEnabled: (on: boolean) => void;
  setTiltSteer: (value: number) => void;
  dispose: () => void;
};
