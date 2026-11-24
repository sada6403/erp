import { useCallback, useState } from 'react';
import { create } from 'zustand';
import { useQueryClient } from '@tanstack/react-query';
import i18n from '@/i18n';
import { ENV } from '@/lib/env';
import { compareVersions } from '@/lib/format';
import { qk } from '@/query/keys';
import { statusApi } from '@/api/endpoints';
import { useUiStore } from '@/store/uiStore';

/** "Check for updates" in Settings sets `forced` so the update sheet shows even if "Later" was tapped within the last 3 days. */
export const useUpdateCheck = create<{ forced: boolean; setForced: (v: boolean) => void }>((set) => ({ forced: false, setForced: (forced) => set({ forced }) }));

/** Manual check: fetches /status now, then shows the update sheet or an "up to date" toast. Ignores the snooze. */
export function useCheckForUpdates() {
  const qc = useQueryClient();
  const [checking, setChecking] = useState(false);
  const check = useCallback(async () => {
    setChecking(true);
    try {
      const data = await qc.fetchQuery({ queryKey: qk.status, queryFn: statusApi.status, staleTime: 0 });
      const available = data.update_available ?? (data.latest_version ? compareVersions(ENV.appVersion, data.latest_version) < 0 : false);
      if (available) useUpdateCheck.getState().setForced(true);
      else useUiStore.getState().showToast(i18n.t('update.upToDate'));
    } catch {
      useUiStore.getState().showToast(i18n.t('update.checkFailed'));
    } finally {
      setChecking(false);
    }
  }, [qc]);
  return { check, checking };
}
