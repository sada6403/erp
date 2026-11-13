import React, { useCallback } from 'react';
import { View } from 'react-native';
import { Redirect, Tabs, useFocusEffect } from 'expo-router';
import { useTheme } from '@/theme';
import { useSessionStore, type NavRole } from '@/store/sessionStore';
import { useModules } from '@/features/common/hooks';
import { AppHeader, RoleTabBar } from './Shell';
import { OfflineBanner } from './Overlays';

/** Expo Router only renders routes declared in the navigator, so each role lists its screens. */
const SCREENS: Record<NavRole, string[]> = {
  customer: ['index', 'cart', 'catalog', 'checkout', 'categories', 'flash-deals', 'orders/index', 'smartbuy-promo', 'order-confirmed', 'orders/[id]', 'product/[id]'],
  smartbuy: ['schemes', 'draws', 'draw-video/[id]', 'wallet', 'spend', 'statement'],
  agent: ['deliveries/index', 'deliveries/[id]', 'members/index', 'add-member', 'commission', 'bill/index', 'bill/[id]', 'visits', 'team'],
};

/**
 * Shared layout for the (shop), (smartbuy) and (agent) groups: header, offline banner and a Tabs
 * navigator drawn with the role's own bottom navigation. Smartbuy/agent groups redirect when the
 * session lacks the role (the server enforces it too).
 */
export function RoleLayout({ role }: { role: NavRole }) {
  const theme = useTheme();
  const user = useSessionStore((s) => s.user);
  const setActiveRole = useSessionStore((s) => s.setActiveRole);
  const modules = useModules();

  useFocusEffect(
    useCallback(() => {
      setActiveRole(role);
    }, [role, setActiveRole]),
  );

  if (role !== 'customer') {
    if (!user) return <Redirect href="/login" />;
    if (!user.roles.includes(role)) return <Redirect href="/" />;
    if (role === 'smartbuy' && !modules.smartbuy) return <Redirect href="/" />;
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.surface }}>
      <AppHeader />
      <OfflineBanner />
      <Tabs
        backBehavior="history"
        tabBar={() => <RoleTabBar role={role} />}
        screenOptions={{ headerShown: false, sceneStyle: { backgroundColor: theme.colors.surfaceSubtle } }}
      >
        {SCREENS[role].map((name) => (
          <Tabs.Screen key={name} name={name} />
        ))}
      </Tabs>
    </View>
  );
}
