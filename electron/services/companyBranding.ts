export const CLOUD_BRANDING_KEYS = [
  'company_name', 'company_address', 'company_phone', 'company_email',
  'company_website', 'company_tin', 'invoice_note',
  'company_logo_url', 'login_logo_url', 'pos_bill_logo_url',
  'invoice_logo_url', 'favicon_url', 'brand_color', 'footer_text',
] as const

export function hasCloudBrandingDifferences(
  settings: Record<string, unknown>,
  branding: Record<string, unknown>,
): boolean {
  return CLOUD_BRANDING_KEYS.some(key => {
    const value = branding[key]
    return value !== null && value !== undefined
      && String(settings[key] ?? '') !== String(value)
  })
}
