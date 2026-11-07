import React, { useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';
import * as Notifications from 'expo-notifications';
import { useFonts } from 'expo-font';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import { I18nextProvider } from 'react-i18next';
import { ThemeProvider, fontAssets } from '@/theme';
import i18n, { initI18n } from '@/i18n';
import { persistOptions, queryClient, wireConnectivity } from '@/query/queryClient';
import { initSession, homeRouteFor } from '@/features/auth/session';
import { onReconnected } from '@/features/common/outbox';
import { useForceUpdate } from '@/features/common/hooks';
import { openDeepLink, setupNotifications } from '@/features/push/push';
import { applyOtaUpdate, checkForOtaUpdate } from '@/features/push/updates';
import { useSessionStore } from '@/store/sessionStore';
import { useUiStore } from '@/store/uiStore';
import { BuyLaterSheet, ToastHost, UpdateSnackbar } from '@/components/Overlays';
import { ForceUpdateScreen } from '@/features/common/ForceUpdateScreen';

SplashScreen.preventAutoHideAsync().catch(() => undefined);
initI18n();
initSession();

function Bootstrap() {
  const router = useRouter();
  const force = useForceUpdate();
  const user = useSessionStore((s) => s.user);
  const startedRef = useRef(false);

  // One-time startup: connectivity, notification channels, OTA check, role landing page.
  useEffect(() => {
    const unwire = wireConnectivity();
    setupNotifications().catch(() => undefined);
    checkForOtaUpdate(true);
    const sub = AppState.addEventListener('change', (st) => {
      if (st === 'active') checkForOtaUpdate();
    });
    // Reconnect: flush the outbox and fire the "Notify me" local notification.
    const unsub = useUiStore.subscribe((s, prev) => {
      if (s.netOnline && !prev.netOnline) {
        queryClient.resumePausedMutations().catch(() => undefined);
        queryClient.invalidateQueries();
        onReconnected();
      }
    });
    return () => {
      unwire();
      sub.remove();
      unsub();
    };
  }, []);

  // Landing page for returning users: forced password change, or the agent / Smart Buy home.
  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    if (user) {
      const path = homeRouteFor(user);
      if (path !== '/') setTimeout(() => router.replace(path as never), 0);
    }
  }, [router, user]);

  useEffect(() => {
    if (user?.must_change_password) router.replace('/set-password');
  }, [user?.must_change_password, router]);

  // Notification taps (warm + cold start) open the deep link.
  useEffect(() => {
    const open = (url?: unknown) => {
      const s = useSessionStore.getState();
      openDeepLink(router, typeof url === 'string' ? url : null, !!s.user, s.setPendingRoute);
    };
    const sub = Notifications.addNotificationResponseReceivedListener((r) => open(r.notification.request.content.data?.url));
    const received = Notifications.addNotificationReceivedListener(() => queryClient.invalidateQueries({ queryKey: ['me', 'notifications'] }));
    Notifications.getLastNotificationResponseAsync()
      .then((r) => r && open(r.notification.request.content.data?.url))
      .catch(() => undefined);
    return () => {
      sub.remove();
      received.remove();
    };
  }, [router]);

  if (force.required) return <ForceUpdateScreen latest={force.latest} apkUrl={force.apkUrl} />;

  return (
    <>
      <Stack screenOptions={{ headerShown: false, animation: 'fade' }}>
        <Stack.Screen name="notifications" options={{ presentation: 'modal', animation: 'slide_from_bottom' }} />
      </Stack>
      <BuyLaterSheet />
      <UpdateSnackbar onRestart={applyOtaUpdate} />
      <ToastHost />
    </>
  );
}

export default function RootLayout() {
  const [loaded] = useFonts(fontAssets);
  useEffect(() => {
    if (loaded) SplashScreen.hideAsync().catch(() => undefined);
  }, [loaded]);
  if (!loaded) return null;
  return (
    <SafeAreaProvider>
      <I18nextProvider i18n={i18n}>
        <ThemeProvider>
          <PersistQueryClientProvider client={queryClient} persistOptions={persistOptions}>
            <StatusBar style="dark" />
            <Bootstrap />
          </PersistQueryClientProvider>
        </ThemeProvider>
      </I18nextProvider>
    </SafeAreaProvider>
  );
}
