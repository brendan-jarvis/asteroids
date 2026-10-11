type AudioCtor = typeof AudioContext;

export type AudioBus = {
  unlock: () => void;
  resume: () => void;
  setMuted: (muted: boolean) => void;
  shoot: (enemy?: boolean) => void;
  explode: (big: boolean) => void;
  thrust: (on: boolean) => void;
  ufo: (on: boolean) => void;
  ufoTone: (freq: number) => void;
  hyper: () => void;
  life: () => void;
  beat: (tense: boolean) => void;
  wave: () => void;
  dispose: () => void;
};

export function createAudio(): AudioBus {
  let ctx: AudioContext | null = null;
  let master: GainNode | null = null;
  let sfx: GainNode | null = null;
  let muted = false;
  let noise: AudioBuffer | null = null;
  let thrustSrc: AudioBufferSourceNode | null = null;
  let thrustGain: GainNode | null = null;
  let thrustOn = false;
  let ufoOsc: OscillatorNode | null = null;
  let ufoGain: GainNode | null = null;

  function ensure() {
    if (ctx) return ctx;
    const Ctor =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: AudioCtor }).webkitAudioContext;
    if (!Ctor) return null;
    ctx = new Ctor({ latencyHint: "interactive" });
    master = ctx.createGain();
    master.gain.value = muted ? 0 : 0.85;
    sfx = ctx.createGain();
    sfx.gain.value = 0.9;
    sfx.connect(master);
    master.connect(ctx.destination);
    const len = ctx.sampleRate;
    noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = noise.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    return ctx;
  }

  function unlock() {
    const context = ensure();
    if (context && context.state === "suspended") void context.resume();
  }

  function envGain(duration: number) {
    const context = ctx;
    const bus = sfx;
    if (!context || !bus) return null;
    const gain = context.createGain();
    gain.connect(bus);
    return { context, gain, stop: context.currentTime + duration };
  }

  function shoot(enemy = false) {
    const voice = envGain(0.12);
    if (!voice) return;
    const osc = voice.context.createOscillator();
    osc.type = "square";
    const t = voice.context.currentTime;
    const hi = enemy ? 420 : 920;
    const lo = enemy ? 140 : 200;
    osc.frequency.setValueAtTime(hi, t);
    osc.frequency.exponentialRampToValueAtTime(lo, t + 0.09);
    voice.gain.gain.setValueAtTime(0.0001, t);
    voice.gain.gain.exponentialRampToValueAtTime(enemy ? 0.045 : 0.07, t + 0.008);
    voice.gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.1);
    osc.connect(voice.gain);
    osc.start(t);
    osc.stop(t + 0.11);
    osc.onended = () => {
      osc.disconnect();
      voice.gain.disconnect();
    };
  }

  function explode(big: boolean) {
    const voice = envGain(big ? 0.55 : 0.32);
    if (!voice || !noise) return;
    const src = voice.context.createBufferSource();
    src.buffer = noise;
    const filter = voice.context.createBiquadFilter();
    filter.type = "lowpass";
    const t = voice.context.currentTime;
    filter.frequency.setValueAtTime(big ? 1400 : 900, t);
    filter.frequency.exponentialRampToValueAtTime(140, t + (big ? 0.45 : 0.26));
    const tone = voice.context.createOscillator();
    tone.type = "sine";
    tone.frequency.setValueAtTime(big ? 180 : 240, t);
    tone.frequency.exponentialRampToValueAtTime(40, t + (big ? 0.4 : 0.22));
    const toneGain = voice.context.createGain();
    toneGain.gain.setValueAtTime(big ? 0.12 : 0.06, t);
    toneGain.gain.exponentialRampToValueAtTime(0.0001, t + (big ? 0.45 : 0.24));
    voice.gain.gain.setValueAtTime(big ? 0.22 : 0.12, t);
    voice.gain.gain.exponentialRampToValueAtTime(0.0001, t + (big ? 0.5 : 0.28));
    src.connect(filter);
    filter.connect(voice.gain);
    tone.connect(toneGain);
    toneGain.connect(voice.gain);
    src.start(t);
    tone.start(t);
    src.stop(t + (big ? 0.52 : 0.3));
    tone.stop(t + (big ? 0.48 : 0.26));
    src.onended = () => {
      src.disconnect();
      filter.disconnect();
      tone.disconnect();
      toneGain.disconnect();
      voice.gain.disconnect();
    };
  }

  function thrust(on: boolean) {
    if (!ctx || !noise || !sfx) return;
    if (!thrustGain) {
      thrustGain = ctx.createGain();
      thrustGain.gain.value = 0;
      const filter = ctx.createBiquadFilter();
      filter.type = "bandpass";
      filter.frequency.value = 220;
      filter.Q.value = 0.7;
      thrustSrc = ctx.createBufferSource();
      thrustSrc.buffer = noise;
      thrustSrc.loop = true;
      thrustSrc.connect(filter);
      filter.connect(thrustGain);
      thrustGain.connect(sfx);
      thrustSrc.start();
    }
    if (on === thrustOn) return;
    thrustOn = on;
    thrustGain.gain.setTargetAtTime(on ? 0.07 : 0, ctx.currentTime, 0.04);
  }

  function ufo(on: boolean) {
    if (!ctx || !sfx) return;
    if (on) {
      if (ufoOsc) return;
      ufoOsc = ctx.createOscillator();
      ufoOsc.type = "square";
      ufoOsc.frequency.value = 480;
      const filter = ctx.createBiquadFilter();
      filter.type = "lowpass";
      filter.frequency.value = 1400;
      ufoGain = ctx.createGain();
      ufoGain.gain.value = 0;
      ufoOsc.connect(filter);
      filter.connect(ufoGain);
      ufoGain.connect(sfx);
      ufoOsc.start();
      ufoGain.gain.setTargetAtTime(0.028, ctx.currentTime, 0.05);
      return;
    }
    if (!ufoOsc || !ufoGain) return;
    const osc = ufoOsc;
    const gain = ufoGain;
    gain.gain.setTargetAtTime(0, ctx.currentTime, 0.03);
    const stopAt = ctx.currentTime + 0.12;
    osc.stop(stopAt);
    osc.onended = () => {
      osc.disconnect();
      gain.disconnect();
    };
    ufoOsc = null;
    ufoGain = null;
  }

  function ufoTone(freq: number) {
    if (!ctx || !ufoOsc) return;
    ufoOsc.frequency.setTargetAtTime(freq, ctx.currentTime, 0.02);
  }

  function hyper() {
    const voice = envGain(0.35);
    if (!voice) return;
    const osc = voice.context.createOscillator();
    osc.type = "sine";
    const t = voice.context.currentTime;
    osc.frequency.setValueAtTime(180, t);
    osc.frequency.exponentialRampToValueAtTime(1600, t + 0.22);
    voice.gain.gain.setValueAtTime(0.0001, t);
    voice.gain.gain.exponentialRampToValueAtTime(0.06, t + 0.04);
    voice.gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.32);
    osc.connect(voice.gain);
    osc.start(t);
    osc.stop(t + 0.34);
    osc.onended = () => {
      osc.disconnect();
      voice.gain.disconnect();
    };
  }

  function blip(freq: number, at: number, dur: number, vol: number) {
    if (!ctx || !sfx) return;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(freq, at);
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(vol, at + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    osc.connect(gain);
    gain.connect(sfx);
    osc.start(at);
    osc.stop(at + dur + 0.02);
    osc.onended = () => {
      osc.disconnect();
      gain.disconnect();
    };
  }

  function life() {
    if (!ctx) return;
    const t = ctx.currentTime;
    blip(523, t, 0.12, 0.06);
    blip(659, t + 0.1, 0.12, 0.06);
    blip(784, t + 0.2, 0.18, 0.07);
  }

  function beat(tense: boolean) {
    if (!ctx) return;
    blip(tense ? 196 : 128, ctx.currentTime, tense ? 0.07 : 0.05, tense ? 0.05 : 0.035);
  }

  function wave() {
    if (!ctx) return;
    const t = ctx.currentTime;
    blip(392, t, 0.14, 0.045);
    blip(523, t + 0.12, 0.2, 0.05);
  }

  function setMuted(next: boolean) {
    muted = next;
    if (master && ctx) master.gain.setTargetAtTime(next ? 0 : 0.85, ctx.currentTime, 0.03);
  }

  function dispose() {
    thrust(false);
    ufo(false);
    thrustSrc?.stop();
    thrustSrc?.disconnect();
    thrustGain?.disconnect();
    void ctx?.close();
    ctx = null;
  }

  return {
    unlock,
    resume: unlock,
    setMuted,
    shoot,
    explode,
    thrust,
    ufo,
    ufoTone,
    hyper,
    life,
    beat,
    wave,
    dispose,
  };
}
