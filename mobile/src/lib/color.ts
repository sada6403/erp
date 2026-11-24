/** Colour interpolation helpers for the Gradient component (no gradient library needed). */

function parseHex(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const n = parseInt(full.slice(0, 6), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function lerpColor(from: string, to: string, t: number): string {
  const a = parseHex(from);
  const b = parseHex(to);
  const k = Math.min(1, Math.max(0, t));
  const ch = (i: number) => Math.round(a[i] + (b[i] - a[i]) * k);
  return `rgb(${ch(0)}, ${ch(1)}, ${ch(2)})`;
}
