import React from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { NotificationDto } from '@contracts/notifications';
import { useTheme, radii, shadows } from '@/theme';
import { Text } from '@/components/Text';
import { EmptyState, ErrorState, SkeletonList } from '@/components/ui';
import { useNotifications, useMarkRead } from '@/features/notifications/hooks';
import { openDeepLink } from '@/features/push/push';
import { selectIsLoggedIn, useSessionStore } from '@/store/sessionStore';
import { formatDate, formatTime } from '@/lib/format';

const ICON: Record<NotificationDto['channel'], string> = { orders: '📦', deliveries: '🛵', smartbuy: '💎', account: '👤', offers: '🏷️' };

/** Notifications inbox (#notifModal): bottom sheet over a dimmed screen. Tapping a row marks it read and follows its link. */
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
    <View style={[styles.overlay, { backgroundColor: theme.colors.overlay }]}>
      <Pressable style={StyleSheet.absoluteFill} onPress={() => router.back()} accessibilityLabel={t('common.close')} />
      <View
        style={[
          {
            backgroundColor: theme.colors.surface,
            borderTopLeftRadius: radii.sheet,
            borderTopRightRadius: radii.sheet,
            paddingTop: 16,
            paddingHorizontal: 20,
            paddingBottom: 24 + insets.bottom,
            maxHeight: '85%',
          },
          shadows.sheet,
        ]}
      >
        <View style={{ width: 40, height: 4, borderRadius: radii.xxs, backgroundColor: theme.colors.slate300, alignSelf: 'center', marginBottom: 12 }} />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('common.close')}
          onPress={() => router.back()}
          style={{ position: 'absolute', top: 8, right: 8, width: 48, height: 48, alignItems: 'center', justifyContent: 'center', zIndex: 2 }}
        >
          <View style={{ width: 32, height: 32, borderRadius: radii.circle, borderWidth: 1, borderColor: theme.colors.surfaceBorder, backgroundColor: theme.colors.surfaceSubtle, alignItems: 'center', justifyContent: 'center' }}>
            <Text size={14}>✕</Text>
          </View>
        </Pressable>

        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, paddingRight: 44 }}>
          <Text size={14} weight={800}>
            {t('notifications.inbox')}
          </Text>
          {(data?.unread_count ?? 0) > 0 ? (
            <Pressable accessibilityRole="button" accessibilityLabel={t('notifications.markAll')} hitSlop={12} onPress={() => mark.mutate(undefined)}>
              <Text size={11.5} weight={700} color="primary" style={{ textDecorationLine: 'underline' }}>
                {t('notifications.markAll')}
              </Text>
            </Pressable>
          ) : null}
        </View>

        {isLoading ? (
          <SkeletonList rows={4} height={68} />
        ) : isError && !data ? (
          <ErrorState onRetry={() => refetch()} />
        ) : items.length === 0 ? (
          <EmptyState icon="🔔" title={t('notifications.empty')} body={t('notifications.emptyBody')} />
        ) : (
          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
            {items.map((n) => (
              <Pressable
                key={n.id}
                accessibilityRole="button"
                accessibilityLabel={`${n.title}. ${n.body}`}
                onPress={() => open(n)}
                style={{
                  padding: 12,
                  flexDirection: 'row',
                  gap: 10,
                  borderRadius: radii.control,
                  borderLeftWidth: 3,
                  borderLeftColor: n.read ? theme.colors.primary : theme.colors.accent,
                  backgroundColor: n.read ? theme.colors.surfaceSubtle : theme.colors.container,
                }}
              >
                <Text size={20}>{ICON[n.channel]}</Text>
                <View style={{ flex: 1 }}>
                  <Text size={12} weight={700}>
                    {n.title}
                  </Text>
                  <Text size={11} color="textMuted" style={{ marginTop: 2 }}>
                    {n.body}
                  </Text>
                  <Text size={10} color="textSubtle" style={{ marginTop: 4 }}>
                    {formatDate(n.created_at)} · {formatTime(n.created_at)}
                  </Text>
                </View>
              </Pressable>
            ))}
          </ScrollView>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({ overlay: { flex: 1, justifyContent: 'flex-end' } });
