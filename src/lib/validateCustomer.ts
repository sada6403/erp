export interface CustomerInput {
  name?: string
  phone?: string
  email?: string
  nic?: string
  address?: string
}

// Validates a customer registration. Returns an error message, or null if valid.
// Rules: name required, mobile required + valid, email valid (if given),
// NIC valid Sri-Lankan format (if given), address required.
export function validateCustomer(c: CustomerInput): string | null {
  if (!c.name?.trim()) return 'Customer name is required'

  const phone = (c.phone || '').replace(/[\s-]/g, '')
  if (!phone) return 'Mobile number is required'
  if (!/^\+?\d{9,12}$/.test(phone)) return 'Enter a valid mobile number (9–12 digits)'

  if (c.email?.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(c.email.trim()))
    return 'Enter a valid email address'

  if (c.nic?.trim() && !/^(\d{9}[vVxX]|\d{12})$/.test(c.nic.trim()))
    return 'Enter a valid NIC (9 digits + V/X, or 12 digits)'

  if (!c.address?.trim()) return 'Address is required'

  return null
}
