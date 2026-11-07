import Constants from 'expo-constants';

interface Extra {
  appEnv?: string;
  apiBaseUrl?: string;
  appKey?: string;
  useMocks?: boolean;
  androidPackage?: string;
}

const extra = ((Constants.expoConfig?.extra ?? {}) as Extra) || {};

/** Build-time configuration injected by app.config.ts. Nothing here is secret. */
export const ENV = {
  appEnv: extra.appEnv ?? 'development',
  apiBaseUrl: (extra.apiBaseUrl ?? 'http://10.0.2.2:3000').replace(/\/+$/, ''),
  appKey: extra.appKey ?? '',
  androidPackage: extra.androidPackage ?? 'com.naturalplantation.app.dev',
  /** Mocks are only ever honoured in __DEV__ builds. */
  useMocks: __DEV__ && extra.useMocks === true,
  appVersion: Constants.expoConfig?.version ?? '1.0.0',
} as const;

export const API_PREFIX = '/api/app/v1';
