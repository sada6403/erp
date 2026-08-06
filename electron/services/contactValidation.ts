// Shared phone/email/NIC format validation for Smart Buy (Chit Scheme)
// member intake — used identically by both the single-member-add flow and
// the bulk Excel import flow (electron/ipc/chits.ts) so the two entry
// points can never silently drift apart again. Values are only checked
// when present; callers decide their own required-ness (bulk import
// requires phone, single add does not).
export const PHONE_RE = /^\+?\d{9,12}$/
export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
export const NIC_RE = /^(\d{9}[vVxX]|\d{12})$/

export interface ContactFields {
  phone?: unknown
  email?: unknown
  nic?: unknown
}

// Returns a human-readable error for the first invalid field, or null if
// every provided field is well-formed (a blank/omitted field is not an
// error here — required-ness is the caller's own concern).
export function validateContactFields(input: ContactFields): string | null {
  const phone = input.phone !== undefined && input.phone !== null ? String(input.phone).trim() : ''
  const email = input.email !== undefined && input.email !== null ? String(input.email).trim() : ''
  const nic = input.nic !== undefined && input.nic !== null ? String(input.nic).trim() : ''
  if (phone && !PHONE_RE.test(phone)) return `Invalid phone number "${phone}"`
  if (email && !EMAIL_RE.test(email)) return `Invalid email address "${email}"`
  if (nic && !NIC_RE.test(nic)) return `Invalid NIC "${nic}"`
  return null
}
