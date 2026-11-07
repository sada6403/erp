/* eslint-disable import/namespace -- expo-notifications re-exports AndroidImportance; the plugin cannot see it */
import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import Constants from 'expo-constants';
import type { useRouter } from 'expo-router';
import { deviceApi } from '@/api/endpoints';
import { ENV } from '@/lib/env';
import { readJson, storage, writeJson } from '@/lib/storage';

type Router = ReturnType<typeof useRouter>;

/** Android channels (ARCHITECTURE section 8.1). Users can mute each one in phone settings. */
export const CHANNELS = [
  { id: 'orders', name: 'Orders', importance: Notifications.AndroidImportance.HIGH },
  { id: 'deliveries', name: 'Deliveries', importance: Notifications.AndroidImportance.HIGH },
  { id: 'smartbuy', name: 'Smart Buy', importance: Notifications.AndroidImportance.HIGH },
  { id: 'account', name: 'Account', importance: Notifications.AndroidImportance.HIGH },
  { id: 'offers', name: 'Offers', importance: Notifications.AndroidImportance.DEFAULT },
] as const;

const TOKEN_KEY = 'np-push-token';
const REGISTERED_VERSION_KEY = 'np-push-registered-version';

export function getStoredPushToken(): string | null {
  return readJson<string | null>(TOKEN_KEY, null);
}
export function clearStoredPushToken() {
  storage.removeItem(TOKEN_KEY);
  storage.removeItem(REGISTERED_VERSION_KEY);
}

export async function setupNotifications() {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({ shouldShowBanner: false, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false }),
  });
  if (Platform.OS === 'android') {
    await Promise.all(
      CHANNELS.map((c) =>
        Notifications.setNotificationChannelAsync(c.id, { name: c.name, importance: c.importance, sound: 'default', vibrationPattern: [0, 250, 250, 250] }),
      ),
    );
  }
}

export async function getPermissionStatus(): Promise<'granted' | 'denied' | 'undetermined'> {
  const p = await Notifications.getPermissionsAsync();
  return p.granted ? 'granted' : p.canAskAgain ? 'undetermined' : 'denied';
}

/** Ask for permission (Android 13+ POST_NOTIFICATIONS) - call only after the explainer screen. */
export async function requestPermission(): Promise<boolean> {
  const p = await Notifications.requestPermissionsAsync();
  return p.granted;
}

/** Get the Expo push token and register it with the backend. Re-register on login, token change, version change. */
export async function registerDevice(): Promise<string | null> {
  if (!Device.isDevice) return null;
  const perm = await Notifications.getPermissionsAsync();
  if (!perm.granted) return null;
  const projectId = (Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined)?.eas?.projectId;
  if (!projectId) return null; // EAS project not configured yet (Moni creates the Expo account)
  const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId });
  const sameToken = getStoredPushToken() === token;
  const sameVersion = readJson<string | null>(REGISTERED_VERSION_KEY, null) === ENV.appVersion;
  if (sameToken && sameVersion) return token;
  await deviceApi.register({ expo_push_token: token, platform: 'android', app_version: ENV.appVersion, device_label: Device.modelName ?? undefined });
  writeJson(TOKEN_KEY, token);
  writeJson(REGISTERED_VERSION_KEY, ENV.appVersion);
  return token;
}

/** naturalplantation://orders/ONL-1023 or lankahome://orders/... -> /orders/ONL-1023 */
export function deepLinkToPath(url: string | null | undefined): string | null {
  if (!url) return null;
  const m = url.match(/^[a-z][a-z0-9+.-]*:\/\/(.*)$/i);
  const rest = m ? m[1] : url;
  const path = `/${rest.replace(/^\/+/, '')}`;
  return path === '/' ? '/' : path;
}

/** Open a notification's deep link; logged-out users go to login first and continue afterwards. */
export function openDeepLink(router: Router, url: string | null | undefined, loggedIn: boolean, setPending: (p: string | null) => void) {
  const path = deepLinkToPath(url);
  if (!path) return;
  if (!loggedIn) {
    setPending(path);
    router.push('/login');
    return;
  }
  router.push(path as never);
}
