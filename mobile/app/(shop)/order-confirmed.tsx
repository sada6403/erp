import React from 'react';
import { useLocalSearchParams } from 'expo-router';
import { TrackingView } from '@/features/shop/TrackingView';

/** After placing an order the demo opens the delivery tracking view straight away; so does the app. */
export default function OrderConfirmedScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <TrackingView id={id} />;
}
