import { isValidMobile, isValidNic } from '@/features/agent/joinValidation';

describe('join request validation (mirrors the server)', () => {
  it('accepts old and new NIC formats only', () => {
    expect(isValidNic('901234567V')).toBe(true);
    expect(isValidNic('901234567x')).toBe(true);
    expect(isValidNic('199012345678')).toBe(true);
    expect(isValidNic('12345')).toBe(false);
    expect(isValidNic('90123456VV')).toBe(false);
    expect(isValidNic('')).toBe(false);
  });

  it('accepts Sri Lankan mobile numbers in common spellings', () => {
    for (const ok of ['0771234567', '771234567', '94771234567', '+94 77 123 4567', '077-123-4567']) expect(isValidMobile(ok)).toBe(true);
    for (const bad of ['0112345678', '12345', '07712345', '']) expect(isValidMobile(bad)).toBe(false);
  });
});
