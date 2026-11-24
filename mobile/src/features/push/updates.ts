import * as Updates from 'expo-updates';
import { useUiStore } from '@/store/uiStore';

const MIN_GAP_MS = 30 * 60_000;
let lastCheck = 0;

/** An update is "critical" when it was published with extra.critical = true (eas update ... with EXPO_PUBLIC / app config extra, see docs/mobile-app/RELEASING.md). */
export function isCriticalUpdate(manifest: unknown): boolean {
  const m = manifest as { extra?: { expoClient?: { extra?: { critical?: unknown } }; critical?: unknown } } | null | undefined;
  const v = m?.extra?.expoClient?.extra?.critical ?? m?.extra?.critical;
  return v === true || v === 'true' || v === 1;
}

/**
 * OTA (JS-only) updates: check on launch and on foreground (max once per 30 min), download in the
 * background, then show the non-blocking "Update ready - Restart" banner. A critical update shows no
 * banner: it is already downloaded and applies on the next launch by itself.
 * Disabled in dev builds and when no update URL is set.
 */
export async function checkForOtaUpdate(force = false): Promise<void> {
  if (__DEV__ || !Updates.isEnabled) return;
  const now = Date.now();
  if (!force && now - lastCheck < MIN_GAP_MS) return;
  lastCheck = now;
  try {
    const res = await Updates.checkForUpdateAsync();
    if (!res.isAvailable) return;
    const fetched = await Updates.fetchUpdateAsync();
    if (fetched.isNew && !isCriticalUpdate(fetched.manifest)) useUiStore.getState().setUpdateReady(true);
  } catch {
    /* offline or server down: try again next foreground */
  }
}

export async function applyOtaUpdate(): Promise<void> {
  await Updates.reloadAsync();
}

/** True when expo-updates had to fall back to the embedded bundle because the downloaded one crashed at startup. */
export function launchedFromFallback(): boolean {
  return !__DEV__ && Updates.isEnabled && Updates.isEmergencyLaunch === true;
}
