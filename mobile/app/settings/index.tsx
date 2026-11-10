import React, { useEffect, useState } from 'react';
import { Linking, Pressable, View } from 'react-native';
import Constants from 'expo-constants';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useTheme, radii, themes, type ThemeKey } from '@/theme';
import { Text } from '@/components/Text';
import { Button } from '@/components/Button';
import { Card, ScreenHeading } from '@/components/ui';
import { Frame, Screen } from '@/components/Shell';
import { LANGS } from '@/i18n';
import { ENV } from '@/lib/env';
import { formatPhone } from '@/lib/format';
import { useThemeStore } from '@/store/themeStore';
import { useSessionStore } from '@/store/sessionStore';
import { logout } from '@/features/auth/session';
import { getPermissionStatus } from '@/features/push/push';
import { authApi } from '@/api/endpoints';
import { useCompany } from '@/features/common/hooks';
import { selectIsOffline, useUiStore } from '@/store/uiStore';

/** Card title row (.settings-card-title): emoji + title, 14/800, 4 dp below. */
function CardTitle({ icon, title }: { icon: string; title: string }) {
  return (
    <Text size={14} weight={800} style={{ marginBottom: 4 }}>
      {icon} {title}
    </Text>
  );
}

/** Account & preferences: profile, theme, language, notifications, security, version + sign out. */
export default function SettingsScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const router = useRouter();
  const user = useSessionStore((s) => s.user);
  const role = useSessionStore((s) => s.activeRole);
  const branch = useSessionStore((s) => s.branchName);
  const company = useCompany();
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
      <Text size={13} weight={600} color={tone}>
        {label}
      </Text>
      <Text size={14} color="textMuted">
        ➔
      </Text>
    </Pressable>
  );

  const accountLabel = t(`settings.accountType.${role}`);

  return (
    <Frame>
      <Screen>
        <ScreenHeading title={t('settings.title')} />

        {/* .user-profile-header */}
        {user ? (
          <Card radius={radii.card} padding={16}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
              <View style={{ width: 52, height: 52, borderRadius: radii.circle, backgroundColor: theme.colors.container, alignItems: 'center', justifyContent: 'center' }}>
                <Text size={26}>👤</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text size={16} weight={800}>
                  {user.name}
                </Text>
                <Text size={12} color="textMuted" style={{ marginTop: 2 }}>
                  {[user.phone ? formatPhone(user.phone) : user.email, accountLabel].filter(Boolean).join(' • ')}
                </Text>
                {user.member_no || user.agent_code ? (
                  <Text size={11} weight={700} color="primary" style={{ marginTop: 2 }}>
                    {user.member_no ? `${t('settings.member')} ${user.member_no}` : ''}
                    {user.member_no && user.agent_code ? ' • ' : ''}
                    {user.agent_code ? `${t('settings.agentCode')} ${user.agent_code}` : ''}
                  </Text>
                ) : null}
              </View>
            </View>
            {roles.length > 1 ? (
              <View style={{ flexDirection: 'row', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
                {roles.map((r) => (
                  <Button
                    key={r}
                    label={t(`role.${r}`)}
                    variant={role === r ? 'primarySm' : 'secondarySm'}
                    onPress={() => {
                      setActiveRole(r);
                      router.replace(r === 'agent' ? '/deliveries' : r === 'smartbuy' ? '/schemes' : '/');
                    }}
                  />
                ))}
              </View>
            ) : null}
          </Card>
        ) : (
          <Card radius={radii.card} padding={16}>
            <Text size={13} color="textMuted" style={{ marginBottom: 10 }}>
              {t('settings.guest')}
            </Text>
            <Button label={`${t('auth.signIn')} ➔`} variant="loginBlock" fullWidth onPress={() => router.push('/login')} />
          </Card>
        )}

        {/* Color theme picker */}
        <Card radius={radii.card} padding={16}>
          <CardTitle icon="🎨" title={t('settings.themeTitle')} />
          <Text size={11} color="textMuted" lineHeightRatio={1.4} style={{ marginBottom: 12 }}>
            {t('settings.themeDesc')}
          </Text>
          <View style={{ gap: 10 }}>
            {(Object.keys(themes) as ThemeKey[]).map((k) => {
              const th = themes[k];
              const active = k === themeKey;
              return (
                <Pressable
                  key={k}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: active }}
                  accessibilityLabel={t(th.nameKey)}
                  onPress={() => setTheme(k)}
                  style={{
                    minHeight: 52,
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 12,
                    padding: 12,
                    borderRadius: radii.control,
                    borderWidth: 2,
                    borderColor: active ? theme.colors.primary : theme.colors.surfaceBorder,
                    backgroundColor: active ? theme.colors.container : theme.colors.transparent,
                  }}
                >
                  <View style={{ flexDirection: 'row', width: 44, height: 24, borderRadius: radii.sm, overflow: 'hidden' }}>
                    <View style={{ flex: 1, backgroundColor: th.colors.primary }} />
                    <View style={{ flex: 1, backgroundColor: th.colors.container }} />
                    <View style={{ flex: 1, backgroundColor: th.colors.accent }} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text size={13} weight={700}>
                      {t(th.nameKey)}
                    </Text>
                  </View>
                  {active ? (
                    <Text size={16} weight={800} color="primary">
                      ✓
                    </Text>
                  ) : null}
                </Pressable>
              );
            })}
          </View>
        </Card>

        {/* Language */}
        <Card radius={radii.card} padding={16}>
          <CardTitle icon="🌐" title={t('settings.langTitle')} />
          <View style={{ flexDirection: 'row', gap: 8 }}>
            {LANGS.map((l) => {
              const active = language === l.code;
              return (
                <Pressable
                  key={l.code}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: active }}
                  accessibilityLabel={l.label}
                  onPress={() => pickLang(l.code)}
                  style={{
                    flex: 1,
                    minHeight: 48,
                    alignItems: 'center',
                    justifyContent: 'center',
                    borderRadius: radii.input,
                    borderWidth: 1,
                    borderColor: active ? theme.colors.primary : theme.colors.surfaceBorder,
                    backgroundColor: active ? theme.colors.primary : theme.colors.surfaceSubtle,
                  }}
                >
                  <Text size={13} weight={700} color={active ? 'white' : 'textMain'}>
                    {l.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </Card>

        {user ? (
          <Card radius={radii.card} padding={16}>
            <CardTitle icon="🔔" title={t('settings.notifications')} />
            <Text size={12} color={perm === 'granted' ? 'success' : 'warning'} weight={700}>
              {perm === 'granted' ? t('settings.pushOn') : t('settings.pushOff')}
            </Text>
            {perm !== 'granted' ? <Button label={t('settings.enablePush')} variant="secondaryBlock" fullWidth style={{ marginTop: 8 }} onPress={() => router.push('/notification-permission')} /> : null}
            {row(t('settings.notificationSettings'), () => router.push('/settings/notification-settings'))}
            {row(t('notifications.inbox'), () => router.push('/notifications'))}
          </Card>
        ) : null}

        {user ? (
          <Card radius={radii.card} padding={16}>
            <CardTitle icon="🔒" title={t('settings.security')} />
            {row(t('settings.changePassword'), () => router.push('/settings/password'))}
            {row(t('settings.deleteAccount'), () => router.push('/settings/delete-account'), 'error')}
          </Card>
        ) : null}

        {/* Help & contact: everything comes from POS company settings, nothing is hard-coded in the app */}
        {company && (company.support_phone || company.support_email || company.website || company.address) ? (
          <Card radius={radii.card} padding={16}>
            <CardTitle icon="💬" title={t('settings.companyContact')} />
            <Text size={11} color="textMuted" lineHeightRatio={1.4} style={{ marginBottom: 8 }}>
              {t('settings.companyContactSub')}
            </Text>
            <Text size={13} weight={700}>{company.legal_name}</Text>
            {company.address ? <Text size={12} color="textMuted" lineHeightRatio={1.4}>{company.address}</Text> : null}
            {company.tin ? <Text size={11} color="textMuted">{t('settings.companyRegNo')}: {company.tin}</Text> : null}
            <View style={{ marginTop: 10, gap: 8 }}>
              {company.support_phone ? <Button label={`📞 ${t('settings.companyCall')}: ${company.support_phone}`} variant="secondaryBlock" fullWidth onPress={() => Linking.openURL(`tel:${company.support_phone}`)} /> : null}
              {company.support_email ? <Button label={`✉️ ${t('settings.companyEmail')}: ${company.support_email}`} variant="secondaryBlock" fullWidth onPress={() => Linking.openURL(`mailto:${company.support_email}`)} /> : null}
              {company.website ? <Button label={`🌐 ${t('settings.companyWebsite')}: ${company.website}`} variant="secondaryBlock" fullWidth onPress={() => Linking.openURL(/^https?:/i.test(company.website!) ? company.website! : `https://${company.website}`)} /> : null}
              <Button label={`🔒 ${t('settings.companyPrivacy')}`} variant="secondaryBlock" fullWidth onPress={() => Linking.openURL(company.privacy_url)} />
              <Button label={`🗑️ ${t('settings.companyDeleteInfo')}`} variant="secondaryBlock" fullWidth onPress={() => Linking.openURL(company.delete_account_url)} />
            </View>
          </Card>
        ) : null}

        {/* App info + sign out */}
        <Card radius={radii.card} padding={16}>
          <CardTitle icon="ℹ️" title={t('settings.aboutTitle', { app: company?.name || t('app.name'), version: Constants.expoConfig?.version ?? '1.0.0' })} />
          <Text size={11} color="textMuted" lineHeightRatio={1.4} style={{ marginBottom: 12 }}>
            {t('settings.aboutDesc', { tenant: branch ?? (company?.name || t('app.name')) })}
            {ENV.appEnv !== 'production' ? ` • ${ENV.appEnv}` : ''}
          </Text>
          {user ? (
            <Button label={`🚪 ${t('settings.logoutFull')}`} variant="logout" fullWidth onPress={() => logout().then(() => router.replace('/'))} />
          ) : null}
        </Card>
      </Screen>
    </Frame>
  );
}
