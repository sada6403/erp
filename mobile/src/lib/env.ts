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

export const API_PREFIX = '/api/app/v1';
