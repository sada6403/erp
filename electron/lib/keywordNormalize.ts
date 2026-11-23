export function normalizeKeyword(value: string): string {
  return value.normalize('NFC').replace(/[\u200b-\u200d\ufeff]/g, '').toLowerCase().replace(/\s+/gu, ' ').trim()
}
export function foldTanglish(value: string) { return normalizeKeyword(value).replace(/aa+/g, 'a').replace(/ee+/g, 'i') }
