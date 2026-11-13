import Constants from 'expo-constants';
import * as Device from 'expo-device';

interface Extra {
  appEnv?: string;
  apiBaseUrl?: string;
  apiBaseUrlDevice?: string;
  appKey?: string;
  useMocks?: boolean;
  androidPackage?: string;
}

const extra = ((Constants.expoConfig?.extra ?? {}) as Extra) || {};

/** Build-time configuration injected by app.config.ts. Nothing here is secret. */
/**
 * Dev builds only: a real phone reaches the PC through `adb reverse` (localhost), the emulator through 10.0.2.2.
 * Release builds always use apiBaseUrl.
 */
const baseUrl =
  __DEV__ && Device.isDevice
    ? (extra.apiBaseUrlDevice ?? 'http://localhost:3000')
    : (extra.apiBaseUrl ?? 'http://10.0.2.2:3000');

export const ENV = {
  appEnv: extra.appEnv ?? 'development',
  apiBaseUrl: baseUrl.replace(/\/+$/, ''),
  appKey: extra.appKey ?? '',
  androidPackage: extra.androidPackage ?? 'com.naturalplantation.app.dev',
  /** Mocks are only ever honoured in __DEV__ builds. */
  useMocks: __DEV__ && extra.useMocks === true,
  appVersion: Constants.expoConfig?.version ?? '1.0.0',
} as const;

/** Release channel: test APKs (staging flavour) follow "test", Play builds "production". Also the OTA channel. */
export const UPDATE_CHANNEL: 'test' | 'production' = ENV.appEnv === 'staging' ? 'test' : 'production';
/** Only the staging/test flavour may install an APK itself (REQUEST_INSTALL_PACKAGES exists only there). */
export const CAN_SELF_INSTALL = ENV.appEnv === 'staging';

export const API_PREFIX = '/api/app/v1';
