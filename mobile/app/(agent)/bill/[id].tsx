import React from 'react';
import { View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@/theme';
import { ErrorState, SkeletonList } from '@/components/ui';
import { useBill } from '@/features/agent/hooks';
import { ReceiptWindow } from '@/features/agent/components';
import { buildBillText } from '@/features/agent/receipt';

/** Thermal receipt preview (demo billModal) for one delivery: shows bill_no, Print (dev mock) and WhatsApp PDF share. */
export default function BillPreviewScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t } = useTranslation();
  const theme = useTheme();
  const router = useRouter();
  const { data: b, isLoading, isError, refetch } = useBill(id);

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.overlay, justifyContent: 'center', padding: 16 }}>
      {isLoading ? (
        <SkeletonList rows={1} height={320} />
      ) : isError || !b ? (
        <ErrorState message={t('errors.UNKNOWN')} onRetry={() => refetch()} />
      ) : (
        <ReceiptWindow text={buildBillText(b)} onClose={() => router.back()} onPrinted={() => router.back()} />
      )}
    </View>
  );
}
