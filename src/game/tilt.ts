/** Portrait: gamma is left/right. Landscape swaps onto beta. Positive = tilted right. */
export function steerFromOrientation(event: DeviceOrientationEvent): number {
  const angle =
    window.screen?.orientation?.angle ??
    (window as unknown as { orientation?: number }).orientation ??
    0;
  let raw = event.gamma ?? 0;
  if (angle === 90) raw = event.beta ?? 0;
  else if (angle === 270 || angle === -90) raw = -(event.beta ?? 0);

  const dead = 8;
  const mag = Math.abs(raw);
  if (mag < dead) return 0;
  const signed = Math.sign(raw) * (mag - dead);
  return clamp(-signed / 20, -1, 1);
}

function clamp(v: number, min: number, max: number) {
  return Math.max(min, Math.min(max, v));
}
