import React, { useState } from 'react';
import { ScrollView, View } from 'react-native';
import { useForm } from 'react-hook-form';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '@/theme';
import { Text } from '@/components/Text';
import { Button } from '@/components/Button';
import { FormField } from '@/components/FormField';
import { zodResolver } from '@/lib/zodResolver';
import { errorMessage } from '@/lib/errors';
import { authApi } from '@/api/endpoints';
import { useServerActionGuard } from '@/features/common/hooks';
import { useUiStore } from '@/store/uiStore';
import { useSessionStore } from '@/store/sessionStore';
import { applyAuth, homeRouteFor } from './session';
import { setPasswordSchema, type SetPasswordForm } from './schemas';

/** Forced on first login (temporary password) and reused by Settings > Change password. */
export function SetPasswordScreen({ voluntary = false }: { voluntary?: boolean }) {
  const { t } = useTranslation();
  const theme = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const guard = useServerActionGuard();
  const showToast = useUiStore((s) => s.showToast);
  const [busy, setBusy] = useState(false);
  const { control, handleSubmit } = useForm<SetPasswordForm>({
    resolver: zodResolver(setPasswordSchema),
    defaultValues: { current: '', next: '', confirm: '' },
  });

  const submit = handleSubmit((v) =>
    guard(async () => {
      setBusy(true);
      try {
        const res = await authApi.changePassword({ current_password: v.current, new_password: v.next });
        const user = await applyAuth(res);
        showToast(t('auth.passwordChanged'));
        if (voluntary) {
          router.back();
        } else if (!useSessionStore.getState().user?.email) {
          router.replace('/verify-email');
        } else {
          router.replace(homeRouteFor(user) as never);
        }
      } catch (e) {
        showToast(errorMessage(e, t));
      } finally {
        setBusy(false);
      }
    }),
  );

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.surface }}>
      <ScrollView contentContainerStyle={{ padding: 20, paddingTop: insets.top + 24, paddingBottom: 36 + insets.bottom }} keyboardShouldPersistTaps="handled">
        <Text size={42} align="center">🔐</Text>
        <Text size={20} weight={800} align="center" style={{ marginVertical: 6 }}>
          {voluntary ? t('auth.changePassword') : t('auth.setPasswordTitle')}
        </Text>
        <Text size={12} color="textMuted" align="center" style={{ marginBottom: 20 }} lineHeightRatio={1.45}>
          {voluntary ? t('auth.changePasswordSub') : t('auth.setPasswordSub')}
        </Text>
        <FormField control={control} name="current" label={voluntary ? t('auth.currentPassword') : t('auth.tempPassword')} secureTextEntry autoCapitalize="none" />
        <FormField control={control} name="next" label={t('auth.newPassword')} secureTextEntry autoCapitalize="none" hint={t('auth.passwordHint')} />
        <FormField control={control} name="confirm" label={t('auth.confirmPassword')} secureTextEntry autoCapitalize="none" />
        <Button label={t('auth.savePassword')} loading={busy} onPress={submit} />
        {voluntary ? <Button label={t('common.cancel')} variant="link" onPress={() => router.back()} /> : null}
      </ScrollView>
    </View>
  );
}
