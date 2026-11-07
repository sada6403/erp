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
import { useSessionStore } from '@/store/sessionStore';
import { useUiStore } from '@/store/uiStore';
import { codeSchema, emailSchema } from './schemas';
import { homeRouteFor } from './session';

/** Optional "Add email" then 6-digit verification code (company SMTP, 15 min). */
export function VerifyEmailScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const guard = useServerActionGuard();
  const user = useSessionStore((s) => s.user);
  const patchUser = useSessionStore((s) => s.patchUser);
  const showToast = useUiStore((s) => s.showToast);
  const [step, setStep] = useState<'email' | 'code'>('email');
  const [busy, setBusy] = useState(false);
  const emailForm = useForm<{ email: string }>({ resolver: zodResolver(emailSchema), defaultValues: { email: user?.email ?? '' } });
  const codeForm = useForm<{ code: string }>({ resolver: zodResolver(codeSchema), defaultValues: { code: '' } });

  const leave = () => router.replace((user ? homeRouteFor({ ...user, must_change_password: false }) : '/') as never);

  const sendCode = emailForm.handleSubmit((v) =>
    guard(async () => {
      setBusy(true);
      try {
        const res = await authApi.emailStart({ email: v.email });
        if (!res.smtp_configured) showToast(t('auth.emailUnavailable'));
        else {
          patchUser({ email: v.email });
          setStep('code');
        }
      } catch (e) {
        showToast(errorMessage(e, t));
      } finally {
        setBusy(false);
      }
    }),
  );

  const verify = codeForm.handleSubmit((v) =>
    guard(async () => {
      setBusy(true);
      try {
        const res = await authApi.emailVerify({ code: v.code });
        patchUser({ email: res.email, email_verified: true });
        showToast(t('auth.emailVerified'));
        leave();
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
        <Text size={42} align="center">✉️</Text>
        <Text size={20} weight={800} align="center" style={{ marginVertical: 6 }}>
          {t('auth.emailTitle')}
        </Text>
        <Text size={12} color="textMuted" align="center" style={{ marginBottom: 20 }} lineHeightRatio={1.45}>
          {step === 'email' ? t('auth.emailSub') : t('auth.codeSub')}
        </Text>
        {step === 'email' ? (
          <>
            <FormField control={emailForm.control} name="email" label={t('auth.email')} keyboardType="email-address" autoCapitalize="none" />
            <Button label={t('auth.sendCode')} loading={busy} onPress={sendCode} />
          </>
        ) : (
          <>
            <FormField control={codeForm.control} name="code" label={t('auth.code')} keyboardType="number-pad" maxLength={6} />
            <Button label={t('auth.verify')} loading={busy} onPress={verify} />
          </>
        )}
        <Button label={t('auth.skipForNow')} variant="link" onPress={leave} />
      </ScrollView>
    </View>
  );
}
