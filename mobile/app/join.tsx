import React from 'react';
import { Redirect, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { usePreventScreenCapture } from 'expo-screen-capture';
import { Button } from '@/components/Button';
import { Frame, Screen } from '@/components/Shell';
import { Text } from '@/components/Text';
import { ScreenHeading } from '@/components/ui';
import { JoinForm } from '@/features/smartbuy/JoinForm';
import { useSessionStore } from '@/store/sessionStore';

/** Customer self join to Smart Buy. It takes an NIC and shows NIC photos, so screen capture is blocked. */
export default function JoinScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const loggedIn = useSessionStore((s) => !!s.user);
  usePreventScreenCapture();
  if (!loggedIn) return <Redirect href="/login" />;
  return (
    <Frame>
      <Screen>
        <ScreenHeading title={t('join.title')} sub={t('join.blurb')} />
        <JoinForm />
        <Button label={t('joinReq.myRequestsTitle')} variant="link" onPress={() => router.push('/join-requests')} />
        <Text size={11} color="textMuted" align="center">{t('join.approvalNote')}</Text>
        <Button label={t('common.back')} variant="secondaryBlock" fullWidth onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))} />
      </Screen>
    </Frame>
  );
}
