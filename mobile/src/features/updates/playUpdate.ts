import { Linking } from 'react-native';
import { ENV } from '@/lib/env';

/**
 * Play build: Google Play In-App Updates (IMMEDIATE when forced, FLEXIBLE otherwise).
 * The native wrapper (expo-in-app-updates) is added only after the owner approves it (AGENTS.md section 4);
 * until then, or if it is missing, we open the Play listing so a forced user is never stuck.
 */
export async function startPlayUpdate(forced: boolean): Promise<void> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('expo-in-app-updates') as { checkAndStartUpdate?: (immediate: boolean) => Promise<unknown> };
    if (mod.checkAndStartUpdate) {
      await mod.checkAndStartUpdate(forced);
      return;
    }
  } catch {
    /* library not installed in this build */
  }
  await Linking.openURL(`market://details?id=${ENV.androidPackage}`).catch(() => Linking.openURL(`https://play.google.com/store/apps/details?id=${ENV.androidPackage}`));
}
