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

/**
 * The server stores and sends UTC. Everything the user sees is Sri Lanka time (Asia/Colombo, UTC+05:30, no DST),
 * whatever the phone's own timezone is. A fixed offset avoids relying on Intl timezone data in Hermes.
 */
export const COLOMBO_OFFSET_MIN = 330;

/** Calendar parts of an instant, as read on a clock in Colombo. `month` is 0-11. */
export function colomboParts(value: string | number | Date | null | undefined): { year: number; month: number; day: number; hour: number; minute: number } | null {
  if (value == null || value === '') return null;
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  const c = new Date(d.getTime() + COLOMBO_OFFSET_MIN * 60_000);
  return { year: c.getUTCFullYear(), month: c.getUTCMonth(), day: c.getUTCDate(), hour: c.getUTCHours(), minute: c.getUTCMinutes() };
}

/** dd MMM yyyy (Colombo time) */
export function formatDate(value: string | number | Date | null | undefined): string {
  const p = colomboParts(value);
  return p ? `${pad(p.day)} ${MONTHS[p.month]} ${p.year}` : '';
}

/** hh:mm AM/PM (Colombo time) */
export function formatTime(value: string | number | Date | null | undefined): string {
  const p = colomboParts(value);
  if (!p) return '';
  const suffix = p.hour >= 12 ? 'PM' : 'AM';
  const h12 = p.hour % 12 === 0 ? 12 : p.hour % 12;
  return `${pad(h12)}:${pad(p.minute)} ${suffix}`;
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

/**
 * Compare versions like semver. Returns negative if a < b.
 * "1.0.0-test.5" < "1.0.0-test.6" < "1.0.0-test.10" < "1.0.0" (a release is newer than its pre-releases).
 */
export function compareVersions(a: string, b: string): number {
  const split = (v: string): [number[], string[]] => {
    const [core, pre] = v.trim().split(/-(.+)/);
    return [core.split('.').map((n) => parseInt(n, 10) || 0), pre ? pre.split('.') : []];
  };
  const [ca, pa] = split(a);
  const [cb, pb] = split(b);
  for (let i = 0; i < Math.max(ca.length, cb.length); i++) {
    const diff = (ca[i] ?? 0) - (cb[i] ?? 0);
    if (diff !== 0) return diff;
  }
  if (!pa.length && !pb.length) return 0;
  if (!pa.length) return 1;
  if (!pb.length) return -1;
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i];
    const y = pb[i];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    const nx = /^[0-9]+$/.test(x);
    const ny = /^[0-9]+$/.test(y);
    if (nx && ny) {
      const d = parseInt(x, 10) - parseInt(y, 10);
      if (d !== 0) return d;
    } else if (nx !== ny) return nx ? -1 : 1;
    else if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}
