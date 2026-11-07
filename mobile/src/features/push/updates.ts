import * as Updates from 'expo-updates';
import { useUiStore } from '@/store/uiStore';

const MIN_GAP_MS = 30 * 60_000;
let lastCheck = 0;

/**
 * OTA (JS-only) updates: check on launch and on foreground (max once per 30 min), download in the
 * background, then show "Update ready - Restart". Disabled in dev builds and when no update URL is set.
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
    if (fetched.isNew) useUiStore.getState().setUpdateReady(true);
  } catch {
    /* offline or server down: try again next foreground */
  }
}

export async function applyOtaUpdate(): Promise<void> {
  await Updates.reloadAsync();
}
