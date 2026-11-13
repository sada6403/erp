import type { AuthUser, LoginResponse } from '@contracts/auth';
import { authApi, deviceApi } from '@/api/endpoints';
import { secureTokenStore } from '@/api/tokenStore';
import { setDeviceIdProvider, setSessionExpiredHandler } from '@/api/instance';
import { readJson, writeJson } from '@/lib/storage';
import { clearUserCache } from '@/query/queryClient';
import { useSessionStore, defaultRoleFor } from '@/store/sessionStore';
import { useCartStore } from '@/store/cartStore';
import { useCollectionStore } from '@/store/collectionStore';
import { useOutboxStore, uuid } from '@/store/outboxStore';
import { flushOutbox } from '@/features/common/outbox';
import i18n from '@/i18n';
import { useUiStore } from '@/store/uiStore';
import { getStoredPushToken, clearStoredPushToken } from '@/features/push/push';

const DEVICE_KEY = 'np-device-id';

/** Stable per-install id sent as device_id with login/refresh. */
export function getDeviceId(): string {
  let id = readJson<string | null>(DEVICE_KEY, null);
  if (!id) {
    id = uuid();
    writeJson(DEVICE_KEY, id);
  }
  return id;
}

export function initSession() {
  setDeviceIdProvider(getDeviceId);
  setSessionExpiredHandler((reason) => {
    clearUserCache();
    useSessionStore.getState().clear();
    if (reason === 'ACCOUNT_DISABLED' || reason === 'ACCOUNT_LOCKED') useUiStore.getState().showToast(i18n.t(`errors.${reason}`));
  });
}

/** Store tokens + profile after login/register/change-password. */
export async function applyAuth(res: Pick<LoginResponse, 'tokens' | 'user'>): Promise<AuthUser> {
  await secureTokenStore.set({ accessToken: res.tokens.access_token, refreshToken: res.tokens.refresh_token });
  useSessionStore.getState().setUser(res.user);
  return res.user;
}

export async function login(identifier: string, password: string): Promise<LoginResponse> {
  const res = await authApi.login({ identifier: identifier.trim(), password, device_id: getDeviceId() });
  await applyAuth(res);
  return res;
}

export async function register(input: { name: string; phone: string; password: string; email?: string }) {
  const res = await authApi.register({ ...input, device_id: getDeviceId() });
  await applyAuth(res);
  return res;
}

/** Cash receipts taken offline that the server has not seen yet. They are money records: never dropped by a logout. */
export const unsentCollections = (): number => useOutboxStore.getState().items.filter((i) => i.type === 'collection').length;

/** Returns false (and signs nobody out) while collections are still waiting to reach the server. */
export async function logout(): Promise<boolean> {
  if (unsentCollections() > 0) {
    await flushOutbox().catch(() => undefined);
    if (unsentCollections() > 0) return false;
  }
  const tokens = await secureTokenStore.get();
  const push = getStoredPushToken();
  try {
    await authApi.logout({ refresh_token: tokens?.refreshToken, expo_push_token: push ?? undefined });
  } catch {
    /* offline logout still signs out locally */
  }
  if (push) deviceApi.unregister({ expo_push_token: push }).catch(() => undefined);
  clearStoredPushToken();
  await secureTokenStore.clear();
  clearUserCache();
  useOutboxStore.getState().clear();
  useCollectionStore.getState().clear();
  useCartStore.getState().setCoupon(null);
  useSessionStore.getState().clear();
  return true;
}

/** Where to go after login: forced password change first, then the role's home. */
export function homeRouteFor(user: AuthUser): string {
  if (user.must_change_password) return '/set-password';
  const role = defaultRoleFor(user);
  if (role === 'agent') return '/deliveries';
  if (role === 'smartbuy') return '/schemes';
  return '/';
}
