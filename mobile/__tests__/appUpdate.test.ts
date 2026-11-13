import { compareVersions } from '../src/lib/format';
import { assertInstallable, isSha256, sha256Matches, toHex } from '../src/features/updates/apkVerify';
import { REMIND_AFTER_MS, shouldShowAvailable } from '../src/features/updates/remind';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { declaresInstallPermission } = require('../scripts/check-play-manifest.cjs') as { declaresInstallPermission: (xml: string) => boolean };

describe('version compare (semver with test pre-releases)', () => {
  it('orders test builds numerically and puts the release last', () => {
    expect(compareVersions('1.0.0-test.5', '1.0.0-test.6')).toBeLessThan(0);
    expect(compareVersions('1.0.0-test.9', '1.0.0-test.10')).toBeLessThan(0);
    expect(compareVersions('1.0.0-test.10', '1.0.0')).toBeLessThan(0);
    expect(compareVersions('1.0.0', '1.0.0-test.1')).toBeGreaterThan(0);
    expect(compareVersions('1.0.1', '1.0.0')).toBeGreaterThan(0);
    expect(compareVersions('1.2', '1.2.0')).toBe(0);
    expect(compareVersions('1.0.0-test.6', '1.0.0-test.6')).toBe(0);
  });
});

describe('APK checksum helpers', () => {
  const hex = 'a'.repeat(64);
  it('hex-encodes bytes and compares case-insensitively', () => {
    expect(toHex(new Uint8Array([0, 15, 255]))).toBe('000fff');
    expect(sha256Matches(hex.toUpperCase(), hex)).toBe(true);
    expect(sha256Matches('b'.repeat(64), hex)).toBe(false);
    expect(isSha256('xyz')).toBe(false);
  });
  it('refuses non-https urls and a missing checksum', () => {
    expect(() => assertInstallable('http://x/app.apk', hex)).toThrow('UPDATE_URL_INVALID');
    expect(() => assertInstallable(null, hex)).toThrow('UPDATE_URL_INVALID');
    expect(() => assertInstallable('https://x/app.apk', null)).toThrow('UPDATE_CHECKSUM_MISSING');
    expect(assertInstallable('https://x/app.apk', hex.toUpperCase())).toEqual({ url: 'https://x/app.apk', sha256: hex });
  });
});

describe('"New version available" reminder', () => {
  const now = 1_000_000_000_000;
  it('shows again after 3 days, immediately for a newer version', () => {
    expect(shouldShowAvailable('1.0.0-test.7', null, now)).toBe(true);
    expect(shouldShowAvailable('1.0.0-test.7', { version: '1.0.0-test.7', at: now - 1000 }, now)).toBe(false);
    expect(shouldShowAvailable('1.0.0-test.7', { version: '1.0.0-test.7', at: now - REMIND_AFTER_MS }, now)).toBe(true);
    expect(shouldShowAvailable('1.0.0-test.8', { version: '1.0.0-test.7', at: now - 1000 }, now)).toBe(true);
  });
});

describe('Play manifest guard', () => {
  it('flags REQUEST_INSTALL_PACKAGES, ignores a tools:node="remove" declaration', () => {
    expect(declaresInstallPermission('<manifest><uses-permission android:name="android.permission.REQUEST_INSTALL_PACKAGES"/></manifest>')).toBe(true);
    expect(declaresInstallPermission('<manifest><uses-permission android:name="android.permission.INTERNET"/></manifest>')).toBe(false);
    expect(declaresInstallPermission('<manifest><uses-permission android:name="android.permission.REQUEST_INSTALL_PACKAGES" tools:node="remove"/></manifest>')).toBe(false);
  });
});
