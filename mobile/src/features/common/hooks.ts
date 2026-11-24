import { useCallback, useEffect, useRef } from 'react';
import { useIsFocused } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { statusApi } from '@/api/endpoints';
import { qk } from '@/query/keys';
import { selectIsOffline, useUiStore } from '@/store/uiStore';
import { compareVersions } from '@/lib/format';
import { ENV } from '@/lib/env';

/** GET /status, cached in MMKV, refreshed on app foreground (focusManager). */
export function useServerStatus() {
  return useQuery({
    queryKey: qk.status,
    queryFn: statusApi.status,
    staleTime: 60_000,
    refetchOnWindowFocus: true,
  });
}

/** Company profile from POS Settings (name, contacts, legal links). Cached offline; refreshed when /watermark says it changed. */
export function useCompany() {
  const q = useQuery({ queryKey: qk.company, queryFn: statusApi.company, staleTime: 10 * 60_000 });
  return q.data ?? null;
}

/** Company modules; defaults to enabled until /status says otherwise. */
export function useModules() {
  const { data } = useServerStatus();
  return { smartbuy: data?.modules.smartbuy ?? true, installments: data?.modules.installments ?? true };
}

/** True when the installed version is below /status.min_app_version. */
export function useForceUpdate(): { required: boolean; latest?: string; apkUrl?: string | null } {
  const { data } = useServerStatus();
  if (!data?.min_app_version) return { required: false };
  return {
    required: compareVersions(ENV.appVersion, data.min_app_version) < 0,
    latest: data.latest_version,
    apkUrl: data.apk_url,
  };
}

/**
 * Wraps server-only actions (place order, quote, wallet pay, join request, password change).
 * Offline or ordering disabled -> opens the buy-later sheet and does not run the action.
 */
export function useServerActionGuard() {
  const offline = useUiStore(selectIsOffline);
  const openBuyLater = useUiStore((s) => s.openBuyLater);
  const { data } = useServerStatus();
  const blocked = offline || data?.ordering_enabled === false;
  return useCallback(
    (action: () => void): boolean => {
      if (blocked) {
        openBuyLater();
        return false;
      }
      action();
      return true;
    },
    [blocked, openBuyLater],
  );
}

/**
 * Polls /watermark every 10 s while the screen is focused and invalidates only the changed areas.
 * Pass the map of area -> query keys to invalidate.
 */
export function useWatermark(areas: Partial<Record<'catalog' | 'categories' | 'banners' | 'company' | 'orders' | 'notifications' | 'deliveries', readonly (readonly unknown[])[]>>) {
  const focused = useIsFocused();
  const offline = useUiStore(selectIsOffline);
  const qc = useQueryClient();
  const last = useRef<Record<string, string | null>>({});
  const areasRef = useRef(areas);
  useEffect(() => {
    areasRef.current = areas;
  });

  useEffect(() => {
    if (!focused || offline) return;
    let stop = false;
    const tick = async () => {
      try {
        const wm = await statusApi.watermark();
        if (stop) return;
        for (const [area, keys] of Object.entries(areasRef.current)) {
          const value = (wm.areas as Record<string, string | null | undefined>)[area] ?? null;
          if (area in last.current && last.current[area] !== value) {
            for (const key of keys ?? []) qc.invalidateQueries({ queryKey: key as unknown[] });
          }
          last.current[area] = value;
        }
      } catch {
        /* polling is best effort */
      }
    };
    tick();
    const id = setInterval(tick, 10_000);
    return () => {
      stop = true;
      clearInterval(id);
    };
  }, [focused, offline, qc]);
}
