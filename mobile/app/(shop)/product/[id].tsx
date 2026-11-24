import React from 'react';
import { useLocalSearchParams } from 'expo-router';
import { ProductPage } from '@/features/shop/ProductPage';

/** Product detail page (also the target of the naturalplantation://product/<id> deep link). */
export default function ProductScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <ProductPage id={String(id)} />;
}
