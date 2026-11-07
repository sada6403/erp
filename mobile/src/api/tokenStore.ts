import * as SecureStore from 'expo-secure-store';
import type { StoredTokens, TokenStore } from './client';

const ACCESS = 'np_access_token';
const REFRESH = 'np_refresh_token';

let cache: StoredTokens | null | undefined;

/** Tokens live in expo-secure-store (Android Keystore) with an in-memory cache. Never in MMKV. */
export const secureTokenStore: TokenStore = {
  async get() {
    if (cache !== undefined) return cache;
    try {
      const [accessToken, refreshToken] = await Promise.all([
        SecureStore.getItemAsync(ACCESS),
        SecureStore.getItemAsync(REFRESH),
      ]);
      cache = accessToken && refreshToken ? { accessToken, refreshToken } : null;
    } catch {
      cache = null;
    }
    return cache;
  },
  async set(tokens) {
    cache = tokens;
    await Promise.all([
      SecureStore.setItemAsync(ACCESS, tokens.accessToken),
      SecureStore.setItemAsync(REFRESH, tokens.refreshToken),
    ]);
  },
  async clear() {
    cache = null;
    await Promise.all([SecureStore.deleteItemAsync(ACCESS), SecureStore.deleteItemAsync(REFRESH)]).catch(() => undefined);
  },
};
