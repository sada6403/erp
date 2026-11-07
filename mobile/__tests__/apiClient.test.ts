import { AxiosError, type AxiosAdapter, type AxiosResponse, type InternalAxiosRequestConfig } from 'axios';
import { createApiClient, type StoredTokens, type TokenStore, AppApiError } from '@/api/client';

function memoryTokens(initial: StoredTokens | null): TokenStore & { current: StoredTokens | null } {
  const s = { current: initial } as TokenStore & { current: StoredTokens | null };
  s.get = async () => s.current;
  s.set = async (t) => {
    s.current = t;
  };
  s.clear = async () => {
    s.current = null;
  };
  return s;
}

const ok = (config: InternalAxiosRequestConfig, data: unknown): AxiosResponse => ({ data, status: 200, statusText: 'OK', headers: {}, config });
const fail = (config: InternalAxiosRequestConfig, status: number, code: string) =>
  new AxiosError(code, String(status), config, null, { data: { error: { code, message: code } }, status, statusText: code, headers: {}, config } as AxiosResponse);

function setup(handler: (config: InternalAxiosRequestConfig, calls: string[]) => AxiosResponse | Error, tokens = memoryTokens({ accessToken: 'old-a', refreshToken: 'old-r' })) {
  const calls: string[] = [];
  const adapter: AxiosAdapter = async (config) => {
    calls.push(`${config.method?.toUpperCase()} ${config.url}`);
    const r = handler(config, calls);
    if (r instanceof Error) throw r;
    return r;
  };
  const onSessionExpired = jest.fn();
  const onReachability = jest.fn();
  const client = createApiClient({ baseURL: 'http://test/api/app/v1', appKey: 'key-123', appVersion: '1.0.0', tokens, adapter, onSessionExpired, onReachability });
  return { client, calls, tokens, onSessionExpired, onReachability };
}

describe('api client', () => {
  it('sends x-app-key and the Bearer token', async () => {
    let seen: InternalAxiosRequestConfig | undefined;
    const { client } = setup((c) => {
      seen = c;
      return ok(c, { ok: true });
    });
    await client.get('/status');
    expect(seen?.headers.get('x-app-key')).toBe('key-123');
    expect(seen?.headers.get('Authorization')).toBe('Bearer old-a');
  });

  it('refreshes once on TOKEN_EXPIRED, stores the rotated tokens and retries', async () => {
    const { client, calls, tokens } = setup((c) => {
      if (c.url === '/auth/refresh') return ok(c, { access_token: 'new-a', refresh_token: 'new-r', expires_in: 900, user: {} });
      if (c.headers.get('Authorization') === 'Bearer new-a') return ok(c, { items: [] });
      return fail(c, 401, 'TOKEN_EXPIRED');
    });
    const res = await client.get('/orders');
    expect(res.data).toEqual({ items: [] });
    expect(tokens.current).toEqual({ accessToken: 'new-a', refreshToken: 'new-r' });
    expect(calls.filter((c) => c.includes('/auth/refresh'))).toHaveLength(1);
  });

  it('shares ONE refresh between parallel 401s (single flight)', async () => {
    const { client, calls } = setup((c) => {
      if (c.url === '/auth/refresh') return ok(c, { access_token: 'new-a', refresh_token: 'new-r', expires_in: 900, user: {} });
      if (c.headers.get('Authorization') === 'Bearer new-a') return ok(c, { fine: true });
      return fail(c, 401, 'TOKEN_EXPIRED');
    });
    await Promise.all([client.get('/orders'), client.get('/me/notifications'), client.get('/me/addresses')]);
    expect(calls.filter((c) => c.includes('/auth/refresh'))).toHaveLength(1);
  });

  it('signs the user out when the refresh token itself is rejected', async () => {
    const { client, tokens, onSessionExpired } = setup((c) => (c.url === '/auth/refresh' ? fail(c, 401, 'UNAUTHORIZED') : fail(c, 401, 'TOKEN_EXPIRED')));
    await expect(client.get('/orders')).rejects.toBeInstanceOf(AppApiError);
    expect(onSessionExpired).toHaveBeenCalledTimes(1);
    expect(tokens.current).toBeNull();
  });

  it('does NOT sign the user out when the refresh fails because the server is unreachable', async () => {
    const { client, tokens, onSessionExpired } = setup((c) => (c.url === '/auth/refresh' ? new AxiosError('Network Error', 'ERR_NETWORK', c) : fail(c, 401, 'TOKEN_EXPIRED')));
    await expect(client.get('/orders')).rejects.toBeInstanceOf(AppApiError);
    expect(onSessionExpired).not.toHaveBeenCalled();
    expect(tokens.current).toEqual({ accessToken: 'old-a', refreshToken: 'old-r' });
  });

  it('never tries to refresh for a failed login', async () => {
    const { client, calls } = setup((c) => fail(c, 401, 'INVALID_CREDENTIALS'));
    await expect(client.post('/auth/login', { identifier: 'x', password: 'y' })).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' });
    expect(calls).toEqual(['POST /auth/login']);
  });

  it('maps network errors to NETWORK and reports unreachable', async () => {
    const { client, onReachability } = setup((c) => new AxiosError('Network Error', 'ERR_NETWORK', c));
    const err = await client.get('/status').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AppApiError);
    expect((err as AppApiError).code).toBe('NETWORK');
    expect((err as AppApiError).isUnreachable).toBe(true);
    expect(onReachability).toHaveBeenCalledWith(false);
  });
});
