import type { AxiosAdapter, AxiosInstance } from 'axios';
import { API_PREFIX, ENV } from '@/lib/env';
import { useUiStore } from '@/store/uiStore';
import { createApiClient } from './client';
import { secureTokenStore } from './tokenStore';

let instance: AxiosInstance | null = null;
let sessionExpiredHandler: ((reason?: string) => void) | null = null;
let deviceIdProvider: (() => string | undefined) | undefined;

/** Registered by the session layer so the client can sign the user out when refresh is rejected. */
export function setSessionExpiredHandler(fn: ((reason?: string) => void) | null) {
  sessionExpiredHandler = fn;
}

export function setDeviceIdProvider(fn: (() => string | undefined) | undefined) {
  deviceIdProvider = fn;
}

export function getClient(): AxiosInstance {
  if (instance) return instance;
  let adapter: AxiosAdapter | undefined;
  // Dev-only mock adapter. Metro folds `__DEV__` to false in release bundles and drops this branch,
  // so src/dev never ships in a Play build.
  if (__DEV__ && ENV.useMocks) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    adapter = (require('../dev/mockAdapter') as typeof import('../dev/mockAdapter')).createMockAdapter();
  }
  instance = createApiClient({
    baseURL: `${ENV.apiBaseUrl}${API_PREFIX}`,
    appKey: ENV.appKey,
    appVersion: ENV.appVersion,
    tokens: secureTokenStore,
    deviceId: () => deviceIdProvider?.(),
    onSessionExpired: (reason) => sessionExpiredHandler?.(reason),
    onReachability: (ok) => useUiStore.getState().setServerReachable(ok),
    adapter,
  });
  return instance;
}
