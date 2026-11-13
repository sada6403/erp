import React, { useState } from 'react';
import { Pressable, View } from 'react-native';
import { Image } from 'expo-image';
import * as Location from 'expo-location';
import { useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { catalogApi } from '@/api/endpoints';
import { Button } from '@/components/Button';
import { Text } from '@/components/Text';
import { Card, EmptyState, Field, SkeletonList } from '@/components/ui';
import { isValidMobile, isValidNic } from '@/features/agent/joinValidation';
import { errorMessage } from '@/lib/errors';
import { formatRs } from '@/lib/money';
import { filePart, pickImage, type PickedImage } from '@/lib/pickImage';
import { useSessionStore } from '@/store/sessionStore';
import { uuid } from '@/store/outboxStore';
import { selectIsOffline, useUiStore } from '@/store/uiStore';
import { radii, useTheme } from '@/theme';
import { useAgentLookup, useOpenSchemes, useSubmitJoin } from './hooks';

/**
 * Customer self join: the same fields the POS needs to enrol a Smart Buy member (name, phone, NIC, address, scheme)
 * plus the agent's code (confirmed by name before submit), the nearest branch, and both NIC photos.
 * Validation mirrors the server and the POS; the server stays the authority. The NIC lives only in the join request (never in customers).
 */
export function JoinForm() {
  const { t } = useTranslation();
  const theme = useTheme();
  const router = useRouter();
  const user = useSessionStore((s) => s.user);
  const offline = useUiStore(selectIsOffline);
  const showToast = useUiStore((s) => s.showToast);
  const openBuyLater = useUiStore((s) => s.openBuyLater);
  const schemes = useOpenSchemes();
  const lookup = useAgentLookup();
  const submit = useSubmitJoin();

  const [schemeId, setSchemeId] = useState<string | null>(null);
  const [name, setName] = useState(user?.name ?? '');
  const [phone, setPhone] = useState(user?.phone ?? '');
  const [nic, setNic] = useState('');
  const [address, setAddress] = useState('');
  const [code, setCode] = useState('');
  const [branchId, setBranchId] = useState<string | null>(null);
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [front, setFront] = useState<PickedImage | null>(null);
  const [back, setBack] = useState<PickedImage | null>(null);
  const [eventId] = useState(() => uuid()); // a retry after a dropped connection returns the same request
  const [done, setDone] = useState(false);

  const branches = useQuery({
    queryKey: ['catalog', 'branches', 'join', coords?.lat ?? 0, coords?.lng ?? 0],
    queryFn: () => catalogApi.branchesNearby(coords?.lat, coords?.lng),
  });
  const branchList = branches.data?.items ?? [];
  const items = schemes.data?.items ?? [];
  const chosen = schemeId ?? items[0]?.id ?? null;
  const agent = lookup.data ?? null;
  // The confirmed agent must match what is typed now (editing the code clears the confirmation).
  const agentConfirmed = !!agent && agent.code.toUpperCase() === code.replace(/\s+/g, '').toUpperCase();

  // Default to the agent's branch until the applicant picks another one.
  const agentBranch = agentConfirmed && agent?.branch_id && branchList.some((b) => b.id === agent.branch_id) ? agent.branch_id : null;
  const activeBranch = branchId ?? agentBranch;

  const nearMe = async () => {
    try {
      const perm = await Location.requestForegroundPermissionsAsync();
      if (!perm.granted) return showToast(t('join.locationDenied'));
      const p = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      setCoords({ lat: p.coords.latitude, lng: p.coords.longitude });
      setBranchId(null);
      showToast(t('join.nearMeOk'));
    } catch {
      showToast(t('join.locationFailed'));
    }
  };

  const verify = async () => {
    if (offline) return openBuyLater();
    if (code.trim().length < 2) return showToast(t('join.needAgentCode'));
    try {
      await lookup.mutateAsync(code);
    } catch (e) {
      showToast(errorMessage(e, t));
    }
  };

  const pick = async (side: 'front' | 'back') => {
    const img = await pickImage(t, `nic-${side}`, () => showToast(t('joinReq.permission')));
    if (img) (side === 'front' ? setFront : setBack)(img);
  };

  const send = async () => {
    if (offline) return openBuyLater();
    if (name.trim().length < 2 || !phone.trim() || !nic.trim()) return showToast(t('joinReq.needFields'));
    if (!isValidMobile(phone)) return showToast(t('joinReq.badPhone'));
    if (!isValidNic(nic)) return showToast(t('joinReq.badNic'));
    if (!chosen) return showToast(t('joinReq.noSchemes'));
    if (!agentConfirmed || !agent) return showToast(t('join.confirmAgent'));
    if (!activeBranch) return showToast(t('join.needBranch'));
    if (!front || !back) return showToast(t('joinReq.needPhotos'));
    const form = new FormData();
    form.append('client_event_id', eventId);
    form.append('scheme_id', chosen);
    form.append('full_name', name.trim());
    form.append('phone', phone.trim());
    form.append('nic_number', nic.trim().toUpperCase());
    if (address.trim()) form.append('address', address.trim());
    form.append('agent_code', agent.code);
    form.append('branch_id', activeBranch);
    form.append('nic_front', filePart(front));
    form.append('nic_back', filePart(back));
    try {
      await submit.mutateAsync(form);
      setDone(true);
    } catch (e) {
      showToast(errorMessage(e, t));
    }
  };

  if (done) {
    return (
      <Card radius={16} padding={20}>
        <Text size={40} align="center">{'✅'}</Text>
        <Text size={16} weight={800} align="center" style={{ marginTop: 8 }}>{t('join.sentTitle')}</Text>
        <Text size={13} color="textMuted" align="center" style={{ marginTop: 6, marginBottom: 16 }}>{t('join.sentBody')}</Text>
        <Button label={t('joinReq.myRequestsTitle')} variant="primaryBlock" fullWidth onPress={() => router.replace('/join-requests')} />
      </Card>
    );
  }

  const chip = (on: boolean) => ({
    minHeight: 44,
    justifyContent: 'center' as const,
    paddingHorizontal: 12,
    borderRadius: radii.chip,
    borderWidth: 1,
    borderColor: on ? theme.colors.primary : theme.colors.surfaceBorder,
    backgroundColor: on ? theme.colors.container : theme.colors.surface,
  });

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

  return (
    <Card radius={16} padding={16}>
      <Text size={11} weight={700} color="textMuted" style={{ marginBottom: 6 }}>{t('joinReq.scheme')}</Text>
      {schemes.isLoading ? <SkeletonList rows={2} height={44} /> : items.length === 0 ? (
        <EmptyState icon="💎" title={t('joinReq.noSchemes')} />
      ) : (
        <View style={{ gap: 6, marginBottom: 12 }}>
          {items.map((s) => {
            const on = s.id === chosen;
            return (
              <Pressable key={s.id} accessibilityRole="button" accessibilityState={{ selected: on }} onPress={() => setSchemeId(s.id)} style={chip(on)}>
                <Text size={13} weight={on ? 700 : 400} color={on ? 'primary' : 'textMain'}>
                  {`${s.name} (${formatRs(s.contribution_amount)}/${t(s.frequency === 'monthly' ? 'join.perMonth' : 'join.perWeek')})`}
                </Text>
              </Pressable>
            );
          })}
        </View>
      )}

      <Field label={t('joinReq.name')} value={name} onChangeText={setName} maxLength={255} />
      <Field label={t('joinReq.phone')} value={phone} onChangeText={setPhone} keyboardType="phone-pad" maxLength={16} />
      <Field label={t('joinReq.nic')} value={nic} onChangeText={setNic} autoCapitalize="characters" autoCorrect={false} maxLength={12} hint={t('join.nicPlaceholder')} />
      <Field label={t('joinReq.address')} value={address} onChangeText={setAddress} maxLength={512} />

      <Field
        label={t('join.agentCode')}
        value={code}
        onChangeText={(v) => {
          setCode(v);
          if (lookup.data) lookup.reset();
        }}
        autoCapitalize="characters"
        autoCorrect={false}
        maxLength={64}
        hint={t('join.agentCodeHint')}
      />
      <Button label={t('join.checkAgent')} variant="secondaryBlock" fullWidth loading={lookup.isPending} onPress={verify} style={{ marginBottom: 8 }} />
      {agentConfirmed && agent ? (
        <Text size={13} weight={700} color="success" style={{ marginBottom: 12 }}>
          {t('join.agentIs', { name: agent.name })}{agent.branch_name ? ` · ${agent.branch_name}` : ''}
        </Text>
      ) : null}

      <Text size={11} weight={700} color="textMuted" style={{ marginBottom: 6, marginTop: 4 }}>{t('join.branch')}</Text>
      {branches.isLoading ? <SkeletonList rows={2} height={44} /> : (
        <View style={{ gap: 6, marginBottom: 8 }}>
          {branchList.map((b) => {
            const on = b.id === activeBranch;
            return (
              <Pressable key={b.id} accessibilityRole="button" accessibilityState={{ selected: on }} onPress={() => setBranchId(b.id)} style={chip(on)}>
                <Text size={13} weight={on ? 700 : 400} color={on ? 'primary' : 'textMain'}>
                  {b.name}{typeof b.distance_km === 'number' && coords ? ` · ${b.distance_km} km` : ''}
                </Text>
                {b.address ? <Text size={11} color="textMuted">{b.address}</Text> : null}
              </Pressable>
            );
          })}
        </View>
      )}
      <Button label={t('join.nearMe')} variant="link" onPress={nearMe} />

      <Text size={11} weight={700} color="textMuted" style={{ marginBottom: 6, marginTop: 8 }}>{t('join.nicPhotos')}</Text>
      <View style={{ flexDirection: 'row', gap: 10, marginBottom: 6 }}>
        {photo('front', front)}
        {photo('back', back)}
      </View>
      <Text size={11} color="textMuted" style={{ marginBottom: 14 }}>{t('join.privacy')}</Text>

      <Button label={t('join.submitApproval')} variant="primaryBlock" fullWidth loading={submit.isPending} disabled={items.length === 0} onPress={send} />
    </Card>
  );
}
