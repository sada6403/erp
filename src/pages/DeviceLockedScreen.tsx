import ActivationPage from './ActivationPage'

// Phase 1 device-authorization work. Rendered by App.tsx as a full
// top-level replacement of the entire render tree the moment a device is
// found to be locked (revoked/deactivated, or its offline authorization
// lease expired) — nothing else mounts while this is shown, matching
// DataClearedLockScreen's "no other UI reachable" guarantee. There is
// deliberately no email/password/login option anywhere on this screen —
// the only way out is a valid activation key, verified server-side by the
// exact same activation flow a brand-new install uses (ActivationPage),
// not a second, simplified reactivation form.
export default function DeviceLockedScreen({ reason, deviceId, onReactivated }: {
  reason: string | null
  deviceId: string | null
  onReactivated: () => void
}) {
  const banner = [
    reason || 'This device is not currently active.',
    deviceId ? `Device ID: ${deviceId}` : null,
  ].filter(Boolean).join('  •  ')

  return <ActivationPage onActivated={onReactivated} bannerMessage={banner} />
}
