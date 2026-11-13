import { Linking } from 'react-native';
import { ENV } from '@/lib/env';

/**
 * Play build: Google Play In-App Updates (IMMEDIATE when forced, FLEXIBLE otherwise).
 * Native wrapper: expo-in-app-updates (approved, AGENTS.md section 4);
 * if it is missing from a build, we open the Play listing so a forced user is never stuck.
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
