export type NotificationChannel = 'orders' | 'deliveries' | 'smartbuy' | 'account' | 'offers'
export type NotificationType =
  | 'order_status' | 'delivery_assigned' | 'delivery_completed' | 'draw_result'
  | 'wallet' | 'payment_due' | 'account' | 'offer' | 'system'

export interface NotificationDto {
  id: string
  type: NotificationType
  channel: NotificationChannel
  title: string
  body: string
  /** Deep link, e.g. lankahome://orders/<id> */
  url: string | null
  read: boolean
  created_at: string
}
export interface NotificationsResponse {
  items: NotificationDto[]
  unread_count: number
  next_cursor: string | null
}
export interface MarkReadRequest {
  ids?: string[]
  all?: boolean
}
export interface NotificationSettingsDto {
  orders: boolean
  deliveries: boolean
  smartbuy: boolean
  account: boolean
  offers: boolean
  /** Quiet hours apply to offers only; "HH:MM" 24h, null = off */
  quiet_hours_start: string | null
  quiet_hours_end: string | null
}
