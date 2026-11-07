import React from 'react';
import { Image } from 'expo-image';
import { Pressable, RefreshControl, ScrollView, View, type StyleProp, type ViewStyle } from 'react-native';
import { usePathname, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { makeStyles, radii, useTheme, BOTTOM_NAV_HEIGHT } from '@/theme';
import { cartLineCount, useCartStore } from '@/store/cartStore';
import { selectIsLoggedIn, useSessionStore, type NavRole } from '@/store/sessionStore';
import { useUiStore } from '@/store/uiStore';
import { useUnreadCount } from '@/features/notifications/hooks';
import { logout } from '@/features/auth/session';
import { Text } from './Text';
import { OfflineBanner } from './Overlays';

const logo = require('../../assets/logo.jpg');

const useHeaderStyles = makeStyles((t) => ({
  bar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingBottom: 10,
    backgroundColor: t.colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: t.colors.divider,
  },
  left: { flexDirection: 'row', alignItems: 'center', gap: 10, flexShrink: 1 },
  avatar: {
    width: 42,
    height: 42,
    borderRadius: 21,
    overflow: 'hidden',
    backgroundColor: t.colors.surface,
    borderWidth: 1.5,
    borderColor: t.colors.surfaceBorder,
  },
  right: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  iconBtnHit: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center' },
  iconBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: t.colors.surfaceBorder,
    backgroundColor: t.colors.surfaceSubtle,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badge: {
    position: 'absolute',
    top: -2,
    right: -2,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    paddingHorizontal: 3,
    backgroundColor: t.colors.error,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loginBtn: {
    minHeight: 38,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 6,
    backgroundColor: t.colors.container,
    borderWidth: 1.5,
    borderColor: t.colors.primary,
    borderRadius: radii.pill,
  },
  userBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: t.colors.surfaceSubtle,
    borderWidth: 1.5,
    borderColor: t.colors.surfaceBorder,
    paddingVertical: 3,
    paddingLeft: 10,
    paddingRight: 6,
    borderRadius: radii.pill,
  },
  logout: {
    minHeight: 32,
    justifyContent: 'center',
    backgroundColor: t.colors.surface,
    borderWidth: 1,
    borderColor: t.colors.surfaceBorder,
    paddingHorizontal: 8,
    borderRadius: radii.input,
  },
}));

function roleLabel(role: NavRole, agentCode: string | null | undefined, t: (k: string) => string): string {
  if (role === 'agent') return `🛵 ${t('role.agent')}${agentCode ? ` ${agentCode}` : ''}`;
  if (role === 'smartbuy') return `💎 ${t('role.smartbuy')}`;
  return `🛒 ${t('role.customer')}`;
}

