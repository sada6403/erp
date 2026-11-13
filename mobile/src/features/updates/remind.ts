export const REMIND_AFTER_MS = 3 * 24 * 3600_000;

export interface Dismissed {
  version: string;
  at: number;
}

/** Pure: show the dismissible "New version available" sheet? Dismissed => hidden for 3 days; a newer version shows at once. */
export function shouldShowAvailable(latest: string, dismissed: Dismissed | null, now: number): boolean {
  if (!dismissed || dismissed.version !== latest) return true;
  return now - dismissed.at >= REMIND_AFTER_MS;
}
