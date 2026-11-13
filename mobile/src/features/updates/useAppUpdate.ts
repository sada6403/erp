import { useCallback, useMemo, useState } from 'react';
import i18n from '@/i18n';
import { CAN_SELF_INSTALL, ENV } from '@/lib/env';
import { compareVersions } from '@/lib/format';
import { readJson, writeJson } from '@/lib/storage';
import { perf } from '@/lib/perf';
import { useServerStatus } from '@/features/common/hooks';
import { downloadVerifyInstall, type ApkStage } from './apkUpdate';
import { startPlayUpdate } from './playUpdate';
import { shouldShowAvailable, type Dismissed } from './remind';

const DISMISS_KEY = 'np-update-dismissed';

export type UpdateKind = 'none' | 'force' | 'available';

export function useAppUpdate() {
  const { data } = useServerStatus();
  const [dismissed, setDismissed] = useState<Dismissed | null>(() => readJson<Dismissed | null>(DISMISS_KEY, null));
  const [stage, setStage] = useState<ApkStage | null>(null);
  const [progress, setProgress] = useState(0);
  const [now] = useState(() => Date.now());
  const [error, setError] = useState<string | null>(null);

  const required = data ? (data.update_required ?? (data.min_app_version ? compareVersions(ENV.appVersion, data.min_app_version) < 0 : false)) : false;
  const available = data ? (data.update_available ?? (data.latest_version ? compareVersions(ENV.appVersion, data.latest_version) < 0 : false)) : false;
  const latest = data?.latest_version ?? '';
  const kind: UpdateKind = required ? 'force' : available && shouldShowAvailable(latest, dismissed, now) ? 'available' : 'none';
  const lang = (i18n.language || 'en').slice(0, 2) as 'en' | 'ta' | 'si';
  const notes = useMemo(() => data?.release_notes?.[lang] || data?.release_notes?.en || '', [data, lang]);

  const dismiss = useCallback(() => {
    perf(`update:dismiss ${String(new Error('dismiss').stack).split(String.fromCharCode(10)).slice(1, 4).join(' | ')}`);
    const d = { version: latest, at: Date.now() };
    writeJson(DISMISS_KEY, d);
    setDismissed(d);
  }, [latest]);

  const start = useCallback(async () => {
    perf('update:start');
    setError(null);
    try {
      if (CAN_SELF_INSTALL) {
        await downloadVerifyInstall(data?.update_url ?? data?.apk_url, data?.apk_sha256, (st, p) => {
          setStage(st);
          if (p != null) setProgress(p);
        });
      } else {
        await startPlayUpdate(required);
      }
    } catch (e) {
      perf(`update:error ${(e as Error).message}`);
      setError((e as Error).message || 'UPDATE_FAILED');
    } finally {
      setStage(null);
    }
  }, [data, required]);

  return { kind, latest, notes, stage, progress, error, start, dismiss };
}
