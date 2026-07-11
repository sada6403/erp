import { describe, it, expect, vi } from 'vitest'
import {
  titleCase,
  normalizeCategoryPath,
  sanitizeCode,
  categoryCodeFromName,
  brandCodeFromName,
  nextSkuSequence,
  buildSku,
} from './catalog'

describe('titleCase', () => {
  it('title-cases a single word', () => {
    expect(titleCase('hello')).toBe('Hello')
  })

  it('title-cases multiple words', () => {
    expect(titleCase('hello world foo')).toBe('Hello World Foo')
  })

  it('collapses internal whitespace', () => {
    expect(titleCase('hello   world')).toBe('Hello World')
  })

  it('trims surrounding whitespace', () => {
    expect(titleCase('  hello  ')).toBe('Hello')
  })

  it('handles null and undefined as empty string', () => {
    expect(titleCase(null)).toBe('')
    expect(titleCase(undefined)).toBe('')
  })

  it('preserves already-titled text', () => {
    expect(titleCase('Hello World')).toBe('Hello World')
  })
})

describe('normalizeCategoryPath', () => {
  it('joins segments with " > "', () => {
    expect(normalizeCategoryPath('electronics > laptops > gaming')).toBe(
      'Electronics > Laptops > Gaming'
    )
  })

  it('title-cases each segment', () => {
    expect(normalizeCategoryPath('home > kitchen')).toBe('Home > Kitchen')
  })

  it('drops empty segments from extra >', () => {
    expect(normalizeCategoryPath('a >> b')).toBe('A > B')
  })

  it('handles empty input', () => {
    expect(normalizeCategoryPath('')).toBe('')
  })
})

describe('sanitizeCode', () => {
  it('uppercases and removes non-alphanumerics', () => {
    expect(sanitizeCode('hello-world!')).toBe('HELLOWORLD')
  })

  it('returns the fallback for empty / stripped input', () => {
    expect(sanitizeCode('')).toBe('X')
    expect(sanitizeCode('!!!')).toBe('X')
    expect(sanitizeCode('', 'NA')).toBe('NA')
  })

  it('handles null and undefined', () => {
    expect(sanitizeCode(null)).toBe('X')
    expect(sanitizeCode(undefined, 'FALLBACK')).toBe('FALLBACK')
  })
})

describe('categoryCodeFromName', () => {
  it('uses first letter of the title-cased token, padded to 3 chars', () => {
    expect(categoryCodeFromName('Electronics')).toBe('EXX')
  })

  it('uses first letter of each token (max 3 tokens)', () => {
    expect(categoryCodeFromName('Electronics And Gadgets')).toBe('EAG')
  })

  it('pads with X when fewer than 3 tokens', () => {
    expect(categoryCodeFromName('Home')).toBe('HXX')
  })

  it('falls back to "CAT" for empty input', () => {
    expect(categoryCodeFromName('')).toBe('CAT')
    expect(categoryCodeFromName(null)).toBe('CAT')
  })
})

describe('brandCodeFromName', () => {
  it('uses first letter of the title-cased token, padded to 3 chars', () => {
    expect(brandCodeFromName('Samsung')).toBe('SXX')
  })

  it('uses first letter of each token (max 3 tokens)', () => {
    expect(brandCodeFromName('Samsung Electronics Corp')).toBe('SEC')
  })

  it('pads with X when fewer than 3 tokens', () => {
    expect(brandCodeFromName('LG')).toBe('LXX')
  })

  it('falls back to "GEN" for empty input', () => {
    expect(brandCodeFromName('')).toBe('GEN')
  })
})

/** Helper: build a fake db whose .prepare(...).all(...) returns the given rows. */
function fakeDbWithSkus(skus: string[]) {
  return {
    prepare: vi.fn(() => ({
      all: vi.fn(() => skus.map(sku => ({ sku }))),
    })),
  } as unknown as Parameters<typeof nextSkuSequence>[0]
}

describe('nextSkuSequence', () => {
  it('returns "001" when no existing SKUs match the prefix', () => {
    const db = fakeDbWithSkus([])
    expect(nextSkuSequence(db, 'SMX', 'EXX')).toBe('001')
  })

  it('returns max+1 zero-padded to 3 digits', () => {
    const db = fakeDbWithSkus(['SMX-EXX-005', 'SMX-EXX-010', 'SMX-EXX-003'])
    expect(nextSkuSequence(db, 'SMX', 'EXX')).toBe('011')
  })

  it('only matches rows with the brand+category prefix', () => {
    const db = fakeDbWithSkus(['XXX-YYY-099', 'SMX-EXX-007'])
    expect(nextSkuSequence(db, 'SMX', 'EXX')).toBe('100')
  })

  it('ignores rows whose suffix is not a 3+ digit number', () => {
    const db = fakeDbWithSkus(['SMX-EXX-abc', 'SMX-EXX-004'])
    expect(nextSkuSequence(db, 'SMX', 'EXX')).toBe('005')
  })
})

describe('buildSku', () => {
  it('returns existingSku unchanged when provided', () => {
    const db = fakeDbWithSkus([])
    expect(buildSku(db, 'Samsung', 'Electronics', 'CUSTOM-001')).toBe('CUSTOM-001')
  })

  it('builds a fresh SKU when no existingSku', () => {
    const db = fakeDbWithSkus([])
    expect(buildSku(db, 'Samsung', 'Electronics')).toBe('SXX-EXX-001')
  })

  it('increments the sequence when prior SKUs exist', () => {
    const db = fakeDbWithSkus(['SXX-EXX-007'])
    expect(buildSku(db, 'Samsung', 'Electronics')).toBe('SXX-EXX-008')
  })
})
