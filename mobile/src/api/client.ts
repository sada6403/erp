import axios, {
  AxiosError,
  type AxiosAdapter,
  type AxiosInstance,
  type InternalAxiosRequestConfig,
} from 'axios';
import type { AppErrorBody, AppErrorCode } from '@contracts/common';
import type { AuthTokens, RefreshResponse } from '@contracts/auth';

export type ClientErrorCode = AppErrorCode | 'NETWORK' | 'TIMEOUT' | 'UNKNOWN';

export class AppApiError extends Error {
  code: ClientErrorCode;
  status?: number;
  details?: Record<string, unknown>;
  constructor(code: ClientErrorCode, message: string, status?: number, details?: Record<string, unknown>) {
    super(message);
    this.name = 'AppApiError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
  /** True when the phone or the server could not be reached (offline / 5xx / timeout). */
  get isUnreachable(): boolean {
    return this.code === 'NETWORK' || this.code === 'TIMEOUT' || (this.status != null && this.status >= 500);
  }
}

export interface StoredTokens {
  accessToken: string;
  refreshToken: string;
}

/** Abstraction over expo-secure-store so the client is unit-testable. */
export interface TokenStore {
  get(): Promise<StoredTokens | null>;
  set(tokens: StoredTokens): Promise<void>;
  clear(): Promise<void>;
}

export interface ApiClientOptions {
  baseURL: string;
  appKey: string;
  appVersion: string;
  tokens: TokenStore;
  deviceId?: () => string | undefined;
  /** Called when the refresh token is rejected: the user must sign in again. */
  onSessionExpired?: () => void;
  /** Called with false on network error / 5xx, true on any successful response. */
  onReachability?: (reachable: boolean) => void;
  onTokensRotated?: (tokens: AuthTokens) => void;
  timeoutMs?: number;
  /** Tests and dev mocks inject an adapter. */
  adapter?: AxiosAdapter;
}

interface RetryConfig extends InternalAxiosRequestConfig {
  _retried?: boolean;
  _skipAuth?: boolean;
}

/** Endpoints that must never trigger a refresh attempt. */
const NO_REFRESH = ['/auth/login', '/auth/register', '/auth/refresh', '/auth/forgot'];

export function toAppError(err: unknown): AppApiError {
  if (err instanceof AppApiError) return err;
  if (axios.isAxiosError(err)) {
    const e = err as AxiosError<Partial<AppErrorBody>>;
    const body = e.response?.data?.error;
    if (body?.code) return new AppApiError(body.code, body.message ?? 'Request failed', e.response?.status, body.details);
    if (e.response) return new AppApiError('UNKNOWN', e.message, e.response.status);
    if (e.code === 'ECONNABORTED' || e.code === 'ETIMEDOUT') return new AppApiError('TIMEOUT', 'Request timed out');
    return new AppApiError('NETWORK', 'Network unreachable');
  }
  return new AppApiError('UNKNOWN', err instanceof Error ? err.message : 'Unknown error');
}

export function createApiClient(opts: ApiClientOptions): AxiosInstance {
  const instance = axios.create({
    baseURL: opts.baseURL,
    timeout: opts.timeoutMs ?? 15_000,
    headers: { 'x-app-key': opts.appKey, 'x-app-version': opts.appVersion, Accept: 'application/json' },
    adapter: opts.adapter,
  });

  let refreshing: Promise<StoredTokens> | null = null;

  async function refreshTokens(): Promise<StoredTokens> {
    const current = await opts.tokens.get();
    if (!current?.refreshToken) throw new AppApiError('UNAUTHORIZED', 'No refresh token');
    // Use a bare call so interceptors do not recurse.
    const res = await instance.post<RefreshResponse>(
      '/auth/refresh',
      { refresh_token: current.refreshToken, device_id: opts.deviceId?.() },
      { _skipAuth: true } as RetryConfig,
    );
    const next: StoredTokens = { accessToken: res.data.access_token, refreshToken: res.data.refresh_token };
    await opts.tokens.set(next); // rotation: the old refresh token is now dead
    opts.onTokensRotated?.(res.data);
    return next;
  }

  instance.interceptors.request.use(async (config: RetryConfig) => {
    if (config._skipAuth) return config;
    if (!config.headers.has('Authorization')) {
      const t = await opts.tokens.get();
      if (t?.accessToken) config.headers.set('Authorization', `Bearer ${t.accessToken}`);
    }
    return config;
  });

  instance.interceptors.response.use(
    (res) => {
      opts.onReachability?.(true);
      return res;
    },
    async (error: unknown) => {
      const appError = toAppError(error);
      const config = (axios.isAxiosError(error) ? error.config : undefined) as RetryConfig | undefined;

      if (appError.isUnreachable) opts.onReachability?.(false);
      else if (appError.status != null) opts.onReachability?.(true);

      const url = config?.url ?? '';
      const canRefresh =
        appError.status === 401 &&
        config != null &&
        !config._retried &&
        !NO_REFRESH.some((p) => url.startsWith(p)) &&
        (appError.code === 'TOKEN_EXPIRED' || appError.code === 'UNAUTHORIZED');

      if (!canRefresh || !config) throw appError;

      try {
        refreshing ??= refreshTokens().finally(() => {
          refreshing = null;
        });
        const fresh = await refreshing;
        config._retried = true;
        config.headers.set('Authorization', `Bearer ${fresh.accessToken}`);
        return await instance.request(config);
      } catch (refreshErr) {
        const e = toAppError(refreshErr);
        // A dead phone line must not log the user out; only a rejected refresh token does.
        if (!e.isUnreachable) {
          await opts.tokens.clear();
          opts.onSessionExpired?.();
        }
        throw e;
      }
    },
  );

  return instance;
}
