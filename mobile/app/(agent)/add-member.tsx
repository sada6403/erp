import React, { useState } from 'react';
import { Pressable, View } from 'react-native';
import { Image } from 'expo-image';
import { usePreventScreenCapture } from 'expo-screen-capture';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/Button';
import { Screen } from '@/components/Shell';
import { Text } from '@/components/Text';
import { Card, EmptyState, Field, SkeletonList } from '@/components/ui';
import { isValidMobile, isValidNic } from '@/features/agent/joinValidation';
import { useJoinRequests, useOpenSchemes, useSubmitJoin } from '@/features/smartbuy/hooks';
import { errorMessage } from '@/lib/errors';
import { formatDate } from '@/lib/format';
import { formatRs } from '@/lib/money';
import { filePart, pickImage, type PickedImage } from '@/lib/pickImage';
import { uuid } from '@/store/outboxStore';
import { useUiStore } from '@/store/uiStore';
import { radii, useTheme } from '@/theme';

/** Agent-initiated Smart Buy join: details + two NIC photos go to the POS "App Requests" screen for approval. */
export default function AddMemberScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const router = useRouter();
  const showToast = useUiStore((s) => s.showToast);
  usePreventScreenCapture(); // the form shows NIC photos
  const schemes = useOpenSchemes();
  const requests = useJoinRequests();
  const submit = useSubmitJoin();
  const [schemeId, setSchemeId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [nic, setNic] = useState('');
  const [address, setAddress] = useState('');
  const [front, setFront] = useState<PickedImage | null>(null);
  const [back, setBack] = useState<PickedImage | null>(null);
  const [eventId, setEventId] = useState(() => uuid());
  const items = schemes.data?.items ?? [];
  const chosen = schemeId ?? items[0]?.id ?? null;

  const pick = async (side: 'front' | 'back') => {
    const img = await pickImage(t, `nic-${side}`, () => showToast(t('joinReq.permission')));
    if (img) (side === 'front' ? setFront : setBack)(img);
  };

  const send = async () => {
    if (name.trim().length < 2 || !phone.trim() || !nic.trim()) return showToast(t('joinReq.needFields'));
    if (!isValidMobile(phone)) return showToast(t('joinReq.badPhone'));
    if (!isValidNic(nic)) return showToast(t('joinReq.badNic'));
    if (!front || !back || !chosen) return showToast(t('joinReq.needPhotos'));
    const form = new FormData();
    form.append('client_event_id', eventId); // a retry after a dropped connection returns the same request
    form.append('scheme_id', chosen);
    form.append('full_name', name.trim());
    form.append('phone', phone.trim());
    form.append('nic_number', nic.trim().toUpperCase());
    if (address.trim()) form.append('address', address.trim());
    form.append('nic_front', filePart(front));
    form.append('nic_back', filePart(back));
    try {
      await submit.mutateAsync(form);
      showToast(t('joinReq.sent'));
      setName(''); setPhone(''); setNic(''); setAddress(''); setFront(null); setBack(null); setEventId(uuid());
    } catch (e) {
      showToast(errorMessage(e, t));
    }
  };

  const photo = (side: 'front' | 'back', img: PickedImage | null) => (
    <Pressable
      key={side}
      accessibilityRole="button"
      accessibilityLabel={t(side === 'front' ? 'joinReq.front' : 'joinReq.back')}
      onPress={() => pick(side)}
      style={{ flex: 1, minHeight: 110, borderRadius: radii.chip, borderWidth: 1, borderStyle: 'dashed', borderColor: theme.colors.surfaceBorder, alignItems: 'center', justifyContent: 'center', overflow: 'hidden', padding: 6 }}
    >
      {img ? <Image source={{ uri: img.uri }} style={{ width: '100%', height: 90, borderRadius: 8 }} contentFit="cover" /> : <Text size={22}>{'📷'}</Text>}
      <Text size={11} weight={700} color="textMuted" style={{ marginTop: 4 }}>{t(side === 'front' ? 'joinReq.front' : 'joinReq.back')}</Text>
      <Text size={10} color="primary">{t(img ? 'joinReq.changePhoto' : 'joinReq.addPhoto')}</Text>
    </Pressable>
  );

  const badge = (status: string, reason: string | null) =>
    status === 'approved' ? { text: t('joinReq.approved'), color: 'success' as const }
      : status === 'rejected' ? { text: t('joinReq.rejected', { reason: reason ?? '' }), color: 'error' as const }
        : { text: t('joinReq.pending'), color: 'warning' as const };

  return (
    <Screen onRefresh={() => { void requests.refetch(); void schemes.refetch(); }} refreshing={requests.isRefetching}>
      <View>
        <Text size={18} weight={800}>{t('joinReq.title')}</Text>
        <Text size={12} color="textMuted" style={{ marginTop: 3 }}>{t('joinReq.sub')}</Text>
      </View>

      <Card radius={16} padding={16}>
        <Text size={11} weight={700} color="textMuted" style={{ marginBottom: 6 }}>{t('joinReq.scheme')}</Text>
        {schemes.isLoading ? <SkeletonList rows={2} height={44} /> : items.length === 0 ? (
          <Text size={12} color="textMuted" style={{ marginBottom: 12 }}>{t('joinReq.noSchemes')}</Text>
        ) : (
          <View style={{ gap: 6, marginBottom: 12 }}>
            {items.map((s) => {
              const on = s.id === chosen;
              return (
                <Pressable
                  key={s.id}
                  accessibilityRole="button"
                  accessibilityState={{ selected: on }}
                  onPress={() => setSchemeId(s.id)}
                  style={{ minHeight: 44, justifyContent: 'center', paddingHorizontal: 12, borderRadius: radii.chip, borderWidth: 1, borderColor: on ? theme.colors.primary : theme.colors.surfaceBorder, backgroundColor: on ? theme.colors.container : theme.colors.surface }}
                >
                  <Text size={13} weight={on ? 700 : 400} color={on ? 'primary' : 'textMain'}>
                    {`${s.name} (${formatRs(s.contribution_amount)})`}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        )}
        <Field label={t('joinReq.name')} value={name} onChangeText={setName} maxLength={255} />
        <Field label={t('joinReq.phone')} value={phone} onChangeText={setPhone} keyboardType="phone-pad" maxLength={16} />
        <Field label={t('joinReq.nic')} value={nic} onChangeText={setNic} autoCapitalize="characters" autoCorrect={false} maxLength={12} />
        <Field label={t('joinReq.address')} value={address} onChangeText={setAddress} maxLength={512} />
        <View style={{ flexDirection: 'row', gap: 10, marginBottom: 14 }}>
          {photo('front', front)}
          {photo('back', back)}
        </View>
        <Button label={t('joinReq.submit')} variant="primaryBlock" fullWidth loading={submit.isPending} disabled={items.length === 0} onPress={send} />
      </Card>

      <Text size={14} weight={800} style={{ marginTop: 6 }}>{t('joinReq.myRequests')}</Text>
      {requests.isLoading ? <SkeletonList rows={2} height={64} /> : (requests.data?.items.length ?? 0) === 0 ? (
        <EmptyState icon={'📝'} title={t('joinReq.empty')} />
      ) : (
        <View style={{ gap: 8 }}>
          {requests.data?.items.map((r) => {
            const b = badge(r.status, r.reject_reason);
            return (
              <Card key={r.id} radius={14} padding={12}>
                <Text size={13} weight={700}>{r.full_name}</Text>
                <Text size={11} color="textMuted">{`${r.scheme_name} • ${formatDate(r.created_at)}`}</Text>
                <Text size={11} weight={700} color={b.color} style={{ marginTop: 3 }}>{b.text}</Text>
              </Card>
            );
          })}
        </View>
      )}
      <Button label={t('common.back')} variant="secondaryBlock" fullWidth onPress={() => (router.canGoBack() ? router.back() : router.replace('/members'))} />
    </Screen>
  );
}
