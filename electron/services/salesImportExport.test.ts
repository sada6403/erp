import { describe, it, expect } from 'vitest'
import { extractHeaderInfo, editDistance } from './salesImportExport'

describe('salesImportExport helper functions', () => {
  describe('extractHeaderInfo', () => {
    it('extracts price and clean name from header with RS suffix', () => {
      const res = extractHeaderInfo('BISCUTE 30 RS')
      expect(res.cleanName).toBe('BISCUTE')
      expect(res.extractedPrice).toBe(30)
    })

    it('extracts price from trailing number', () => {
      const res = extractHeaderInfo('BISCUT 250')
      expect(res.cleanName).toBe('BISCUT')
      expect(res.extractedPrice).toBe(250)
    })

    it('handles headers without price numbers', () => {
      expect(extractHeaderInfo('CHEES')).toEqual({ cleanName: 'CHEES' })
      expect(extractHeaderInfo('CHOCOLATE MARIE')).toEqual({ cleanName: 'CHOCOLATE MARIE' })
      expect(extractHeaderInfo('SUNSLIK BIG')).toEqual({ cleanName: 'SUNSLIK BIG' })
      expect(extractHeaderInfo('LEMON')).toEqual({ cleanName: 'LEMON' })
    })

    it('handles RS prefix price', () => {
      const res = extractHeaderInfo('RS. 50 MILK')
      expect(res.cleanName).toBe('MILK')
      expect(res.extractedPrice).toBe(50)
    })
  })

  describe('editDistance', () => {
    it('calculates Levenshtein distance correctly for common supermarket typos', () => {
      expect(editDistance('chees', 'cheese')).toBe(1)
      expect(editDistance('biscute', 'biscuit')).toBe(2)
      expect(editDistance('sunslik', 'sunsilk')).toBe(2)
      expect(editDistance('same', 'same')).toBe(0)
    })
  })
})
