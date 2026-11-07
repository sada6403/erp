export interface AddressDto {
  id: string
  label: string
  recipient_name: string
  phone: string
  line1: string
  line2: string | null
  city: string
  district: string | null
  postal_code: string | null
  latitude: number | null
  longitude: number | null
  is_default: boolean
}
export type AddressInput = Omit<AddressDto, 'id'>
export interface AddressesResponse {
  items: AddressDto[]
}
