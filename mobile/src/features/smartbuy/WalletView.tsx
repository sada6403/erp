import React from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import type { WalletTransactionDto } from '@contracts/smartbuy';
import { Button } from '@/components/Button';
import { Text } from '@/components/Text';
import { EmptyState, ErrorState, SkeletonList } from '@/components/ui';
import { formatDate } from '@/lib/format';
import { formatRs } from '@/lib/money';
import { fontScale, lineHeights, makeStyles, radii } from '@/theme';
import { SB_DEMO } from './demo';
import { useWallet, useWalletTransactions } from './hooks';

const useStyles = makeStyles((t) => ({
  card: { backgroundColor: t.colors.surface, borderRadius: radii.hero, padding: 18, borderWidth: 1, borderColor: t.colors.surfaceBorder },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 },
  shield: { backgroundColor: t.colors.successBg, paddingVertical: 4, paddingHorizontal: 8, borderRadius: radii.sm },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: t.colors.divider, gap: 8 },
  left: { flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 },
  icon: { width: 26, height: 26, borderRadius: radii.round, alignItems: 'center', justifyContent: 'center' },
  credit: { backgroundColor: t.colors.successBg },
  debit: { backgroundColor: t.colors.errorBg },
}));

function TxRow({ r }: { r: WalletTransactionDto & { note?: string } }) {
  const st = useStyles();
  const credit = r.amount >= 0;
  const date = SB_DEMO && r.note ? r.note : formatDate(r.created_at);
  return (
    <View style={st.row}>
      <View style={st.left}>
        <View style={[st.icon, credit ? st.credit : st.debit]}>
          <Text size={fontScale.s12} weight={800} color={credit ? 'success' : 'error'}>{credit ? '↓' : '↑'}</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text size={fontScale.s12} weight={700}>{r.source ?? r.type}</Text>
          <Text size={fontScale.s10} color="textMuted">{date}</Text>
        </View>
      </View>
      <Text size={fontScale.s12} weight={800} color={credit ? 'success' : 'error'}>
        {credit ? '+' : '-'}
        {formatRs(Math.abs(r.amount), { decimals: 2 })}
      </Text>
    </View>
  );
}

/** "Spend Wallet Balance in Shop": enabled only on the demo mock; release builds show it disabled with the coming-soon note. */
export function SpendButton() {
  const { t } = useTranslation();
  const router = useRouter();
  return (
    <>
      <Button label={t('wallet.spendBtn')} variant="primaryBlock" disabled={!SB_DEMO} onPress={() => router.navigate('/')} />
      {!SB_DEMO ? <Text size={fontScale.s11} weight={800} color="primary" align="center" style={{ marginTop: -6 }}>{t('soon.badge')}</Text> : null}
    </>
  );
}

function BalanceHeader() {
  const { t } = useTranslation();
  const st = useStyles();
  const wallet = useWallet();
  return (
    <View style={st.header}>
      <View style={{ flexShrink: 1 }}>
        <Text size={fontScale.s11} weight={600} color="textMuted">{t('wallet.verified')}</Text>
        <Text size={fontScale.s24} weight={800} color="primary" style={{ marginTop: 2 }} accessibilityLabel={wallet.data ? formatRs(wallet.data.balance, { decimals: 2 }) : t('common.loading')}>
          {wallet.data ? formatRs(wallet.data.balance, { decimals: 2 }) : '—'}
        </Text>
      </View>
      <View style={st.shield}>
        <Text size={fontScale.s10} weight={700} color="success">{t('wallet.ledgerBadge')}</Text>
      </View>
    </View>
  );
}

/** Wallet & passbook (demo view-smartbuy-wallet). Siblings inside a Screen (gap 14, padding 16). */
export function WalletView() {
  const { t } = useTranslation();
  const st = useStyles();
  const tx = useWalletTransactions();
  const items = tx.data?.items ?? [];
  return (
    <>
      <View style={st.card}>
        <BalanceHeader />
        <Text size={fontScale.s12} color="textMuted" lineHeightRatio={lineHeights.relaxed} style={{ marginTop: 6, marginBottom: 14 }}>
          {t('wallet.explainer')}
        </Text>
        <Text size={fontScale.s11} weight={700} color="textMuted" style={{ marginBottom: 8 }}>{t('wallet.ledgerTitle').toUpperCase()}</Text>
        {tx.isLoading ? (
          <SkeletonList rows={3} height={52} />
        ) : tx.isError && !tx.data ? (
          <ErrorState onRetry={() => tx.refetch()} />
        ) : items.length === 0 ? (
          <EmptyState icon="💰" title={t('wallet.noTransactions')} />
        ) : (
          items.map((r) => <TxRow key={r.id} r={r} />)
        )}
      </View>
      <SpendButton />
    </>
  );
}

/** Spend tab: the wallet balance card (no ledger) plus the spend action. */
export function SpendView() {
  const { t } = useTranslation();
  const st = useStyles();
  return (
    <>
      <View style={st.card}>
        <BalanceHeader />
        <Text size={fontScale.s12} color="textMuted" lineHeightRatio={lineHeights.relaxed} style={{ marginTop: 6 }}>
          {t('wallet.explainer')}
        </Text>
      </View>
      <SpendButton />
    </>
  );
}
