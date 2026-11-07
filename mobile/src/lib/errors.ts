import type { TFunction } from 'i18next';
import { toAppError } from '@/api/client';

/** Friendly, translated message for any thrown error. Falls back to the server message. */
export function errorMessage(e: unknown, t: TFunction): string {
  const err = toAppError(e);
  if (err.code === 'NETWORK' || err.code === 'TIMEOUT') return t('errors.NETWORK');
  const key = `errors.${err.code}`;
  const translated = t(key, { defaultValue: '' });
  return translated || err.message || t('errors.UNKNOWN');
}
