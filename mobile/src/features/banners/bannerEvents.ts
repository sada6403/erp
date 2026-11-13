import { catalogApi } from '@/api/endpoints';

type Ev = { banner_id: string; type: 'impression' | 'tap' };
const seen = new Set<string>();
let queue: Ev[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;

function flush() {
  timer = null;
  const batch = queue.splice(0, 50);
  if (batch.length) catalogApi.bannerEvents({ events: batch }).catch(() => undefined);
  if (queue.length) timer = setTimeout(flush, 1000);
}

function push(e: Ev) {
  queue.push(e);
  if (!timer) timer = setTimeout(flush, 2000);
}

/** One impression per banner per app session; taps always. Fire-and-forget, no personal data. */
export function trackImpression(id: string) {
  if (seen.has(id)) return;
  seen.add(id);
  push({ banner_id: id, type: 'impression' });
}
export function trackTap(id: string) {
  push({ banner_id: id, type: 'tap' });
}
export function _resetBannerEvents() {
  seen.clear();
  queue = [];
  if (timer) clearTimeout(timer);
  timer = null;
}
