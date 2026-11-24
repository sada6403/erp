import { detect } from 'jschardet'

export type TextEncoding = 'utf-8' | 'utf-8-bom' | 'utf-16le' | 'utf-16be' | 'windows-1252' | 'iso-8859-1'
export interface TextWarning { code: string; message: string }

// WHATWG Windows-1252 mappings differ from ISO-8859-1 at bytes 0x80–0x9F.
const cp1252 = [0x20ac,0x81,0x201a,0x192,0x201e,0x2026,0x2020,0x2021,0x2c6,0x2030,0x160,0x2039,0x152,0x8d,0x17d,0x8f,0x90,0x2018,0x2019,0x201c,0x201d,0x2022,0x2013,0x2014,0x2dc,0x2122,0x161,0x203a,0x153,0x9d,0x17e,0x178]
const reverse = new Map(cp1252.map((code, index) => [code, index + 0x80]))
function byteOf(character: string): number | undefined {
  const code = character.codePointAt(0)!
  return reverse.get(code) ?? (code <= 0xff ? code : undefined)
}

export function hasMojibake(text: string): boolean {
  return /[\u00c3\u00c2]|\u00e0[\u00ae\u00af\u00b6]|\u00e2[\u0080-\u00bf\u20ac\u201a\u201e\u2026\u2122]/u.test(text)
}
function score(text: string): number {
  return (text.match(/[\u00c3\u00c2]|\u00e0[\u00ae\u00af\u00b6]|\u00e2[\u0080-\u00bf\u20ac\u201a\u201e\u2026\u2122]/gu) || []).length
}

/** Returns a review proposal, never writes data. Repair only valid UTF-8 byte
 * sequences represented as CP1252 characters; preserve already-correct scripts. */
export function proposeMojibakeRepair(original: string, maxPasses = 2) {
  if (!Number.isInteger(maxPasses) || maxPasses < 0 || maxPasses > 3) throw new Error('Repair pass limit must be 0–3')
  let text = original, passes = 0
  while (passes < maxPasses && hasMojibake(text)) {
    const characters = Array.from(text)
    let next = ''
    for (let i = 0; i < characters.length; i++) {
      const first = byteOf(characters[i])
      const width = first == null ? 0 : first >= 0xc2 && first <= 0xdf ? 2 : first >= 0xe0 && first <= 0xef ? 3 : first >= 0xf0 && first <= 0xf4 ? 4 : 0
      if (width && i + width <= characters.length) {
        const bytes = characters.slice(i, i + width).map(byteOf)
        if (bytes.every((byte, index) => byte != null && (index === 0 || (byte >= 0x80 && byte <= 0xbf)))) {
          try {
            const decoded = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(new Uint8Array(bytes as number[]))
            if (/[\u0000-\u001f\u007f-\u009f]/u.test(decoded)) throw new Error('Unsafe control character in repair candidate')
            next += decoded
            i += width - 1
            continue
          } catch { /* Not a valid UTF-8 sequence: keep the original characters. */ }
        }
      }
      next += characters[i]
    }
    if (next === text || score(next) >= score(text) || next.includes('\ufffd')) break
    text = next; passes++
  }
  const warnings: TextWarning[] = []
  if (original.includes('\ufffd')) warnings.push({ code: 'unrecoverable_text', message: 'Non-English text unrecoverable: replacement characters already exist' })
  if (original.includes('?')) warnings.push({ code: 'possible_text_loss', message: 'Question marks may indicate lost text; manual review required' })
  if (hasMojibake(text)) warnings.push({ code: 'remaining_mojibake', message: 'Possible mojibake remains; do not save it as a keyword' })
  return { original, text, changed: text !== original, passes, warnings }
}

function decode(bytes: Uint8Array, encoding: TextEncoding): string {
  if (encoding === 'iso-8859-1') return Array.from(bytes, byte => String.fromCharCode(byte)).join('')
  return new TextDecoder(encoding === 'utf-8-bom' ? 'utf-8' : encoding, { fatal: true, ignoreBOM: true }).decode(bytes)
}

