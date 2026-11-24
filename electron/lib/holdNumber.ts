export function manualHoldNumber(value: unknown): string {
  if (typeof value !== 'string' || !/^\d{1,12}$/.test(value.trim())) throw new Error('Enter a hold number using 1–12 digits')
  return value.trim()
}
