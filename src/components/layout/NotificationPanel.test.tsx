import { describe, expect, it } from 'vitest'
import { routeFor } from './NotificationPanel'

const stockNotification = {
  id: 'stock-alert',
  type: 'low_stock',
  title: 'Low Stock Alert',
  message: 'One product is low',
  is_read: 0,
  data: null,
  created_at: '2026-09-28 12:00:00',
}

describe('notification navigation permissions', () => {
  it('does not navigate a Smart Buy Manager into inventory pages', () => {
    expect(routeFor(stockNotification, { chits: true })).toBeNull()
    expect(routeFor({ ...stockNotification, type: 'transfer_request' }, { chits: true })).toBeNull()
  })

  it('checks the destination permission for installment and Smart Buy alerts', () => {
    expect(routeFor({ ...stockNotification, type: 'installment_due' }, { chits: true })).toBeNull()
    expect(routeFor({ ...stockNotification, type: 'installment_due' }, { customers: true })).toBe('/admin/installments')
    expect(routeFor({ ...stockNotification, type: 'chit_payment_due' }, { customers: true })).toBeNull()
    expect(routeFor({ ...stockNotification, type: 'chit_payment_due' }, { chits: true })).toBe('/admin/smart-buy-reports')
  })

  it('keeps inventory and Company Admin notification navigation working', () => {
    expect(routeFor(stockNotification, { inventory: true })).toBe('/admin/stock-intelligence')
    expect(routeFor({ ...stockNotification, type: 'transfer_request' }, { all: true })).toBe('/admin/stock-requests')
  })
})