/** CSV/TSV bytes only. XLSX cells are already decoded Unicode and must not be
 * passed through this function as if they were a text file. */
export function decodeDelimitedText(bytes: Uint8Array, options: { encoding?: TextEncoding; repairMojibake?: boolean; maxBytes?: number } = {}) {
  const supported: TextEncoding[] = ['utf-8','utf-8-bom','utf-16le','utf-16be','windows-1252','iso-8859-1']
  if (!(bytes instanceof Uint8Array)) throw new Error('Expected file bytes')
  if (options.encoding && !supported.includes(options.encoding)) throw new Error('Unsupported encoding override')
  const max = options.maxBytes ?? 10 * 1024 * 1024
  if (!Number.isSafeInteger(max) || max <= 0 || bytes.byteLength > max) throw new Error('Text file exceeds the configured size limit')
  if ((bytes[0] === 0xff && bytes[1] === 0xfe && bytes[2] === 0 && bytes[3] === 0) || (bytes[0] === 0 && bytes[1] === 0 && bytes[2] === 0xfe && bytes[3] === 0xff)) throw new Error('UTF-32 is not supported; convert or choose a supported source file')
  const bom: TextEncoding | undefined = bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf ? 'utf-8-bom' : bytes[0] === 0xff && bytes[1] === 0xfe ? 'utf-16le' : bytes[0] === 0xfe && bytes[1] === 0xff ? 'utf-16be' : undefined
  let encoding = options.encoding || bom
  let confidence = 1
  const warnings: TextWarning[] = []
  if (!encoding) {
    try { decode(bytes, 'utf-8'); encoding = 'utf-8' }
    catch {
      let binary = ''
      // Limit detector input, not the returned decoded file.
      for (const byte of bytes.subarray(0, 256 * 1024)) binary += String.fromCharCode(byte)
      const detected = detect(binary)
      confidence = detected.confidence
      const name = String(detected.encoding || '').toLowerCase().replace(/_/g, '-')
      encoding = name === 'windows-1252' ? 'windows-1252' : name === 'iso-8859-1' ? 'iso-8859-1' : name === 'utf-16le' ? 'utf-16le' : name === 'utf-16be' ? 'utf-16be' : undefined
      if (!encoding || confidence < 0.5) throw new Error('Encoding is uncertain or unsupported; choose an explicit encoding override')
      warnings.push({ code: 'encoding_inferred', message: `Encoding inferred as ${encoding}; verify the preview before importing` })
    }
  }
  const sameBom = bom && (bom === encoding || (bom === 'utf-8-bom' && encoding === 'utf-8'))
  if (bom && !sameBom) warnings.push({ code: 'bom_override_conflict', message: 'Encoding override differs from the BOM; verify the preview' })
  const content = sameBom ? bytes.subarray(bom === 'utf-8-bom' ? 3 : 2) : bytes
  let decoded: string
  try { decoded = decode(content, encoding) } catch { throw new Error(`File is not valid ${encoding}; choose the correct encoding or repair the source file`) }
  const proposal = options.repairMojibake === false ? { text: decoded, changed: false, warnings: proposeMojibakeRepair(decoded, 0).warnings } : proposeMojibakeRepair(decoded)
  warnings.push(...proposal.warnings)
  if (proposal.text.includes('\0')) warnings.push({ code: 'nul_characters', message: 'NUL characters found; check whether this is UTF-16 without a BOM or a non-text file' })
  if (/[\u0001-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/u.test(proposal.text)) warnings.push({ code: 'decoded_controls', message: 'Decoded control characters found; verify the encoding override and source file' })
  const label = `${encoding.toUpperCase()}${proposal.changed ? ' (mojibake repaired from Windows-1252 interpretation; review required)' : ''}`
  return { text: proposal.text, originalText: decoded, encoding, confidence, bom: Boolean(bom), repaired: proposal.changed, label, warnings }
}
