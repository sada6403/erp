import { shouldShowAvailable } from '../src/features/updates/remind';
import { useUpdateCheck } from '../src/features/updates/updateCheck';

describe('manual update check', () => {
  const now = Date.now();
  it('a snoozed version stays hidden on its own', () => expect(shouldShowAvailable('1.0.0-test.9', { version: '1.0.0-test.9', at: now - 1000 }, now)).toBe(false));
  it('a newer version shows at once', () => expect(shouldShowAvailable('1.0.0-test.10', { version: '1.0.0-test.9', at: now - 1000 }, now)).toBe(true));
  it('the manual check flag can be set and cleared', () => {
    useUpdateCheck.getState().setForced(true);
    expect(useUpdateCheck.getState().forced).toBe(true);
    useUpdateCheck.getState().setForced(false);
    expect(useUpdateCheck.getState().forced).toBe(false);
  });
});
