import React from 'react';
import { useTranslation } from 'react-i18next';
import { Text } from '@/components/Text';
import type { ApkStage } from './apkUpdate';

export function UpdateProgress({ stage, progress, error }: { stage: ApkStage | null; progress: number; error: string | null }) {
  const { t } = useTranslation();
  if (error) {
    const key = error === 'UPDATE_CHECKSUM_MISMATCH' ? 'update.checksumFailed' : 'update.failed';
    return <Text size={12} weight={700} color="error" style={{ marginTop: 10 }}>{t(key)}</Text>;
  }
  if (!stage) return null;
  const label = stage === 'downloading' ? t('update.downloading', { pct: Math.round(progress * 100) }) : stage === 'verifying' ? t('update.verifying') : t('update.installing');
  return <Text size={12} weight={700} color="primary" style={{ marginTop: 10 }}>{label}</Text>;
}
