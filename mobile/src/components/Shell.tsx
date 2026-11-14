import React, { useEffect } from 'react';
import { perf } from '@/lib/perf';
import { Image } from 'expo-image';
import { Pressable, RefreshControl, ScrollView, View, useWindowDimensions, type StyleProp, type ViewStyle } from 'react-native';
import { usePathname, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { makeStyles, radii, shadows, useTheme, BOTTOM_NAV_HEIGHT } from '@/theme';
import { cartLineCount, useCartStore } from '@/store/cartStore';
import { selectIsLoggedIn, useSessionStore, type NavRole } from '@/store/sessionStore';
import { useUnreadCount } from '@/features/notifications/hooks';
import { useCompany } from '@/features/common/hooks';
import { useIsStaff } from '@/features/staff/hooks';
import { Text } from './Text';
import { OfflineBanner } from './Overlays';

const logo = require('../../assets/logo.jpg');

const useHeaderStyles = makeStyles((t) => ({
  bar: {
    paddingHorizontal: 16,
    paddingBottom: 8,
    backgroundColor: t.colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: t.colors.divider,
  },
  top: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  avatar: {
    width: 42,
    height: 42,
    borderRadius: 21,
    overflow: 'hidden',
    backgroundColor: t.colors.surface,
    borderWidth: 1.5,
    borderColor: t.colors.surfaceBorder,
    ...shadows.avatarLogo,
  },
  right: { flexDirection: 'row', alignItems: 'center', gap: 8 },
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
  account: {
    width: 88,
    height: 40,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingHorizontal: 6,
    backgroundColor: t.colors.container,
    borderWidth: 1.5,
    borderColor: t.colors.primary,
    borderRadius: radii.pill,
  },
  initial: { width: 26, height: 26, borderRadius: 13, backgroundColor: t.colors.primary, alignItems: 'center', justifyContent: 'center' },
}));

export const HEADER_LOGO = 42;
export const HEADER_ICON = 40;
export const HEADER_ACCOUNT_W = 88;
const HEADER_GAP = 8;
const NAME_MAX = 17;
const NAME_MIN = 12;

/** Splits a name into at most two balanced lines at the space nearest the middle. One word stays on one line. */
export function splitName(name: string): [string, string?] {
  const n = name.trim().replace(/\s+/g, ' ');
  const spaces: number[] = [];
  for (let i = 0; i < n.length; i++) if (n[i] === ' ') spaces.push(i);
  if (spaces.length === 0) return [n];
  const mid = n.length / 2;
  const at = spaces.reduce((best, i) => (Math.abs(i - mid) < Math.abs(best - mid) ? i : best), spaces[0]);
  return [n.slice(0, at), n.slice(at + 1)];
}

/** Largest font (NAME_MIN..NAME_MAX) at which the longest line fits the width; never truncates with an ellipsis. */
export function nameFontSize(lines: string[], width: number): number {
  const longest = Math.max(1, ...lines.map((l) => l.length));
  return Math.max(NAME_MIN, Math.min(NAME_MAX, Math.floor(width / (longest * 0.62))));
}

/** App header, one row: [logo] [name, 2 lines] ... [bell] [Login | account]. Fixed sizes so the name never moves. */
export function AppHeader() {
  useEffect(() => perf('header:mounted'), []);
  const s = useHeaderStyles();
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { width } = useWindowDimensions();
  const user = useSessionStore((x) => x.user);
  const loggedIn = useSessionStore(selectIsLoggedIn);
  const unread = useUnreadCount();
  const company = useCompany();
  const lines = splitName(company?.name || t('app.name')).filter(Boolean) as string[];
  const nameW = width - 32 - HEADER_LOGO - HEADER_ICON - HEADER_ACCOUNT_W - HEADER_GAP * 3;
  const fs = nameFontSize(lines, nameW);
  const initial = (user?.name || user?.phone || '?').trim().charAt(0).toUpperCase();
  const first = (user?.name || '').trim().split(/\s+/)[0];
  return (
    <View style={[s.bar, { paddingTop: Math.max(8, insets.top) }]}>
      <View style={s.top}>
        <View style={s.avatar}>
          <Image source={logo} style={{ width: '100%', height: '100%' }} contentFit="cover" accessibilityLabel={t('app.name')} />
        </View>
        <View style={{ flex: 1, minWidth: 0 }} testID="header-company-name">
          {lines.map((l, i) => (
            <Text key={i} size={fs} weight={800} color="primary" numberOfLines={1} lineHeightRatio={1.15}>
              {l}
            </Text>
          ))}
        </View>
        <Pressable accessibilityRole="button" testID="header-bell" accessibilityLabel={t('header.notifications')} hitSlop={4} onPress={() => (loggedIn ? router.push('/notifications') : router.push('/login'))} style={{ width: HEADER_ICON }}>
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
        {loggedIn ? (
          <Pressable accessibilityRole="button" testID="header-account" accessibilityLabel={t('header.account')} style={s.account} onPress={() => router.push('/settings')}>
            <View style={s.initial}>
              <Text size={13} weight={800} color="white">
                {initial}
              </Text>
            </View>
            <Text size={11.5} weight={700} color="primary" numberOfLines={1} style={{ flex: 1 }}>
              {first || t('header.account')}
            </Text>
          </Pressable>
        ) : (
          <Pressable accessibilityRole="button" testID="header-login" accessibilityLabel={t('header.login')} style={s.account} onPress={() => router.push('/login')}>
            <Text size={12} weight={800} color="primary" numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.75} align="center" style={{ flex: 1 }}>
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
  /** shown only to accounts the server placed on the sales hierarchy */
  staffOnly?: boolean;
}

export const NAV_ITEMS: Record<NavRole, NavItem[]> = {
  customer: [
    { key: 'shop', icon: '🌾', labelKey: 'nav.groceries', href: '/', match: ['/', '/product', '/catalog', '/flash-deals', '/smartbuy-promo', '/join', '/join-requests'] },
    { key: 'categories', icon: '🏷️', labelKey: 'nav.categories', href: '/categories', match: ['/categories'] },
    { key: 'cart', icon: '🛒', labelKey: 'nav.cart', href: '/cart', match: ['/cart', '/checkout'] },
    { key: 'orders', icon: '📦', labelKey: 'nav.orders', href: '/orders', match: ['/orders', '/order-confirmed'] },
    { key: 'settings', icon: '⚙️', labelKey: 'nav.settings', href: '/settings', match: ['/settings'] },
  ],
  smartbuy: [
    { key: 'schemes', icon: '💎', labelKey: 'nav.mySchemes', href: '/schemes', match: ['/schemes', '/statement', '/join', '/join-requests'] },
    { key: 'draws', icon: '🏆', labelKey: 'nav.drawVideos', href: '/draws', match: ['/draws', '/draw-video'] },
    { key: 'wallet', icon: '💰', labelKey: 'nav.passbook', href: '/wallet', match: ['/wallet'] },
    { key: 'spend', icon: '🛒', labelKey: 'nav.spendShop', href: '/spend', match: ['/spend'] },
    { key: 'settings', icon: '⚙️', labelKey: 'nav.settings', href: '/settings', match: ['/settings'] },
  ],
  manager: [
    { key: 'dash', icon: '📊', labelKey: 'mgr.nav.dashboard', href: '/mgr-dashboard', match: ['/mgr-dashboard'] },
    { key: 'team', icon: '👥', labelKey: 'mgr.nav.team', href: '/mgr-team', match: ['/mgr-team', '/mgr-person'] },
    { key: 'me', icon: '🙋', labelKey: 'mgr.nav.me', href: '/mgr-me', match: ['/mgr-me', '/settings'] },
  ],
  agent: [
    { key: 'deliveries', icon: '🛵', labelKey: 'nav.deliveries', href: '/deliveries', match: ['/deliveries'] },
    { key: 'members', icon: '👥', labelKey: 'nav.members', href: '/members', match: ['/members', '/add-member'] },
    { key: 'visits', icon: '📍', labelKey: 'nav.visits', href: '/visits', match: ['/visits'] },
    { key: 'team', icon: '🎯', labelKey: 'nav.team', href: '/team', match: ['/team'], staffOnly: true },
    { key: 'earnings', icon: '📊', labelKey: 'nav.earnings', href: '/commission', match: ['/commission', '/bill'] },
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
  const isStaff = useIsStaff();
  const { width } = useWindowDimensions();
  const items = NAV_ITEMS[role].filter((i) => !i.staffOnly || isStaff);
  const tabWidth = Math.min(62, Math.floor((width - 12) / items.length));
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
      {items.map((item) => {
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
              width: tabWidth,
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
  gap = 14,
}: {
  children: React.ReactNode;
  onRefresh?: () => void;
  refreshing?: boolean;
  contentStyle?: StyleProp<ViewStyle>;
  padded?: boolean;
  gap?: number;
}) {
  const theme = useTheme();
  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: theme.colors.surfaceSubtle }}
      contentContainerStyle={[{ padding: padded ? 16 : 0, paddingBottom: padded ? 40 : 24, gap }, contentStyle]}
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
