import { AppState, type AppStateStatus } from 'react-native';
import NetInfo from '@react-native-community/netinfo';
import { focusManager, onlineManager, QueryClient } from '@tanstack/react-query';
import { createSyncStoragePersister } from '@tanstack/query-sync-storage-persister';
import { storage } from '@/lib/storage';
import { useUiStore } from '@/store/uiStore';
import { AppApiError } from '@/api/client';
import { API_PREFIX, ENV } from '@/lib/env';
import { shouldPersistQuery, USER_ROOTS } from './keys';

export const DAY_MS = 24 * 3600_000;
export const CACHE_MAX_AGE = 7 * DAY_MS;

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      networkMode: 'offlineFirst',
      staleTime: 60_000,
      gcTime: CACHE_MAX_AGE,
      retry: (count, error) => {
        // Do not hammer on auth / validation failures; retry transient network ones.
        if (error instanceof AppApiError && error.status && error.status < 500) return false;
        return count < 2;
      },
    },
    mutations: { networkMode: 'online' },
  },
});

export const persister = createSyncStoragePersister({
  storage: { getItem: storage.getItem, setItem: storage.setItem, removeItem: storage.removeItem },
  key: 'np-query-cache',
  throttleTime: 1000,
});

export const persistOptions = {
  persister,
  maxAge: CACHE_MAX_AGE,
  buster: '1',
  dehydrateOptions: {
    shouldDehydrateQuery: (q: { queryKey: readonly unknown[]; state: { status: string } }) =>
      q.state.status === 'success' && shouldPersistQuery(q.queryKey),
  },
};

let wired = false;

/** NetInfo -> onlineManager + ui store; AppState -> focusManager. Call once at startup. */
export function wireConnectivity(): () => void {
  if (wired) return () => undefined;
  wired = true;

  // Probe our own light /status endpoint, not Google's generate_204 (blocked or rewritten on some mobile networks).
  // Any HTTP answer below 500 (401 without a key is fine) means the network works. NetInfo also re-checks on app
  // foreground and on every network change; otherwise it polls at most once a minute, with a short timeout.
  NetInfo.configure({
    reachabilityUrl: `${ENV.apiBaseUrl}${API_PREFIX}/status`,
    reachabilityMethod: 'HEAD',
    reachabilityTest: async (response) => response.status < 500,
    reachabilityLongTimeout: 60_000,
    reachabilityShortTimeout: 60_000,
    reachabilityRequestTimeout: 8_000,
  });

  onlineManager.setEventListener((setOnline) => {
    return NetInfo.addEventListener((state) => {
      const online = !!state.isConnected && state.isInternetReachable !== false;
      setOnline(online);
      useUiStore.getState().setNetOnline(online);
    });
  });

  const sub = AppState.addEventListener('change', (status: AppStateStatus) => {
    focusManager.setFocused(status === 'active');
  });
  return () => {
    sub.remove();
    wired = false;
  };
}

/** Drop everything tied to the signed-in user (logout / expired session). Catalog cache is kept. */
export function clearUserCache() {
  for (const root of USER_ROOTS) queryClient.removeQueries({ queryKey: [root] });
}
