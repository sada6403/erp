/** "Few left" threshold: an in-stock item with this many units (or kg) or fewer shows an urgency badge. */
export const FEW_LEFT_MAX = 5;

/** The quantity to show in the "Only N left" badge, or null when the item is out of stock, unmanaged or plentiful. */
export function fewLeftQty(inStock: boolean, availableQty: number | null | undefined): number | null {
  if (!inStock || availableQty == null) return null;
  if (availableQty <= 0 || availableQty > FEW_LEFT_MAX) return null;
  return Math.round(availableQty * 100) / 100;
}
