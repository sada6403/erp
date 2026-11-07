import React, { useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';
import Constants from 'expo-constants';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useTheme, radii, themes, type ThemeKey } from '@/theme';
import { Text } from '@/components/Text';
import { Button } from '@/components/Button';
import { Card, ScreenHeading, SectionHeader } from '@/components/ui';
import { Frame, Screen } from '@/components/Shell';
import { LANGS } from '@/i18n';
import { ENV } from '@/lib/env';
import { formatPhone } from '@/lib/format';
import { useThemeStore } from '@/store/themeStore';
import { useSessionStore } from '@/store/sessionStore';
import { logout } from '@/features/auth/session';
import { getPermissionStatus } from '@/features/push/push';
import { authApi } from '@/api/endpoints';
import { selectIsOffline, useUiStore } from '@/store/uiStore';

/** Account & preferences: profile, theme, language, notifications, security, logout. */
export default function SettingsScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const router = useRouter();
  const user = useSessionStore((s) => s.user);
  const role = useSessionStore((s) => s.activeRole);
  const setActiveRole = useSessionStore((s) => s.setActiveRole);
  const patchUser = useSessionStore((s) => s.patchUser);
  const { theme: themeKey, language, setTheme, setLanguage } = useThemeStore();
  const offline = useUiStore(selectIsOffline);
  const [perm, setPerm] = useState<string>('undetermined');

  useEffect(() => {
    getPermissionStatus().then(setPerm).catch(() => undefined);
  }, []);

  const pickLang = (code: (typeof LANGS)[number]['code']) => {
    setLanguage(code);
    if (user && !offline) authApi.updateMe({ language: code }).then(() => patchUser({ language: code })).catch(() => undefined);
  };
  const roles = user?.roles ?? [];

  const row = (label: string, onPress: () => void, tone: 'textMain' | 'error' = 'textMain') => (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={{ minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
      <Text size={13} weight={600} color={tone}>{label}</Text>
      <Text size={14} color="textMuted">➔</Text>
    </Pressable>
  );

  return (
    <Frame>
      <Screen>
        <ScreenHeading title={t('settings.title')} sub={t('settings.sub')} />

        {user ? (
          <Card>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <View style={{ width: 52, height: 52, borderRadius: 26, backgroundColor: theme.colors.primary, alignItems: 'center', justifyContent: 'center' }}>
                <Text size={20} weight={800} color="white">{user.name.slice(0, 1).toUpperCase()}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text size={15} weight={800}>{user.name}</Text>
                {user.phone ? <Text size={12} color="textMuted">{formatPhone(user.phone)}</Text> : null}
                {user.email ? <Text size={12} color="textMuted">{user.email}</Text> : null}
                {user.member_no ? <Text size={11} weight={700} color="primary">{t('settings.member')} {user.member_no}</Text> : null}
                {user.agent_code ? <Text size={11} weight={700} color="primary">{t('settings.agentCode')} {user.agent_code}</Text> : null}
              </View>
            </View>
            {roles.length > 1 ? (
              <View style={{ flexDirection: 'row', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
                {roles.map((r) => (
                  <Button key={r} label={t(`role.${r}`)} variant={role === r ? 'primarySm' : 'secondarySm'} onPress={() => { setActiveRole(r); router.replace(r === 'agent' ? '/deliveries' : r === 'smartbuy' ? '/schemes' : '/'); }} />
                ))}
              </View>
            ) : null}
          </Card>
        ) : (
          <Card>
            <Text size={13} color="textMuted" style={{ marginBottom: 10 }}>{t('settings.guest')}</Text>
            <Button label={t('auth.signIn')} onPress={() => router.push('/login')} />
          </Card>
        )}

        <Card>
          <SectionHeader icon="🎨" title={t('settings.theme')} />
          <View style={{ flexDirection: 'row', gap: 10 }}>
            {(Object.keys(themes) as ThemeKey[]).map((k) => {
              const th = themes[k];
              const active = k === themeKey;
              return (
                <Pressable key={k} accessibilityRole="radio" accessibilityState={{ selected: active }} accessibilityLabel={t(th.nameKey)} onPress={() => setTheme(k)} style={{ flex: 1, minHeight: 72, padding: 10, borderRadius: radii.control, borderWidth: 2, borderColor: active ? th.colors.primary : theme.colors.surfaceBorder, backgroundColor: theme.colors.surface }}>
                  <View style={{ flexDirection: 'row', gap: 6, marginBottom: 6 }}>
                    <View style={{ width: 24, height: 24, borderRadius: 12, backgroundColor: th.colors.primary }} />
                    <View style={{ width: 24, height: 24, borderRadius: 12, backgroundColor: th.colors.accent }} />
                  </View>
                  <Text size={12} weight={700}>{t(th.nameKey)}</Text>
                </Pressable>
              );
            })}
          </View>
        </Card>

        <Card>
          <SectionHeader icon="🌐" title={t('settings.language')} />
          <View style={{ flexDirection: 'row', gap: 8 }}>
            {LANGS.map((l) => (
              <Button key={l.code} label={l.label} variant={language === l.code ? 'primarySm' : 'secondarySm'} onPress={() => pickLang(l.code)} style={{ flex: 1 }} accessibilityLabel={l.label} />
            ))}
          </View>
        </Card>

        {user ? (
          <Card>
            <SectionHeader icon="🔔" title={t('settings.notifications')} />
            <Text size={12} color={perm === 'granted' ? 'success' : 'warning'} weight={700}>
              {perm === 'granted' ? t('settings.pushOn') : t('settings.pushOff')}
            </Text>
            {perm !== 'granted' ? <Button label={t('settings.enablePush')} variant="secondaryBlock" style={{ marginTop: 8 }} onPress={() => router.push('/notification-permission')} /> : null}
            {row(t('settings.notificationSettings'), () => router.push('/settings/notification-settings'))}
            {row(t('notifications.title'), () => router.push('/notifications'))}
          </Card>
        ) : null}

        {user ? (
          <Card>
            <SectionHeader icon="🔒" title={t('settings.security')} />
            {row(t('settings.changePassword'), () => router.push('/settings/password'))}
            {row(t('settings.deleteAccount'), () => router.push('/settings/delete-account'), 'error')}
          </Card>
        ) : null}

        <Card>
          <SectionHeader icon="ℹ️" title={t('settings.about')} />
          <Text size={12} color="textMuted">{t('app.name')} v{Constants.expoConfig?.version ?? '1.0.0'}{ENV.appEnv !== 'production' ? ` (${ENV.appEnv})` : ''}</Text>
        </Card>

        {user ? <Button label={t('settings.logout')} variant="logout" onPress={() => logout().then(() => router.replace('/'))} /> : null}
      </Screen>
    </Frame>
  );
}
