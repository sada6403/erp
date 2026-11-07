import { describe, it, expect } from 'vitest'
import { isSafeWhatsAppUrl, matchAppUser, normalizePhone, PendingChatStore, PENDING_TTL_MS, type AppUserRow } from './appAccessUtil'

describe('normalizePhone', () => {
  it('normalises Sri Lankan mobiles', () => {
    expect(normalizePhone('0771234567')).toBe('0771234567')
    expect(normalizePhone('+94 77 123 4567')).toBe('0771234567')
    expect(normalizePhone('771234567')).toBe('0771234567')
    expect(normalizePhone('0094771234567')).toBe('0771234567')
  })
  it('rejects landlines and junk', () => {
    expect(normalizePhone('0112345678')).toBeNull()
    expect(normalizePhone('')).toBeNull()
    expect(normalizePhone(null)).toBeNull()
  })
})

describe('isSafeWhatsAppUrl', () => {
  it('accepts https wa.me click-to-chat links', () => {
    expect(isSafeWhatsAppUrl('https://wa.me/94771234567?text=Hello%20there')).toBe(true)
  })
  it('rejects everything else', () => {
    for (const u of ['http://wa.me/94771234567', 'https://wa.me.evil.com/94771234567', 'https://evil.com/wa.me/94771234567',
      'https://user@wa.me/94771234567', 'file:///C:/Windows/System32/calc.exe', 'javascript:alert(1)', 'https://wa.me/abc', '', 'not a url'])
      expect(isSafeWhatsAppUrl(u)).toBe(false)
  })
})

describe('matchAppUser', () => {
  const users: AppUserRow[] = [
    { user_id: 'u1', name: 'A', phone: '0771234567', agent_code: null, status: 'active' },
    { user_id: 'u2', name: 'B', phone: '0712223333', agent_code: 'AG-01', status: 'active' },
  ]
  it('matches agents by code (case-insensitive)', () => {
    expect(matchAppUser(users, { kind: 'agent', code: 'ag-01' })?.user_id).toBe('u2')
  })
  it('matches customers by normalised phone', () => {
    expect(matchAppUser(users, { kind: 'smartbuy', phone: '+94771234567' })?.user_id).toBe('u1')
    expect(matchAppUser(users, { kind: 'customer', phone: 'abc' })).toBeNull()
  })
})

describe('PendingChatStore', () => {
  it('is one-shot and expires', () => {
    let t = 0
    const s = new PendingChatStore(() => t)
    s.put('a', 'https://wa.me/94771234567?text=x')
    expect(s.take('a')).toContain('wa.me')
    expect(s.take('a')).toBeNull()
    s.put('b', 'https://wa.me/94771234567?text=y')
    t += PENDING_TTL_MS + 1
    expect(s.take('b')).toBeNull()
  })
})
