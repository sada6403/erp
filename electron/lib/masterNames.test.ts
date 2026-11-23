import { describe, it, expect } from 'vitest'
import { splitMasterName, validateMasterName } from './masterNames'

const tamil = '\u0b85\u0bb0\u0bbf\u0b9a\u0bbf'
const sinhala = '\u0dc3\u0dc4\u0dbd\u0dca'
describe('English/Latin master-name policy', () => {
  it.each(['Rice', 'Baby Soap (Pink)', 'Milk Powder (400g)', 'Café', 'Cafe\u0301', 'Rice / Flour', 'Oil - 1L'])('accepts legitimate master text: %s', name => {
    expect(validateMasterName(name).valid).toBe(true)
  })
  it.each([tamil, sinhala, 'Milk\u200b', 'Rice\uFFFD', 'Caf\u00c3\u00a9', 'Milk\nPowder', 'Рice', 'Rice 🍚', ''])('rejects unsafe master text: %s', name => {
    expect(validateMasterName(name).valid).toBe(false)
  })
  it('has an explicit non-Latin opt-in without allowing mojibake or controls', () => {
    expect(validateMasterName(tamil, { allowNonLatinProductName: true }).valid).toBe(true)
    expect(validateMasterName(`${tamil}\uFFFD`, { allowNonLatinProductName: true }).valid).toBe(false)
    expect(validateMasterName('abcd', { maxLength: 3 }).valid).toBe(false)
    expect(validateMasterName('NALLAENAI').valid).toBe(true) // Latin validation is not translation.
  })
})
describe('review-only name/keyword splitting', () => {
  it('extracts Tamil/Sinhala while retaining Latin size/variant parentheses', () => {
    const result = splitMasterName(`Anchor Milk Powder (${tamil}) (400g)`)
    expect(result.masterName).toBe('Anchor Milk Powder (400g)')
    expect(result.keywords).toEqual([{ keyword: tamil, script: 'tamil', reason: 'native_name' }])
    expect(splitMasterName(`Rice (${sinhala})`).keywords[0].script).toBe('sinhala')
    expect(splitMasterName('Baby Soap (Pink)').masterName).toBe('Baby Soap (Pink)')
  })
  it('preserves the slash name by default and only extracts Latin aliases explicitly', () => {
    expect(splitMasterName(`Coriander / Malli (${tamil})`).masterName).toBe('Coriander / Malli')
    const result = splitMasterName(`Coriander / Malli (${tamil})`, { slashMode: 'first-part' })
    expect(result.masterName).toBe('Coriander')
    expect(result.keywords.map(k => k.keyword)).toEqual(expect.arrayContaining(['Malli', tamil]))
    expect(splitMasterName('Soap (Pink/White)', { slashMode: 'first-part' }).masterName).toBe('Soap (Pink/White)')
  })
  it('supports explicit delimiters, deduplicates aliases and preserves mixed-parenthesis Latin content', () => {
    const result = splitMasterName(`Milk (${tamil} 400g) | Paal | paal`, { slashMode: 'first-part', delimiters: ['|'] })
    expect(result.masterName).toBe('Milk (400g)')
    expect(result.keywords.filter(k => k.keyword.toLowerCase() === 'paal')).toHaveLength(1)
  })
  it('omits unrecoverable parenthetical garbage instead of proposing garbage keywords', () => {
    const result = splitMasterName('Anchor Milk Powder (??\ufffd)')
    expect(result.masterName).toBe('Anchor Milk Powder')
    expect(result.keywords).toEqual([])
    expect(result.warnings.some(w => w.code === 'unrecoverable_native_omitted')).toBe(true)
  })
  it('does not invent an English name for a native-only master', () => {
    const result = splitMasterName(tamil)
    expect(result.masterName).toBe('')
    expect(result.validation.valid).toBe(false)
    expect(result.keywords[0].keyword).toBe(tamil)
  })
  it('offers repairs for database/delimited proposals but never auto-repairs XLSX cells', () => {
    const garbled = new TextDecoder('windows-1252', { ignoreBOM: true }).decode(new TextEncoder().encode(tamil))
    expect(splitMasterName(`Rice (${garbled})`, { format: 'database', repairMojibake: true }).masterName).toBe('Rice')
    const xlsx = splitMasterName(`Rice (${garbled})`, { format: 'xlsx', repairMojibake: true })
    expect(xlsx.repaired).toBe(false)
    expect(xlsx.validation.valid).toBe(false)
    expect(xlsx.keywords).toEqual([])
  })
})
