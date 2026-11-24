import { ENV } from '@/lib/env';

/**
 * True only in a development build running against the dev mock adapter. Features that have no backend yet
 * (cash collection entry, Bluetooth printing, PDF commission slip) work against the mock here and render
 * disabled with "Coming in the next update" everywhere else. `__DEV__` is folded to false in release bundles.
 */
export const MOCK_FEATURES: boolean = __DEV__ && ENV.useMocks;
