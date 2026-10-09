import { describe, expect, it } from 'vitest'
import { CLOUD_BRANDING_KEYS, hasCloudBrandingDifferences } from './companyBranding'

describe('company branding cloud fields', () => {
  it('includes company contact and invoice identity fields', () => {
    expect(CLOUD_BRANDING_KEYS).toEqual(expect.arrayContaining([
      'company_name',
      'company_address',
      'company_phone',
      'company_email',
      'company_website',
      'company_tin',
      'invoice_note',
    ]))
  })

  it('repairs a missing local contact even when a previous sync marker exists', () => {
    const cloud = {
      company_name: 'N plantation',
      company_phone: '+94 77 123 4567',
      company_email: 'info@example.lk',
    }

    expect(hasCloudBrandingDifferences({ company_name: 'N plantation' }, cloud)).toBe(true)
    expect(hasCloudBrandingDifferences(cloud, cloud)).toBe(false)
  })
})
