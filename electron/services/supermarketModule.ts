/** Stock/profit opt-in is independent of the company industry and other modules. */
export function usesSupermarketStock(settings?: Record<string, unknown> | null): boolean {
  return String(settings?.business_type || '').trim().toLowerCase() === 'supermarket'
    || settings?.supermarket_stock_enabled === true
    || settings?.supermarket_stock_enabled === 1
}
