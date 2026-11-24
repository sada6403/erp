import type { AddressDto } from './contracts/addresses'

export function addressToDto(a: Record<string, unknown>): AddressDto {
  return {
    id: String(a.id), label: String(a.label), recipient_name: String(a.recipient_name), phone: String(a.phone),
    line1: String(a.line1), line2: a.line2 ? String(a.line2) : null, city: String(a.city),
    district: a.district ? String(a.district) : null, postal_code: a.postal_code ? String(a.postal_code) : null,
    latitude: a.latitude != null ? Number(a.latitude) : null, longitude: a.longitude != null ? Number(a.longitude) : null,
    is_default: Number(a.is_default) === 1,
  }
}
