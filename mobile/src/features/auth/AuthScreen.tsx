import React, { useState } from 'react';
import { Image } from 'expo-image';
import { Pressable, ScrollView, View } from 'react-native';
import { useForm } from 'react-hook-form';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { makeStyles, radii, shadows, useTheme } from '@/theme';
import { Text } from '@/components/Text';
import { Button } from '@/components/Button';
import { Gradient } from '@/components/Gradient';
import { FormField } from '@/components/FormField';
import { zodResolver } from '@/lib/zodResolver';
import { errorMessage } from '@/lib/errors';
import { toAppError } from '@/api/client';
import { ENV } from '@/lib/env';
import { authApi } from '@/api/endpoints';
import { useSessionStore } from '@/store/sessionStore';
import { useUiStore } from '@/store/uiStore';
import { homeRouteFor, login, register } from './session';
import { loginSchema, registerSchema, resetSchema, type LoginForm, type RegisterForm } from './schemas';

const logo = require('../../../assets/logo.jpg');

/** The demo pre-fills the sign-in form; only with dev mocks (never in a real build). */
const DEV_LOGIN = __DEV__ && ENV.useMocks ? { identifier: '0771234567', password: 'dev-password' } : { identifier: '', password: '' };

type Mode = 'login' | 'register' | 'forgot' | 'reset';

const useStyles = makeStyles((t) => ({
  nav: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: t.colors.surfaceBorder },
  back: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 7,
    paddingHorizontal: 14,
    borderRadius: radii.hero,
    backgroundColor: t.colors.surfaceSubtle,
    borderWidth: 1,
    borderColor: t.colors.surfaceBorder,
  },
  tabs: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: t.colors.surfaceBorder, marginBottom: 14 },
  tab: { flex: 1, minHeight: 44, padding: 10, alignItems: 'center', justifyContent: 'center' },
  tabLine: { position: 'absolute', bottom: -1, left: '10%', right: '10%', height: 2, backgroundColor: t.colors.primary },
  demo: { marginTop: 14, paddingTop: 12, borderTopWidth: 1, borderTopColor: t.colors.surfaceBorder, borderStyle: 'dashed' },
  check: { width: 16, height: 16, borderRadius: radii.xs - 1, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  demoRow: { flexDirection: 'row', gap: 6 },
  demoCard: {
    flex: 1,
    minHeight: 58,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: t.colors.surfaceSubtle,
    borderWidth: 1.5,
    borderColor: t.colors.surfaceBorder,
    borderRadius: radii.chip,
    paddingVertical: 8,
    paddingHorizontal: 4,
  },
}));

