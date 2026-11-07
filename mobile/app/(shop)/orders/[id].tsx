import React from 'react';
import { useLocalSearchParams } from 'expo-router';
import { TrackingView } from '@/features/shop/TrackingView';

/** Order tracking: the demo's "My Orders" view (timeline, delivery OTP, agent card). */
export default function OrderDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <TrackingView id={id} />;
}
