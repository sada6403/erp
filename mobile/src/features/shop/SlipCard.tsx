import React, { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { OrderDto } from '@contracts/orders';
import { orderApi } from '@/api/endpoints';
import { Button } from '@/components/Button';
import { Text } from '@/components/Text';
import { Card, Field } from '@/components/ui';
import { errorMessage } from '@/lib/errors';
import { filePart, pickImage } from '@/lib/pickImage';
import { qk } from '@/query/keys';
import { uuid } from '@/store/outboxStore';
import { useUiStore } from '@/store/uiStore';
import { makeStyles } from '@/theme';

const useStyles = makeStyles(() => ({ gap: { gap: 10 } }));

/**
 * Bank transfer orders: the customer uploads a photo of the payment slip, the branch verifies or rejects it in the POS.
 * One slip waits at a time; a rejected slip (with the branch's reason) can be replaced.
 */
export function SlipCard({ order }: { order: OrderDto }) {
  const { t } = useTranslation();
  const st = useStyles();
  const qc = useQueryClient();
  const showToast = useUiStore((s) => s.showToast);
  const [reference, setReference] = useState('');
  const eligible = order.payment_method === 'bank_transfer' && order.stage !== 'cancelled';
  const slips = useQuery({ queryKey: qk.me.slips(order.id), queryFn: () => orderApi.slips(order.id), enabled: eligible, refetchInterval: 30_000 });
  const upload = useMutation({
    mutationFn: async (img: { uri: string; name: string; type: string }) => {
      const form = new FormData();
      form.append('client_event_id', uuid());
      if (reference.trim()) form.append('reference', reference.trim());
      form.append('slip', filePart(img));
      return orderApi.uploadSlip(order.id, form);
    },
    onSuccess: () => {
      setReference('');
      void qc.invalidateQueries({ queryKey: qk.me.slips(order.id) });
      void qc.invalidateQueries({ queryKey: qk.me.order(order.id) });
    },
  });

  if (!eligible) return null;
  const latest = slips.data?.items?.[0];
  const paid = order.payment_status === 'paid' || latest?.status === 'verified';
  const canUpload = !paid && latest?.status !== 'pending';

  const choose = async () => {
    const img = await pickImage(t, 'slip', () => showToast(t('slip.permission')));
    if (!img) return;
    try {
      await upload.mutateAsync(img);
      showToast(t('slip.sent'));
    } catch (e) {
      showToast(errorMessage(e, t) || t('slip.failed'));
    }
  };

  return (
    <Card radius={16} padding={16} style={st.gap}>
      <Text size={14} weight={800}>{t('slip.title')}</Text>
      {paid ? (
        <Text size={12} weight={700} color="success">{`✓ ${t('slip.verified')}`}</Text>
      ) : latest?.status === 'pending' ? (
        <Text size={12} color="textMuted">{t('slip.pending')}</Text>
      ) : latest?.status === 'rejected' ? (
        <Text size={12} weight={700} color="error">{t('slip.rejected', { reason: latest.reject_reason ?? '' })}</Text>
      ) : null}
      {canUpload ? (
        <>
          <Field label={t('slip.reference')} value={reference} onChangeText={setReference} maxLength={200} />
          <Button
            label={latest?.status === 'rejected' ? t('slip.reupload') : t('slip.upload')}
            variant="primaryBlock"
            fullWidth
            loading={upload.isPending}
            onPress={choose}
          />
        </>
      ) : null}
    </Card>
  );
}
