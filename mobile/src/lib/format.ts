/** Phone, date and relative-time helpers (no date library: keeps the bundle small). */

export function normalizePhone(input: string): string {
  const digits = input.replace(/\D/g, '');
  if (digits.startsWith('94') && digits.length === 11) return `0${digits.slice(2)}`;
  if (digits.length === 9) return `0${digits}`;
  return digits;
}

/** 0771234567 -> "077 123 4567". Non-phone input is returned unchanged. */
export function formatPhone(input: string): string {
  const d = normalizePhone(input);
  if (/^0\d{9}$/.test(d)) return `${d.slice(0, 3)} ${d.slice(3, 6)} ${d.slice(6)}`;
  return input;
}

export type IdentifierKind = 'phone' | 'member' | 'agent' | 'unknown';

/** The login field accepts a mobile number, a Smart Buy member number (NP-1042) or an agent code (NP-AG-204). */
export function classifyIdentifier(raw: string): IdentifierKind {
  const v = raw.trim().toUpperCase();
  if (!v) return 'unknown';
  if (/^NP-AG-?\d+$/.test(v)) return 'agent';
  if (/^NP-\d+$/.test(v)) return 'member';
  if (/^(\+?94|0)?7\d{8}$/.test(v.replace(/[\s-]/g, ''))) return 'phone';
  return 'unknown';
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

/** dd MMM yyyy */
export function formatDate(value: string | number | Date | null | undefined): string {
  if (value == null || value === '') return '';
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return `${pad(d.getDate())} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

/** hh:mm AM/PM */
export function formatTime(value: string | number | Date | null | undefined): string {
  if (value == null || value === '') return '';
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  const h = d.getHours();
  const suffix = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${pad(h12)}:${pad(d.getMinutes())} ${suffix}`;
}

export type AgeUnit = 'now' | 'minutes' | 'hours' | 'days';

/** Splits an age in ms into a unit + value; callers translate it ("updated 2 h ago"). */
export function splitAge(ms: number): { unit: AgeUnit; value: number } {
  const mins = Math.floor(ms / 60_000);
  if (mins < 1) return { unit: 'now', value: 0 };
  if (mins < 60) return { unit: 'minutes', value: mins };
  const hours = Math.floor(mins / 60);
  if (hours < 48) return { unit: 'hours', value: hours };
  return { unit: 'days', value: Math.floor(hours / 24) };
}

export function pad2(n: number): string {
  return pad(n);
}

/** Splits seconds into zero-padded HH / MM / SS for countdown boxes. */
export function splitCountdown(totalSeconds: number): { h: string; m: string; s: string } {
  const t = Math.max(0, Math.floor(totalSeconds));
  return { h: pad(Math.floor(t / 3600)), m: pad(Math.floor((t % 3600) / 60)), s: pad(t % 60) };
}

/** Compare dotted versions. Returns negative if a < b. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map((n) => parseInt(n, 10) || 0);
  const pb = b.split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}
