import { describe, expect, it } from 'vitest'
import { colomboToday, installColomboDefault, parseUtc } from './datetime'

describe('POS timezone (Asia/Colombo)', () => {
  it('reads bare SQLite timestamps as UTC', () => {
    expect(parseUtc('2026-11-07 20:00:00').toISOString()).toBe('2026-11-07T20:00:00.000Z')
    expect(parseUtc('2026-11-07T20:00:00Z').toISOString()).toBe('2026-11-07T20:00:00.000Z')
  })

  it('shows UTC instants as Colombo time regardless of the PC timezone', () => {
    installColomboDefault()
    const d = parseUtc('2026-11-07 20:00:00')
    expect(d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })).toBe('01:30')
    expect(d.toLocaleDateString('en-GB')).toBe('08/11/2026')
    // an explicit timeZone from a caller still wins
    expect(d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' })).toBe('20:00')
  })

  it('business date is the Colombo calendar day', () => {
    expect(colomboToday(Date.parse('2026-11-07T20:00:00Z'))).toBe('2026-11-08')
    expect(colomboToday(Date.parse('2026-11-07T18:29:00Z'))).toBe('2026-11-07')
  })
})
