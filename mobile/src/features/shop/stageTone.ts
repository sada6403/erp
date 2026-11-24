import type { OrderSummaryDto } from '@contracts/orders';

/** Badge colour tokens for a customer-facing order stage. */
export function stageTone(s: OrderSummaryDto['stage']): { bg: 'successBg' | 'errorBg' | 'warningBg'; fg: 'success' | 'error' | 'warningText' } {
  if (s === 'delivered') return { bg: 'successBg', fg: 'success' };
  if (s === 'cancelled') return { bg: 'errorBg', fg: 'error' };
  return { bg: 'warningBg', fg: 'warningText' };
}
