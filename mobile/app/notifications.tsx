import React from 'react';
import { FlashList } from '@shopify/flash-list';
import { Pressable, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { NotificationDto } from '@contracts/notifications';
import { useTheme, radii } from '@/theme';
import { Text } from '@/components/Text';
import { Button } from '@/components/Button';
import { EmptyState, ErrorState, SkeletonList } from '@/components/ui';
import { OfflineBanner } from '@/components/Overlays';
import { useNotifications, useMarkRead } from '@/features/notifications/hooks';
import { openDeepLink } from '@/features/push/push';
import { selectIsLoggedIn, useSessionStore } from '@/store/sessionStore';
import { formatDate, formatTime } from '@/lib/format';

const ICON: Record<NotificationDto['channel'], string> = { orders: '📦', deliveries: '🛵', smartbuy: '💎', account: '👤', offers: '🏷️' };

/** Notifications inbox (modal). Tapping a row marks it read and follows its deep link. */
export default function NotificationsScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const loggedIn = useSessionStore(selectIsLoggedIn);
  const setPending = useSessionStore((s) => s.setPendingRoute);
  const { data, isLoading, isError, refetch } = useNotifications();
  const mark = useMarkRead();
  const items = data?.items ?? [];

  const open = (n: NotificationDto) => {
    if (!n.read) mark.mutate([n.id]);
    if (n.url) {
      router.back();
      openDeepLink(router, n.url, loggedIn, setPending);
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.surfaceSubtle, paddingTop: insets.top }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 16, backgroundColor: theme.colors.surface, borderBottomWidth: 1, borderBottomColor: theme.colors.surfaceBorder }}>
        <Text size={17} weight={800}>{t('notifications.title')}</Text>
        <View style={{ flexDirection: 'row', gap: 6 }}>
          {(data?.unread_count ?? 0) > 0 ? <Button label={t('notifications.markAll')} variant="secondarySm" onPress={() => mark.mutate(undefined)} /> : null}
          <Button label={t('common.close')} variant="secondarySm" onPress={() => router.back()} />
        </View>
      </View>
      <OfflineBanner />
      {isLoading ? (
        <View style={{ padding: 16 }}><SkeletonList rows={5} height={68} /></View>
      ) : isError && !data ? (
        <ErrorState onRetry={() => refetch()} />
      ) : items.length === 0 ? (
        <EmptyState icon="🔔" title={t('notifications.empty')} body={t('notifications.emptyBody')} />
      ) : (
        <FlashList
          data={items}
          keyExtractor={(n) => n.id}
          contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 16 }}
          ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
          renderItem={({ item: n }) => (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${n.title}. ${n.body}`}
              onPress={() => open(n)}
              style={{ minHeight: 64, flexDirection: 'row', gap: 12, padding: 12, borderRadius: radii.control, borderWidth: 1, borderColor: n.read ? theme.colors.surfaceBorder : theme.colors.primary, backgroundColor: n.read ? theme.colors.surface : theme.colors.container }}
            >
              <Text size={22}>{ICON[n.channel]}</Text>
              <View style={{ flex: 1 }}>
                <Text size={13} weight={n.read ? 600 : 800}>{n.title}</Text>
                <Text size={12} color="textMuted" style={{ marginTop: 2 }}>{n.body}</Text>
                <Text size={10} color="textSubtle" style={{ marginTop: 4 }}>{formatDate(n.created_at)} · {formatTime(n.created_at)}</Text>
              </View>
              {!n.read ? <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: theme.colors.primary, marginTop: 6 }} /> : null}
            </Pressable>
          )}
        />
      )}
    </View>
  );
}
