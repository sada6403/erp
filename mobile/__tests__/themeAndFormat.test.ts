import { OliveYellow, PurplePink, themes, DEFAULT_THEME, TOUCH_TARGET, BOTTOM_NAV_HEIGHT } from '@/theme';
import { thisMonth } from '@/features/agent/month';
import { compareVersions, formatDate, formatTime, formatPhone, normalizePhone, classifyIdentifier, splitAge, splitCountdown } from '@/lib/format';
import { sha256Hex, verifyDeliveryOtp } from '@/lib/sha256';
import { lerpColor } from '@/lib/color';

describe('themes', () => {
  it('has the two approved palettes', () => {
    expect(OliveYellow.colors.primary).toBe('#5A6B2E');
    expect(OliveYellow.colors.accent).toBe('#F2C230');
    expect(PurplePink.colors.primary).toBe('#6B3FA0');
    expect(PurplePink.colors.accent).toBe('#C93A78');
    expect(Object.keys(themes).sort()).toEqual(['olive', 'purple']);
    expect(DEFAULT_THEME).toBe('olive');
  });

  it('shares status colours across themes and has full colour sets', () => {
    expect(OliveYellow.colors.error).toBe(PurplePink.colors.error);
    expect(OliveYellow.colors.success).toBe(PurplePink.colors.success);
    expect(Object.keys(OliveYellow.colors).sort()).toEqual(Object.keys(PurplePink.colors).sort());
  });

  it('keeps 48dp touch targets', () => {
    expect(TOUCH_TARGET).toBe(48);
    expect(BOTTOM_NAV_HEIGHT).toBeGreaterThanOrEqual(56);
  });

  it('interpolates colours for gradients', () => {
    expect(lerpColor('#000000', '#FFFFFF', 0.5)).toBe('rgb(128, 128, 128)');
  });
});

describe('format helpers', () => {
  it('formats dates dd MMM yyyy', () => {
    expect(formatDate('2026-11-07T06:00:00Z')).toBe('07 Nov 2026');
    expect(formatDate(null)).toBe('');
  });

  it('shows Sri Lanka time (UTC+05:30) for UTC timestamps, whatever the device timezone', () => {
    // 20:00 UTC on 7 Nov is already 01:30 on 8 Nov in Colombo.
    expect(formatDate('2026-11-07T20:00:00Z')).toBe('08 Nov 2026');
    expect(formatTime('2026-11-07T20:00:00Z')).toBe('01:30 AM');
    expect(formatTime('2026-11-07T06:30:00.000Z')).toBe('12:00 PM');
    expect(formatTime('2026-11-07T18:29:00Z')).toBe('11:59 PM');
    expect(thisMonth).toBeDefined();
  });

  it('normalises Sri Lankan phone numbers and classifies identifiers', () => {
    expect(normalizePhone('077 123 4567')).toBe('0771234567');
    expect(formatPhone('0771234567')).toMatch(/077/);
    expect(classifyIdentifier('0771234567')).toBe('phone');
    expect(classifyIdentifier('NP-1042')).toBe('member');
    expect(classifyIdentifier('NP-AG-204')).toBe('agent');
    expect(classifyIdentifier('hello')).toBe('unknown');
  });

  it('splits ages and countdowns', () => {
    expect(splitAge(10_000)).toEqual({ unit: 'now', value: 0 });
    expect(splitAge(5 * 60_000)).toEqual({ unit: 'minutes', value: 5 });
    expect(splitAge(3 * 3600_000)).toEqual({ unit: 'hours', value: 3 });
    expect(splitAge(72 * 3600_000)).toEqual({ unit: 'days', value: 3 });
    expect(splitCountdown(3725)).toEqual({ h: '01', m: '02', s: '05' });
  });

  it('compares versions', () => {
    expect(compareVersions('1.0.0', '1.0.1')).toBeLessThan(0);
    expect(compareVersions('1.10.0', '1.9.0')).toBeGreaterThan(0);
    expect(compareVersions('2.0', '2.0.0')).toBe(0);
  });
});

describe('sha256 + offline delivery OTP', () => {
  it('matches known vectors', () => {
    expect(sha256Hex('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });

  it('verifies a salted OTP hash and rejects wrong or malformed codes', () => {
    const hash = `s4lt$${sha256Hex('s4lt4821')}`;
    expect(verifyDeliveryOtp('4821', hash)).toBe(true);
    expect(verifyDeliveryOtp('4822', hash)).toBe(false);
    expect(verifyDeliveryOtp('48', hash)).toBe(false);
    expect(verifyDeliveryOtp('4821', null)).toBe(false);
  });
});
