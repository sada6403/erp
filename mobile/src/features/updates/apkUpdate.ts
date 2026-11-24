import * as FS from 'expo-file-system/legacy';
import { File } from 'expo-file-system';
import * as Crypto from 'expo-crypto';
import * as IntentLauncher from 'expo-intent-launcher';
import { assertInstallable, sha256Matches, toHex } from './apkVerify';

export type ApkStage = 'downloading' | 'verifying' | 'installing';

/**
 * Test/staging flavour ONLY (the Play build never has REQUEST_INSTALL_PACKAGES): download the APK over https,
 * check its SHA-256 against /status, then hand it to the Android package installer. Data is kept because the
 * APK has the same package name and signing key.
 */
export async function downloadVerifyInstall(
  rawUrl: string | null | undefined,
  rawSha256: string | null | undefined,
  onStage: (stage: ApkStage, progress?: number) => void,
): Promise<void> {
  const { url, sha256 } = assertInstallable(rawUrl, rawSha256);
  const target = `${FS.cacheDirectory}np-update.apk`;
  await FS.deleteAsync(target, { idempotent: true });
  onStage('downloading', 0);
  const job = FS.createDownloadResumable(url, target, {}, (p) => {
    if (p.totalBytesExpectedToWrite > 0) onStage('downloading', p.totalBytesWritten / p.totalBytesExpectedToWrite);
  });
  const res = await job.downloadAsync();
  if (!res || res.status !== 200) {
    await FS.deleteAsync(target, { idempotent: true });
    throw new Error('UPDATE_DOWNLOAD_FAILED');
  }
  onStage('verifying');
  const bytes = await new File(target).bytes();
  const actual = toHex(await Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA256, bytes));
  if (!sha256Matches(actual, sha256)) {
    await FS.deleteAsync(target, { idempotent: true });
    throw new Error('UPDATE_CHECKSUM_MISMATCH');
  }
  onStage('installing');
  const contentUri = await FS.getContentUriAsync(target);
  await IntentLauncher.startActivityAsync('android.intent.action.VIEW', {
    data: contentUri,
    type: 'application/vnd.android.package-archive',
    flags: 1, // FLAG_GRANT_READ_URI_PERMISSION
  });
}
