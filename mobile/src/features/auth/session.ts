import type { AuthUser, LoginResponse } from '@contracts/auth';
import { authApi, deviceApi } from '@/api/endpoints';
import { secureTokenStore } from '@/api/tokenStore';
import { setDeviceIdProvider, setSessionExpiredHandler } from '@/api/instance';
import { readJson, writeJson } from '@/lib/storage';
import { clearUserCache } from '@/query/queryClient';
import { useSessionStore, defaultRoleFor } from '@/store/sessionStore';
import { useCartStore } from '@/store/cartStore';
import { useOutboxStore, uuid } from '@/store/outboxStore';
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
  setSessionExpiredHandler(() => {
    clearUserCache();
    useSessionStore.getState().clear();
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

export async function logout(): Promise<void> {
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
  useCartStore.getState().setCoupon(null);
  useSessionStore.getState().clear();
}

/** Where to go after login: forced password change first, then the role's home. */
export function homeRouteFor(user: AuthUser): string {
  if (user.must_change_password) return '/set-password';
  const role = defaultRoleFor(user);
  if (role === 'agent') return '/deliveries';
  if (role === 'smartbuy') return '/schemes';
  return '/';
}
