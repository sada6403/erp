import { useEffect } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useUiStore } from '@/store/uiStore';

/** Deep link /product/:id: the product detail is a bottom sheet (as in the demo), so open it over the shop home. */
export default function ProductDeepLink() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const openProduct = useUiStore((s) => s.openProduct);
  useEffect(() => {
    router.replace('/');
    if (id) openProduct(id);
  }, [id, router, openProduct]);
  return null;
}
