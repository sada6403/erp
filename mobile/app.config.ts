import type { ConfigContext, ExpoConfig } from 'expo/config';

/**
 * Natural Plantation app config.
 * Per build profile (eas.json) these come from env: ANDROID_PACKAGE, API_BASE_URL, APP_KEY, APP_ENV.
 * None of them are secrets: the App Key only identifies the company (AGENTS.md rule 1).
 * Never put the POS sync api_key here.
 */
const APP_ENV = process.env.APP_ENV ?? 'development';
// Dev default only. The real Play package comes from ANDROID_PACKAGE (Moni supplies it).
const ANDROID_PACKAGE = process.env.ANDROID_PACKAGE ?? 'com.naturalplantation.app.dev';
const API_BASE_URL = process.env.API_BASE_URL ?? 'http://10.0.2.2:3000';
const APP_KEY = process.env.APP_KEY ?? '';
// eas.json carries "__SET_AT_BUILD__" placeholders for production. Real values are supplied at build time
// (eas env / --environment variables) and never committed. A production build must not ship with a placeholder.
if (APP_ENV === 'production') {
  const missing = Object.entries({ ANDROID_PACKAGE, API_BASE_URL, APP_KEY })
    .filter(([, v]) => !v || v.includes('__SET_AT_BUILD__'))
    .map(([k]) => k);
  if (missing.length) throw new Error(`Production build needs real values for: ${missing.join(', ')} (set them at build time, see docs/mobile-app).`);
}
const EAS_PROJECT_ID = process.env.EAS_PROJECT_ID ?? '';
const EAS_UPDATE_URL =
  process.env.EAS_UPDATE_URL ?? (EAS_PROJECT_ID ? `https://u.expo.dev/${EAS_PROJECT_ID}` : '');
// Mocks are honoured only in __DEV__ builds (see src/dev). Default: on for APP_ENV=development.
const USE_MOCKS = process.env.USE_MOCKS ? process.env.USE_MOCKS === '1' : APP_ENV === 'development';

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  // Same app name in every build (the .staging package lets the test app sit next to the Play app); Settings, About shows Test server.
  name: 'Natural Plantation',
  slug: 'natural-plantation',
  scheme: 'naturalplantation',
  version: APP_ENV === 'staging' ? '1.0.0-test.9' : '1.0.0',
  orientation: 'portrait',
  userInterfaceStyle: 'light',
  icon: './assets/icon.png',
  android: {
    package: ANDROID_PACKAGE,
    versionCode: 1,
    adaptiveIcon: {
      backgroundColor: '#FFFFFF',
      foregroundImage: './assets/android-icon-foreground.png',
      backgroundImage: './assets/android-icon-background.png',
      monochromeImage: './assets/android-icon-monochrome.png',
    },
    predictiveBackGestureEnabled: false,
    // The test build installs its own APK updates (REQUEST_INSTALL_PACKAGES); the Play build must never carry it (Play policy, checked by scripts/check-play-manifest.mjs).
    ...(APP_ENV === 'staging' ? { permissions: ['android.permission.REQUEST_INSTALL_PACKAGES'] } : { blockedPermissions: ['android.permission.REQUEST_INSTALL_PACKAGES'] }),
    ...(process.env.GOOGLE_SERVICES_FILE ? { googleServicesFile: process.env.GOOGLE_SERVICES_FILE } : {}),
    // naturalplantation://orders/ONL-1023 etc.
    intentFilters: [
      {
        action: 'VIEW',
        category: ['BROWSABLE', 'DEFAULT'],
        data: [{ scheme: 'naturalplantation' }],
      },
    ],
  },
  runtimeVersion: { policy: 'appVersion' },
  updates: {
    enabled: Boolean(EAS_UPDATE_URL),
    checkAutomatically: 'ON_LOAD',
    // Channel: test APKs (staging) follow "test", Play builds follow "production". Local gradle builds have no EAS channel, so it is sent explicitly.
    requestHeaders: { 'expo-channel-name': APP_ENV === 'staging' ? 'test' : 'production' },
    fallbackToCacheTimeout: 0,
    ...(EAS_UPDATE_URL ? { url: EAS_UPDATE_URL } : {}),
  },
  plugins: [
    'expo-router',
    'expo-dev-client',
    'expo-secure-store',
    'expo-font',
    'expo-localization',
    'expo-video',
    'expo-sharing',
    [
      'expo-image-picker',
      {
        cameraPermission: 'Allow the camera to photograph a payment slip or an NIC.',
        photosPermission: 'Allow photo access to attach a payment slip or an NIC.',
        microphonePermission: false,
      },
    ],
    [
      'expo-location',
      { locationWhenInUsePermission: 'Allow location so a field visit records where it took place. It is only read while you save a visit.', isAndroidBackgroundLocationEnabled: false },
    ],
    [
      'expo-splash-screen',
      { backgroundColor: '#FFFFFF', image: './assets/splash-icon.png', imageWidth: 200 },
    ],
    [
      'expo-notifications',
      { icon: './assets/android-icon-monochrome.png', color: '#5A6B2E', defaultChannel: 'orders' },
    ],
  ],
  extra: {
    appEnv: APP_ENV,
    apiBaseUrl: API_BASE_URL,
    // Dev only: a physical phone reaches the PC via `adb reverse` (see scripts/phone.ps1).
    apiBaseUrlDevice: process.env.API_BASE_URL_DEVICE ?? 'http://localhost:3000',
    appKey: APP_KEY,
    useMocks: USE_MOCKS,
    androidPackage: ANDROID_PACKAGE,
    eas: EAS_PROJECT_ID ? { projectId: EAS_PROJECT_ID } : undefined,
  },
});