/** App header: logo + title + branch tag, bell with unread badge, Login button or role chip + Logout. */
export function AppHeader() {
  const s = useHeaderStyles();
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const user = useSessionStore((x) => x.user);
  const loggedIn = useSessionStore(selectIsLoggedIn);
  const role = useSessionStore((x) => x.activeRole);
  const branch = useSessionStore((x) => x.branchName);
  const unread = useUnreadCount();
  const showToast = useUiStore((x) => x.showToast);
  return (
    <View style={[s.bar, { paddingTop: Math.max(8, insets.top) }]}>
      <View style={s.left}>
        <View style={s.avatar}>
          <Image source={logo} style={{ width: '100%', height: '100%' }} contentFit="cover" accessibilityLabel={t('app.name')} />
        </View>
        <View style={{ flexShrink: 1 }}>
          <Text size={17} weight={800} color="primary" numberOfLines={1} style={{ lineHeight: 20 }}>
            {t('app.name')}
          </Text>
          {branch ? (
            <Text size={11} weight={600} color="textMuted" numberOfLines={1}>
              {branch}
            </Text>
          ) : null}
        </View>
      </View>
      <View style={s.right}>
        <Pressable accessibilityRole="button" accessibilityLabel={t('header.notifications')} style={s.iconBtnHit} onPress={() => (loggedIn ? router.push('/notifications') : router.push('/login'))}>
          <View style={s.iconBtn}>
            <Text size={15}>🔔</Text>
            {unread > 0 ? (
              <View style={s.badge}>
                <Text size={9} weight={800} color="white">
                  {unread > 99 ? '99+' : unread}
                </Text>
              </View>
            ) : null}
          </View>
        </Pressable>
        {__DEV__ ? (
          <Pressable accessibilityRole="button" accessibilityLabel="Simulate push" style={s.iconBtnHit} onPress={() => showToast('Dev: simulated push')}>
            <View style={s.iconBtn}>
              <Text size={15}>⚡</Text>
            </View>
          </Pressable>
        ) : null}
        {loggedIn ? (
          <View style={s.userBadge}>
            <Text size={11} weight={800} color="primary" numberOfLines={1} style={{ maxWidth: 110 }}>
              {roleLabel(role, user?.agent_code, t)}
            </Text>
            <Pressable accessibilityRole="button" accessibilityLabel={t('header.logout')} style={s.logout} onPress={() => logout().then(() => router.replace('/'))}>
              <Text size={10} weight={800} color="textMuted">
                {t('header.logout')}
              </Text>
            </Pressable>
          </View>
        ) : (
          <Pressable accessibilityRole="button" accessibilityLabel={t('header.login')} style={s.loginBtn} onPress={() => router.push('/login')}>
            <Text size={12}>🔑</Text>
            <Text size={11.5} weight={800} color="primary">
              {t('header.login')}
            </Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

interface NavItem {
  key: string;
  icon: string;
  labelKey: string;
  href: string;
  /** path prefixes that keep this tab highlighted */
  match: string[];
}

export const NAV_ITEMS: Record<NavRole, NavItem[]> = {
  customer: [
    { key: 'shop', icon: '🌾', labelKey: 'nav.groceries', href: '/', match: ['/', '/product', '/catalog', '/flash-deals', '/smartbuy-promo'] },
    { key: 'categories', icon: '🏷️', labelKey: 'nav.categories', href: '/categories', match: ['/categories'] },
    { key: 'cart', icon: '🛒', labelKey: 'nav.cart', href: '/cart', match: ['/cart', '/checkout'] },
    { key: 'orders', icon: '📦', labelKey: 'nav.orders', href: '/orders', match: ['/orders', '/order-confirmed'] },
    { key: 'settings', icon: '⚙️', labelKey: 'nav.settings', href: '/settings', match: ['/settings'] },
  ],
  smartbuy: [
    { key: 'schemes', icon: '💎', labelKey: 'nav.mySchemes', href: '/schemes', match: ['/schemes', '/statement', '/join'] },
    { key: 'draws', icon: '🏆', labelKey: 'nav.drawVideos', href: '/draws', match: ['/draws', '/draw-video'] },
    { key: 'wallet', icon: '💰', labelKey: 'nav.passbook', href: '/wallet', match: ['/wallet'] },
    { key: 'spend', icon: '🛒', labelKey: 'nav.spendShop', href: '/spend', match: ['/spend'] },
    { key: 'settings', icon: '⚙️', labelKey: 'nav.settings', href: '/settings', match: ['/settings'] },
  ],
  agent: [
    { key: 'deliveries', icon: '🛵', labelKey: 'nav.deliveries', href: '/deliveries', match: ['/deliveries'] },
    { key: 'members', icon: '👥', labelKey: 'nav.members', href: '/members', match: ['/members'] },
    { key: 'earnings', icon: '📊', labelKey: 'nav.earnings', href: '/commission', match: ['/commission'] },
    { key: 'bill', icon: '🖨️', labelKey: 'nav.printBill', href: '/bill', match: ['/bill'] },
    { key: 'settings', icon: '⚙️', labelKey: 'nav.settings', href: '/settings', match: ['/settings'] },
  ],
};

export function isNavActive(item: NavItem, pathname: string): boolean {
  return item.match.some((m) => (m === '/' ? pathname === '/' : pathname === m || pathname.startsWith(`${m}/`)));
}

/** Role-specific bottom navigation (62 dp tabs, emoji icon + 10 px label, tinted active pill). */
export function RoleTabBar({ role }: { role: NavRole }) {
  const theme = useTheme();
  const { t } = useTranslation();
  const router = useRouter();
  const pathname = usePathname();
  const insets = useSafeAreaInsets();
  const count = useCartStore((s) => cartLineCount(s.lines));
  return (
    <View
      accessibilityRole="tablist"
      style={{
        height: BOTTOM_NAV_HEIGHT + insets.bottom,
        paddingBottom: Math.max(6, insets.bottom),
        paddingHorizontal: 6,
        flexDirection: 'row',
        justifyContent: 'space-around',
        alignItems: 'center',
        backgroundColor: theme.colors.surface,
        borderTopWidth: 1,
        borderTopColor: theme.colors.divider,
      }}
    >
      {NAV_ITEMS[role].map((item) => {
        const active = isNavActive(item, pathname);
        const label = t(item.labelKey);
        return (
          <Pressable
            key={item.key}
            accessibilityRole="tab"
            accessibilityLabel={label}
            accessibilityState={{ selected: active }}
            onPress={() => router.navigate(item.href as never)}
            style={{
              width: 62,
              minHeight: 48,
              borderRadius: radii.control,
              alignItems: 'center',
              justifyContent: 'center',
              gap: 3,
              backgroundColor: active ? theme.colors.navIndicator : theme.colors.transparent,
            }}
          >
            <View>
              <Text size={19}>{item.icon}</Text>
              {item.key === 'cart' && count > 0 ? (
                <View style={{ position: 'absolute', top: -4, right: -8, minWidth: 16, height: 16, borderRadius: 8, backgroundColor: theme.colors.primary, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 2 }}>
                  <Text size={9} weight={800} color="white">
                    {count}
                  </Text>
                </View>
              ) : null}
            </View>
            <Text size={10} weight={700} color={active ? 'navActive' : 'textMuted'} numberOfLines={1}>
              {label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** Scrollable content area (.app-viewport) with optional pull to refresh. */
export function Screen({
  children,
  onRefresh,
  refreshing,
  contentStyle,
  padded = true,
}: {
  children: React.ReactNode;
  onRefresh?: () => void;
  refreshing?: boolean;
  contentStyle?: StyleProp<ViewStyle>;
  padded?: boolean;
}) {
  const theme = useTheme();
  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: theme.colors.surfaceSubtle }}
      contentContainerStyle={[{ padding: padded ? 16 : 0, paddingBottom: 24, gap: 14 }, contentStyle]}
      keyboardShouldPersistTaps="handled"
      refreshControl={onRefresh ? <RefreshControl refreshing={!!refreshing} onRefresh={onRefresh} colors={[theme.colors.primary]} /> : undefined}
    >
      {children}
    </ScrollView>
  );
}

/** Header + offline banner + content + role tab bar, for screens outside the role tab groups. */
export function Frame({ children, tabs = true, header = true, role }: { children: React.ReactNode; tabs?: boolean; header?: boolean; role?: NavRole }) {
  const active = useSessionStore((s) => s.activeRole);
  const insets = useSafeAreaInsets();
  const theme = useTheme();
  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.surface, paddingTop: header ? 0 : insets.top }}>
      {header ? <AppHeader /> : null}
      <OfflineBanner />
      <View style={{ flex: 1 }}>{children}</View>
      {tabs ? <RoleTabBar role={role ?? active} /> : null}
    </View>
  );
}
