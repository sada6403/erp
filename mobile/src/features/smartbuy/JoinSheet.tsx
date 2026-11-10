import React, { useState } from 'react';
import { Pressable, ScrollView, TextInput, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/Button';
import { Text } from '@/components/Text';
import { formatRs } from '@/lib/money';
import { useUiStore } from '@/store/uiStore';
import { fontScale, makeStyles, radii, useTheme } from '@/theme';
import { SB_DEMO } from './demo';
import { useOpenSchemes } from './hooks';
import { useCompany } from '@/features/common/hooks';
import { Overlay, SheetSurface } from './Overlay';

const useStyles = makeStyles((t) => ({
  group: { marginBottom: 12 },
  field: {
    minHeight: 48,
    borderWidth: 1,
    borderColor: t.colors.surfaceBorder,
    borderRadius: radii.chip,
    paddingVertical: 10,
    paddingHorizontal: 12,
    backgroundColor: t.colors.surface,
  },
  select: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  option: { minHeight: 48, justifyContent: 'center', paddingHorizontal: 12, borderBottomWidth: 1, borderBottomColor: t.colors.divider },
}));

/** Join Smart Buy bottom sheet (demo #joinSchemeModal). Submit is demo-mock only; release builds disable it. */
export function JoinSheet({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const company = useCompany();
  const theme = useTheme();
  const st = useStyles();
  const showToast = useUiStore((s) => s.showToast);
  const { data } = useOpenSchemes();
  const [picked, setPicked] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [nic, setNic] = useState('');
  const [focus, setFocus] = useState(false);
  const plans = (data?.items ?? []).map((s) => ({
    id: s.id,
    label: `${s.name} (${formatRs(s.contribution_amount)}/${t(s.frequency === 'monthly' ? 'join.perMonth' : 'join.perWeek')})`,
  }));
  const current = plans.find((p) => p.id === picked) ?? plans[0];
  const submit = () => {
    if (!nic.trim()) {
      showToast(t('join.nicRequired'));
      return;
    }
    onClose();
    showToast(t('join.submitted'));
  };
  return (
    <Overlay onClose={onClose} align="bottom">
      <SheetSurface onClose={onClose}>
        <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          <Text size={18.72} weight={700} style={{ paddingRight: 40 }}>{t('join.heading', { app: company?.name || t('app.name') })}</Text>
          <Text size={fontScale.s16} style={{ marginBottom: 16 }}>{t('join.blurb')}</Text>
          <View style={st.group}>
            <Text size={fontScale.s11} weight={700} color="textMuted" style={{ marginBottom: 4 }}>{t('join.selectPlan')}</Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('join.selectPlan')}
              disabled={!SB_DEMO || plans.length === 0}
              onPress={() => setOpen((o) => !o)}
              style={[st.field, st.select]}
            >
              <Text size={fontScale.s13} style={{ flex: 1 }}>{current?.label ?? '—'}</Text>
              <Text size={fontScale.s11} color="textMuted">{open ? '▴' : '▾'}</Text>
            </Pressable>
            {open ? (
              <View style={{ borderWidth: 1, borderColor: theme.colors.surfaceBorder, borderRadius: radii.chip, marginTop: 4, overflow: 'hidden' }}>
                {plans.map((p) => (
                  <Pressable
                    key={p.id}
                    accessibilityRole="button"
                    accessibilityState={{ selected: p.id === current?.id }}
                    onPress={() => {
                      setPicked(p.id);
                      setOpen(false);
                    }}
                    style={[st.option, p.id === current?.id ? { backgroundColor: theme.colors.container } : null]}
                  >
                    <Text size={fontScale.s13} weight={p.id === current?.id ? 700 : 400} color={p.id === current?.id ? 'primary' : 'textMain'}>{p.label}</Text>
                  </Pressable>
                ))}
              </View>
            ) : null}
          </View>
          <View style={st.group}>
            <Text size={fontScale.s11} weight={700} color="textMuted" style={{ marginBottom: 4 }}>{t('join.nicLabel')}</Text>
            <TextInput
              accessibilityLabel={t('join.nicLabel')}
              value={nic}
              onChangeText={setNic}
              editable={SB_DEMO}
              autoCapitalize="characters"
              autoCorrect={false}
              placeholder={t('join.nicPlaceholder')}
              placeholderTextColor={theme.colors.textSubtle}
              onFocus={() => setFocus(true)}
              onBlur={() => setFocus(false)}
              style={[st.field, { fontSize: fontScale.s13, color: theme.colors.textMain, borderColor: focus ? theme.colors.primary : theme.colors.surfaceBorder }]}
            />
          </View>
          <Button label={t('join.submitApproval')} variant="primaryBlock" disabled={!SB_DEMO} onPress={submit} />
          {!SB_DEMO ? <Text size={fontScale.s11} weight={800} color="primary" align="center" style={{ marginTop: 8 }}>{t('soon.badge')}</Text> : null}
        </ScrollView>
      </SheetSurface>
    </Overlay>
  );
}
