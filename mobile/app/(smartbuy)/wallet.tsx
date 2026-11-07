import React from 'react';
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { usePreventScreenCapture } from 'expo-screen-capture';
import { useTheme, radii } from '@/theme';
import { Text } from '@/components/Text';
import { Card, EmptyState, ErrorState, ScreenHeading, SkeletonList } from '@/components/ui';
import { Gradient } from '@/components/Gradient';
import { Screen } from '@/components/Shell';
import { formatRs } from '@/lib/money';
import { formatDate } from '@/lib/format';
import { useWallet, useWalletTransactions } from '@/features/smartbuy/hooks';

/** Wallet / passbook: balance and ledger. Read-only; screen capture blocked. */
export default function WalletScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  usePreventScreenCapture();
  const wallet = useWallet();
  const tx = useWalletTransactions();
  return (
    <Screen onRefresh={() => { wallet.refetch(); tx.refetch(); }} refreshing={wallet.isRefetching}>
      <ScreenHeading title={t('wallet.title')} sub={t('wallet.sub')} />
      <View style={{ borderRadius: radii.hero, overflow: 'hidden' }}>
        <Gradient direction="diagonal" from={theme.colors.primary} to={theme.colors.primaryDark} style={{ padding: 20 }}>
          <Text size={12} weight={700} color="glassText">{t('wallet.balance')}</Text>
          <Text size={30} weight={800} color="white" mono accessibilityLabel={wallet.data ? formatRs(wallet.data.balance) : t('common.loading')}>
            {wallet.data ? formatRs(wallet.data.balance) : '—'}
          </Text>
        </Gradient>
      </View>
      <Text size={14} weight={800}>{t('wallet.transactions')}</Text>
      {tx.isLoading ? (
        <SkeletonList rows={4} height={56} />
      ) : tx.isError && !tx.data ? (
        <ErrorState onRetry={() => tx.refetch()} />
      ) : (tx.data?.items ?? []).length === 0 ? (
        <EmptyState icon="💰" title={t('wallet.noTransactions')} />
      ) : (
        <Card>
          {tx.data!.items.map((r) => {
            const credit = r.amount >= 0;
            return (
              <View key={r.id} style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', minHeight: 52 }}>
                <View style={{ flex: 1 }}>
                  <Text size={13} weight={700}>{r.source ?? r.type}</Text>
                  <Text size={10} color="textMuted">{formatDate(r.created_at)}</Text>
                </View>
                <View style={{ alignItems: 'flex-end' }}>
                  <Text size={13} weight={800} color={credit ? 'success' : 'error'}>{credit ? '+' : '-'}{formatRs(Math.abs(r.amount))}</Text>
                  <Text size={10} color="textMuted">{formatRs(r.balance_after)}</Text>
                </View>
              </View>
            );
          })}
        </Card>
      )}
    </Screen>
  );
}
