import React, { useState } from 'react';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { usePreventScreenCapture } from 'expo-screen-capture';
import { Text } from '@/components/Text';
import { Button } from '@/components/Button';
import { Card, Field, ScreenHeading } from '@/components/ui';
import { Frame, Screen } from '@/components/Shell';
import { authApi } from '@/api/endpoints';
import { errorMessage } from '@/lib/errors';
import { useUiStore } from '@/store/uiStore';
import { logout } from '@/features/auth/session';
import { useServerActionGuard } from '@/features/common/hooks';

/** Account deletion (Play policy): confirms with the password, then DELETE /me. */
export default function DeleteAccountScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const guard = useServerActionGuard();
  const showToast = useUiStore((s) => s.showToast);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  usePreventScreenCapture();

  const run = () =>
    guard(async () => {
      setBusy(true);
      try {
        await authApi.deleteMe({ password });
        await logout();
        router.replace('/');
      } catch (e) {
        showToast(errorMessage(e, t));
      } finally {
        setBusy(false);
      }
    });

  return (
    <Frame>
      <Screen>
        <ScreenHeading title={t('settings.deleteAccount')} sub={t('settings.deleteBody')} />
        <Card>
          <Text size={12} color="textMuted" style={{ marginBottom: 10 }}>{t('settings.deleteWarning')}</Text>
          <Field label={t('auth.password')} secureTextEntry value={password} onChangeText={setPassword} autoCapitalize="none" />
          <Button label={t('settings.deleteConfirm')} variant="logout" loading={busy} disabled={password.length < 1} onPress={run} />
        </Card>
      </Screen>
    </Frame>
  );
}
