import React from 'react';
import { ScrollView } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/Button';
import { Text } from '@/components/Text';
import { Overlay, SheetSurface } from '@/features/smartbuy/Overlay';
import { useAppUpdate } from './useAppUpdate';
import { UpdateProgress } from './UpdateProgress';

/** Dismissible "New version available" sheet: release notes, Update now / Later (comes back after 3 days). */
export function UpdateAvailableSheet() {
  const { t } = useTranslation();
  const u = useAppUpdate();
  if (u.kind !== 'available') return null;
  return (
    <Overlay onClose={u.dismiss} align="bottom">
      <SheetSurface onClose={u.dismiss}>
        <Text size={18} weight={800}>{t('update.availableTitle')}</Text>
        <Text size={13} color="textMuted" style={{ marginTop: 4 }}>{t('update.availableBody', { version: u.latest })}</Text>
        {u.notes ? (
          <ScrollView style={{ maxHeight: 180, marginTop: 12 }}>
            <Text size={12} weight={700} color="textMuted">{t('update.whatsNew')}</Text>
            <Text size={13} style={{ marginTop: 4 }}>{u.notes}</Text>
          </ScrollView>
        ) : null}
        <UpdateProgress stage={u.stage} progress={u.progress} error={u.error} />
        <Button label={t('update.updateNow')} fullWidth disabled={u.stage != null} onPress={u.start} style={{ marginTop: 16 }} />
        <Button label={t('update.later')} variant="link" disabled={u.stage != null} onPress={u.dismiss} />
      </SheetSurface>
    </Overlay>
  );
}
