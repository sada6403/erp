import { ENV } from '@/lib/env';

/**
 * The demo's single promo code. Production has no coupon endpoint yet, so the coupon UI is drawn but disabled
 * ("Coming in the next update") and never sends anything. With dev mocks it applies the demo's Rs 500 off, shown
 * as a display-only line (totals still come from the quote).
 */
export const DEV_COUPON = { code: 'PLANT2026', amount: 500 } as const;
export const couponAvailable = __DEV__ && ENV.useMocks;
