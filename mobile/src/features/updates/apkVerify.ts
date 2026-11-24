/** Pure helpers for the test-build APK self-update (no native modules, unit-tested). */

export function toHex(bytes: ArrayBuffer | Uint8Array): string {
  const u = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let out = '';
  for (let i = 0; i < u.length; i++) out += u[i].toString(16).padStart(2, '0');
  return out;
}

export const isSha256 = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f]{64}$/i.test(v);

export function sha256Matches(actualHex: string, expectedHex: string): boolean {
  return isSha256(expectedHex) && actualHex.toLowerCase() === expectedHex.toLowerCase();
}

/** Only https downloads are accepted; the checksum must come from /status. */
export function assertInstallable(url: string | null | undefined, sha256: string | null | undefined): { url: string; sha256: string } {
  if (!url || !/^https:\/\//i.test(url)) throw new Error('UPDATE_URL_INVALID');
  if (!isSha256(sha256)) throw new Error('UPDATE_CHECKSUM_MISSING');
  return { url, sha256: sha256.toLowerCase() };
}
