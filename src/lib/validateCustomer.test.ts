import { describe, it, expect } from 'vitest'
import { validateCustomer, type CustomerInput } from './validateCustomer'

const valid: CustomerInput = {
  name: 'Kumar',
  phone: '+94771234567',
  email: 'kumar@example.com',
  nic: '200012345678',
  address: '12 Main St, Colombo',
}

describe('validateCustomer', () => {
  it('accepts a fully populated valid customer', () => {
    expect(validateCustomer(valid)).toBeNull()
  })

  it('rejects missing name', () => {
    expect(validateCustomer({ ...valid, name: '  ' })).toBe('Customer name is required')
  })

  it('rejects missing phone', () => {
    expect(validateCustomer({ ...valid, phone: '' })).toBe('Mobile number is required')
  })

  it('rejects phone with wrong digit count', () => {
    expect(validateCustomer({ ...valid, phone: '12345' })).toMatch(/valid mobile/)
  })

  it('strips spaces and dashes in phone', () => {
    expect(validateCustomer({ ...valid, phone: '077 123-4567' })).toBeNull()
  })

  it('rejects malformed email when provided', () => {
    expect(validateCustomer({ ...valid, email: 'not-an-email' })).toBe('Enter a valid email address')
  })

  it('accepts valid old-format NIC (9 digits + V)', () => {
    expect(validateCustomer({ ...valid, nic: '901234567V' })).toBeNull()
  })

  it('rejects malformed NIC', () => {
    expect(validateCustomer({ ...valid, nic: 'ABC123' })).toMatch(/valid NIC/)
  })

  it('rejects missing address', () => {
    expect(validateCustomer({ ...valid, address: '' })).toBe('Address is required')
  })
})
