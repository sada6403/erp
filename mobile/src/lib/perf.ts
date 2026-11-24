import { ENV } from './env';

/** Startup / post-login timing marks. Staging (test) builds only: `adb logcat -s ReactNativeJS | grep "\[perf\]"`. */
const ON = ENV.appEnv === 'staging';
export const perfNow = (): number => Date.now();
export function perf(label: string, since?: number): void {
  if (ON) console.log(`[perf] ${label}${since != null ? ` ${Date.now() - since}ms` : ''}`);
}
