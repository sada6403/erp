export interface RegisterDeviceRequest {
  expo_push_token: string
  platform: 'android' | 'ios'
  app_version: string
  device_label?: string
}
export interface UnregisterDeviceRequest {
  expo_push_token: string
}
