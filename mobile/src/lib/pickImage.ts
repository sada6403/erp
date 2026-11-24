import { Alert } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import type { TFunction } from 'i18next';

export interface PickedImage {
  uri: string;
  name: string;
  type: string;
}

const MAX_BYTES = 6 * 1024 * 1024;

function toPicked(a: ImagePicker.ImagePickerAsset, fallback: string): PickedImage | null {
  if (a.fileSize && a.fileSize > MAX_BYTES) return null;
  const type = a.mimeType && /^image\/(jpeg|png|webp)$/.test(a.mimeType) ? a.mimeType : 'image/jpeg';
  const ext = type === 'image/png' ? 'png' : type === 'image/webp' ? 'webp' : 'jpg';
  return { uri: a.uri, name: `${fallback}.${ext}`, type };
}

/** Camera or gallery, chosen by the user. Resolves null when cancelled, denied or too large. Never throws. */
export async function pickImage(t: TFunction, fallbackName: string, onDenied?: () => void): Promise<PickedImage | null> {
  const source = await new Promise<'camera' | 'gallery' | null>((resolve) => {
    Alert.alert(
      '',
      '',
      [
        { text: t('slip.camera'), onPress: () => resolve('camera') },
        { text: t('slip.gallery'), onPress: () => resolve('gallery') },
        { text: t('common.cancel'), style: 'cancel', onPress: () => resolve(null) },
      ],
      { cancelable: true, onDismiss: () => resolve(null) },
    );
  });
  if (!source) return null;
  try {
    if (source === 'camera') {
      const perm = await ImagePicker.requestCameraPermissionsAsync();
      if (!perm.granted) {
        onDenied?.();
        return null;
      }
    }
    const res =
      source === 'camera'
        ? await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.7, exif: false })
        : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.7, exif: false });
    if (res.canceled || !res.assets?.[0]) return null;
    return toPicked(res.assets[0], fallbackName);
  } catch {
    onDenied?.();
    return null;
  }
}

/** React Native FormData file part. */
export function filePart(img: PickedImage): Blob {
  return { uri: img.uri, name: img.name, type: img.type } as unknown as Blob;
}
