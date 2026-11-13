import { isCriticalUpdate } from '../src/features/push/updates';

jest.mock('expo-updates', () => ({ isEnabled: true, isEmergencyLaunch: false }));

describe('OTA critical flag', () => {
  it('reads extra.critical from the expo manifest, in either position', () => {
    expect(isCriticalUpdate({ extra: { expoClient: { extra: { critical: true } } } })).toBe(true);
    expect(isCriticalUpdate({ extra: { critical: 'true' } })).toBe(true);
    expect(isCriticalUpdate({ extra: { expoClient: { extra: { critical: false } } } })).toBe(false);
    expect(isCriticalUpdate({})).toBe(false);
    expect(isCriticalUpdate(null)).toBe(false);
  });
});
