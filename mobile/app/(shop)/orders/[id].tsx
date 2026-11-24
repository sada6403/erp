import React from 'react';
import { Redirect, useLocalSearchParams } from 'expo-router';
import { TrackingView } from '@/features/shop/TrackingView';
import { selectIsLoggedIn, useSessionStore } from '@/store/sessionStore';

/** Order tracking: the demo's "My Orders" view (timeline, delivery OTP, agent card). */
export default function OrderDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const loggedIn = useSessionStore(selectIsLoggedIn);
  // After logout this screen can still be mounted: never keep showing the previous user's order or delivery OTP.
  if (!loggedIn) return <Redirect href="/login" />;
  return <TrackingView id={id} />;
}
