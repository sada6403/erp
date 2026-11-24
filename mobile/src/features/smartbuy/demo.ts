import type { DrawDto } from '@contracts/smartbuy';
import { ENV } from '@/lib/env';

/**
 * True only in dev builds that run on the demo mock adapter. Features without a backend yet
 * (draw proof video, spend in shop, join request) are enabled only then; release builds render the
 * same UI disabled with "Coming in the next update". Production never shows mock data.
 */
export const SB_DEMO: boolean = ENV.useMocks;

/** Demo-only additive fields the dev mock puts on a draw (never sent by the real API). */
export interface DrawExtras {
  badge?: string;
  prize?: string;
  prize_value?: number;
  note?: string;
  avatar?: string;
  video?: { badge: string; stage: string; reveal: string } | null;
}

export type DrawView = DrawDto & DrawExtras;

/** Extras are honoured only on the demo mock; real draws render from the contract fields. */
export function drawExtras(d: DrawDto): DrawExtras {
  return SB_DEMO ? (d as DrawView) : {};
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** English month name of an ISO date (the demo badge is an upper-case English label). */
export function monthName(value: string): string {
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? '' : MONTHS[d.getMonth()];
}

export const DRAW_AVATARS = ['🥇', '🥈', '🥉'] as const;
