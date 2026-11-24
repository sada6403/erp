import React from 'react';
import { View } from 'react-native';
import { Redirect, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/Button';
import { Frame, Screen } from '@/components/Shell';
import { Text } from '@/components/Text';
import { Card, EmptyState, ErrorState, ScreenHeading, SkeletonList } from '@/components/ui';
import { useJoinRequests } from '@/features/smartbuy/hooks';
import { formatDate } from '@/lib/format';
import { useSessionStore } from '@/store/sessionStore';

/** "My Smart Buy requests": status of the join requests this account submitted (Pending / Approved / Rejected + reason). Cached for offline. */
export default function JoinRequestsScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const loggedIn = useSessionStore((s) => !!s.user);
  const requests = useJoinRequests();
  if (!loggedIn) return <Redirect href="/login" />;
  const items = requests.data?.items ?? [];
  const badge = (status: string, reason: string | null) =>
    status === 'approved' ? { text: t('joinReq.approvedMsg'), color: 'success' as const }
      : status === 'rejected' ? { text: t('joinReq.rejected', { reason: reason ?? '' }), color: 'error' as const }
        : { text: t('joinReq.pending'), color: 'warning' as const };
  return (
    <Frame>
      <Screen onRefresh={() => { void requests.refetch(); }} refreshing={requests.isRefetching}>
        <ScreenHeading title={t('joinReq.myRequestsTitle')} sub={t('joinReq.myRequestsSub')} />
        {requests.isLoading ? <SkeletonList rows={3} height={80} /> : requests.isError && !requests.data ? (
          <ErrorState onRetry={() => requests.refetch()} />
        ) : items.length === 0 ? (
          <EmptyState icon={'📝'} title={t('joinReq.empty')} actionLabel={t('join.title')} onAction={() => router.push('/join')} />
        ) : (
          <View style={{ gap: 8 }}>
            {items.map((r) => {
              const b = badge(r.status, r.reject_reason);
              return (
                <Card key={r.id} radius={14} padding={12}>
                  <Text size={13} weight={700}>{r.scheme_name}</Text>
                  <Text size={11} color="textMuted">{`${r.full_name} • ${formatDate(r.created_at)}`}</Text>
                  {r.branch_name || r.agent_name ? (
                    <Text size={11} color="textMuted">{[r.branch_name, r.agent_name ? t('join.agentIs', { name: r.agent_name }) : null].filter(Boolean).join(' • ')}</Text>
                  ) : null}
                  <Text size={12} weight={700} color={b.color} style={{ marginTop: 4 }}>{b.text}</Text>
                </Card>
              );
            })}
          </View>
        )}
        <Button label={t('common.back')} variant="secondaryBlock" fullWidth onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))} />
      </Screen>
    </Frame>
  );
}
