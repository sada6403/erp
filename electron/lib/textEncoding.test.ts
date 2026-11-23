import { describe, it, expect } from 'vitest'
import { decodeDelimitedText, proposeMojibakeRepair, hasMojibake } from './textEncoding'

const tamil = '\u0b85\u0bb0\u0bbf\u0b9a\u0bbf'
const garble = (value: string) => new TextDecoder('windows-1252', { ignoreBOM: true }).decode(new TextEncoder().encode(value))

describe('Phase 1 text decoding and conservative repair proposals', () => {
  it('repairs one and two layers of CP1252-interpreted UTF-8', () => {
    expect(proposeMojibakeRepair(garble(tamil))).toMatchObject({ text: tamil, passes: 1, changed: true })
    expect(proposeMojibakeRepair(garble(garble(tamil)))).toMatchObject({ text: tamil, passes: 2 })
  })
  it('preserves already correct scripts, Latin accents and unrelated currency', () => {
    expect(proposeMojibakeRepair(`£ ${garble(tamil)} café`).text).toBe(`£ ${tamil} café`)
    expect(proposeMojibakeRepair(`Milk ${tamil} café`)).toMatchObject({ changed: false, text: `Milk ${tamil} café` })
  })
  it('never invents text lost to replacement characters or question marks', () => {
    const result = proposeMojibakeRepair('Milk (??\ufffd)')
    expect(result.changed).toBe(false)
    expect(result.warnings.map(w => w.code)).toEqual(expect.arrayContaining(['unrecoverable_text','possible_text_loss']))
  })
  it('does not introduce a decoded control character while repairing mojibake', () => {
    expect(proposeMojibakeRepair('Milk \u00c2\u0081').changed).toBe(false)
  })
  it('bounds repair passes and leaves unresolved text visible', () => {
    const result = proposeMojibakeRepair(garble(garble(tamil)), 1)
    expect(result.passes).toBe(1)
    expect(result.warnings.some(w => w.code === 'remaining_mojibake')).toBe(true)
    expect(() => proposeMojibakeRepair('name', 4)).toThrow()
    expect(hasMojibake('Caf\u00c3\u00a9')).toBe(true)
  })
  it('recognizes UTF-8 with and without BOM and reports byte-decoding separately from repair', () => {
    const bytes = new TextEncoder().encode(`Name\nMilk (${tamil})`)
    expect(decodeDelimitedText(bytes)).toMatchObject({ encoding: 'utf-8', repaired: false, text: `Name\nMilk (${tamil})` })
    expect(decodeDelimitedText(new Uint8Array([0xef,0xbb,0xbf,...bytes]))).toMatchObject({ encoding: 'utf-8-bom', bom: true, text: `Name\nMilk (${tamil})` })
    expect(decodeDelimitedText(new TextEncoder().encode(garble(tamil)))).toMatchObject({ encoding: 'utf-8', repaired: true, text: tamil })
  })
  it('handles UTF-16LE/BE and explicit no-BOM override', () => {
    const le = Buffer.from(`Name\n${tamil}`, 'utf16le')
    const be = Buffer.from(le).swap16()
    expect(decodeDelimitedText(new Uint8Array([0xff,0xfe,...le])).text).toBe(`Name\n${tamil}`)
    expect(decodeDelimitedText(new Uint8Array([0xfe,0xff,...be])).text).toBe(`Name\n${tamil}`)
    expect(decodeDelimitedText(le, { encoding: 'utf-16le' }).text).toBe(`Name\n${tamil}`)
  })
  it('detects common Western legacy text and distinguishes ISO-8859-1 from Windows-1252', () => {
    expect(decodeDelimitedText(Buffer.from('Product Name,Price\r\nCafé,10\r\n', 'latin1')).text).toContain('Café')
    expect(decodeDelimitedText(new Uint8Array([0x80]), { encoding: 'windows-1252' }).text).toBe('€')
    expect(decodeDelimitedText(new Uint8Array([0x80]), { encoding: 'iso-8859-1' }).text).toBe('\u0080')
  })
  it('rejects invalid selected encodings, unsupported UTF-32 and oversized input', () => {
    expect(() => decodeDelimitedText(new Uint8Array([0xff]), { encoding: 'utf-8' })).toThrow(/not valid/)
    expect(() => decodeDelimitedText(new Uint8Array([0xff,0xfe,0,0]))).toThrow(/UTF-32/)
    expect(() => decodeDelimitedText(new Uint8Array(4), { maxBytes: 3 })).toThrow(/size/)
  })
})