/** Login screen with Sign in / Sign up tabs. ONE identifier field: mobile number, member number or agent code. */
export function AuthScreen({ initialMode = 'login' }: { initialMode?: Mode }) {
  const s = useStyles();
  const theme = useTheme();
  const { t } = useTranslation();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const showToast = useUiStore((x) => x.showToast);
  const [mode, setMode] = useState<Mode>(initialMode);
  const [show, setShow] = useState(false);
  const [remember, setRemember] = useState(true);
  const [busy, setBusy] = useState(false);
  const [forgotId, setForgotId] = useState('');

  const loginForm = useForm<LoginForm>({ resolver: zodResolver(loginSchema), defaultValues: DEV_LOGIN, mode: 'onTouched' });
  const regForm = useForm<RegisterForm>({ resolver: zodResolver(registerSchema), defaultValues: { name: '', phone: '', password: '' } });
  const resetForm = useForm<{ code: string; password: string }>({ resolver: zodResolver(resetSchema), defaultValues: { code: '', password: '' } });

  const finish = (user: Parameters<typeof homeRouteFor>[0], welcome: string) => {
    showToast(welcome);
    const pending = useSessionStore.getState().pendingRoute;
    const home = homeRouteFor(user);
    if (pending && home === '/') {
      useSessionStore.getState().setPendingRoute(null);
      router.replace(pending as never);
    } else if (!useSessionStore.getState().pushExplained && home !== '/set-password') {
      router.replace({ pathname: '/notification-permission', params: { next: home } } as never);
    } else {
      router.replace(home as never);
    }
  };

  const doLogin = async (identifier: string, password: string) => {
    setBusy(true);
    try {
      const res = await login(identifier, password);
      finish(res.user, t('auth.welcome', { name: res.user.name }));
    } catch (e) {
      showToast(errorMessage(e, t));
    } finally {
      setBusy(false);
    }
  };

  const onLogin = loginForm.handleSubmit((v) => doLogin(v.identifier, v.password));
  const onRegister = regForm.handleSubmit(async (v) => {
    setBusy(true);
    try {
      const res = await register(v);
      finish(res.user, t('auth.created', { name: res.user.name }));
    } catch (e) {
      showToast(toAppError(e).status === 409 ? t('auth.phoneTaken') : errorMessage(e, t));
    } finally {
      setBusy(false);
    }
  });

  const onForgot = async () => {
    const id = loginForm.getValues('identifier').trim();
    if (!id) {
      loginForm.setError('identifier', { message: 'validation.identifierRequired' });
      return;
    }
    setBusy(true);
    try {
      const res = await authApi.forgot({ identifier: id });
      setForgotId(id);
      showToast(res.message);
      if (res.method === 'email_code') {
        resetForm.reset({ code: '', password: '' });
        setMode('reset');
      }
    } catch (e) {
      showToast(errorMessage(e, t));
    } finally {
      setBusy(false);
    }
  };

  const onReset = resetForm.handleSubmit(async (v) => {
    setBusy(true);
    try {
      await authApi.forgotReset({ identifier: forgotId, code: v.code, new_password: v.password });
      showToast(t('auth.resetDone'));
      setMode('login');
    } catch (e) {
      showToast(errorMessage(e, t));
    } finally {
      setBusy(false);
    }
  });

  const eye = (
    <Pressable accessibilityRole="button" accessibilityLabel={t('auth.togglePassword')} onPress={() => setShow((v) => !v)} hitSlop={10} style={{ paddingVertical: 4, paddingHorizontal: 6 }}>
      <Text size={16} color="textMuted">👁️</Text>
    </Pressable>
  );

  const tab = (key: 'login' | 'register', label: string) => (
    <Pressable key={key} accessibilityRole="tab" accessibilityState={{ selected: mode === key }} hitSlop={{ top: 2, bottom: 2 }} style={s.tab} onPress={() => setMode(key)}>
      <Text size={12} weight={700} color={mode === key ? 'primary' : 'textMuted'}>
        {label}
      </Text>
      {mode === key ? <View style={s.tabLine} /> : null}
    </Pressable>
  );

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.surface, paddingTop: insets.top }}>
      <View style={s.nav}>
        <Pressable accessibilityRole="button" accessibilityLabel={t('auth.back')} hitSlop={{ top: 6, bottom: 6 }} style={s.back} onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))}>
          <Text size={15} weight={800}>←</Text>
          <Text size={12} weight={700}>{t('auth.back')}</Text>
        </Pressable>
      </View>
      <ScrollView contentContainerStyle={{ paddingTop: 18, paddingHorizontal: 16, paddingBottom: 36 + insets.bottom }} keyboardShouldPersistTaps="handled">
        <View style={{ alignItems: 'center', marginBottom: 18 }}>
          <View style={[{ width: 82, height: 82, borderRadius: radii.circle, marginBottom: 10, backgroundColor: theme.colors.primary }, shadows.card]}>
            <Gradient from={theme.colors.primary} to={theme.colors.accent} style={{ width: 82, height: 82, borderRadius: radii.circle, padding: 3 }}>
              <Image source={logo} style={{ width: '100%', height: '100%', borderRadius: radii.circle, backgroundColor: theme.colors.surface }} contentFit="cover" accessibilityLabel={t('app.name')} />
            </Gradient>
          </View>
          <Text size={21} weight={800} color="primary" letterSpacing={-0.3} style={{ marginBottom: 3 }}>{t('app.name')}</Text>
          <Text size={12} weight={500} color="textMuted" style={{ marginBottom: 8 }} align="center">
            {mode === 'register' ? t('auth.subtitleRegister') : mode === 'reset' ? t('auth.subtitleReset') : t('auth.subtitle')}
          </Text>
        </View>

        {mode === 'login' || mode === 'register' ? (
          <View style={s.tabs}>
            {tab('login', t('auth.signIn'))}
            {tab('register', t('auth.signUp'))}
          </View>
        ) : null}

        {mode === 'login' ? (
          <View>
            <FormField control={loginForm.control} name="identifier" label={t('auth.identifier')} left="👤" placeholder={t('auth.identifierPlaceholder')} autoCapitalize="none" autoCorrect={false} />
            <FormField control={loginForm.control} name="password" label={t('auth.password')} left="🔒" placeholder="••••••••" secureTextEntry={!show} right={eye} autoCapitalize="none" />
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 10, marginBottom: 16 }}>
              <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: remember }} hitSlop={{ top: 12, bottom: 12, right: 12 }} onPress={() => setRemember((v) => !v)} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <View style={[s.check, { borderColor: theme.colors.primary, backgroundColor: remember ? theme.colors.primary : theme.colors.surface }]}>
                  {remember ? <Text size={10} weight={800} color="white">✓</Text> : null}
                </View>
                <Text size={12} weight={600} color="textMuted">{t('auth.rememberMe')}</Text>
              </Pressable>
              <Pressable accessibilityRole="link" hitSlop={{ top: 12, bottom: 12, left: 12 }} onPress={onForgot}>
                <Text size={11.5} weight={700} color="primary" style={{ textDecorationLine: 'underline' }}>{t('auth.forgot')}</Text>
              </Pressable>
            </View>
            <Button label={`${t('auth.signIn')} ➔`} variant="loginBlock" fullWidth loading={busy} onPress={onLogin} style={{ marginTop: 6 }} />

            {__DEV__ && ENV.useMocks ? (
              <View style={s.demo}>
                <Text size={11} weight={700} color="textMuted" style={{ marginBottom: 8 }}>⚡ Quick Login (Demo):</Text>
                <View style={s.demoRow}>
                  {[
                    { icon: '🛒', label: 'Customer', id: '0771234567' },
                    { icon: '💎', label: 'Smart Buy', id: 'NP-1042' },
                    { icon: '🛵', label: 'Field Agent', id: 'NP-AG-204' },
                  ].map((d) => (
                    <Pressable key={d.id} accessibilityRole="button" accessibilityLabel={d.label} style={s.demoCard} onPress={() => doLogin(d.id, 'dev-password')}>
                      <Text size={16} style={{ marginBottom: 2 }}>{d.icon}</Text>
                      <Text size={11} weight={700} style={{ marginBottom: 2 }}>{d.label}</Text>
                      <Text size={10} weight={700} color="primary">{t('header.login')}</Text>
                    </Pressable>
                  ))}
                </View>
              </View>
            ) : null}
          </View>
        ) : null}

        {mode === 'register' ? (
          <View>
            <FormField control={regForm.control} name="name" label={t('auth.fullName')} placeholder={t('auth.fullNamePlaceholder')} />
            <FormField control={regForm.control} name="phone" label={t('auth.mobile')} placeholder="07XXXXXXXX" keyboardType="phone-pad" />
            <FormField control={regForm.control} name="password" label={t('auth.password')} placeholder={t('auth.createPassword')} secureTextEntry={!show} right={eye} autoCapitalize="none" hint={t('auth.passwordHint')} />
            <Button label={`${t('auth.createAccount')} ➔`} variant="loginBlock" fullWidth loading={busy} onPress={onRegister} style={{ marginTop: 6 }} />
          </View>
        ) : null}

        {mode === 'reset' ? (
          <View>
            <Text size={15} weight={800} style={{ marginBottom: 12 }}>{t('auth.resetTitle')}</Text>
            <FormField control={resetForm.control} name="code" label={t('auth.code')} keyboardType="number-pad" maxLength={6} />
            <FormField control={resetForm.control} name="password" label={t('auth.newPassword')} secureTextEntry autoCapitalize="none" />
            <Button label={t('auth.resetPassword')} loading={busy} onPress={onReset} />
            <Button label={t('common.cancel')} variant="link" onPress={() => setMode('login')} />
          </View>
        ) : null}
      </ScrollView>
    </View>
  );
}
