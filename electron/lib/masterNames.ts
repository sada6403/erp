import { hasMojibake, proposeMojibakeRepair, type TextWarning } from './textEncoding'

export interface NameIssue { code: string; message: string }
const native = /[\u0b80-\u0bff\u0d80-\u0dff]/u
const controls = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]/u

/** Character policy only: Latin script is not proof of English meaning/spelling.
 * Callers opt in explicitly; this module changes no existing product handler. */
export function validateMasterName(value: unknown, options: { allowNonLatinProductName?: boolean; maxLength?: number } = {}) {
  const issues: NameIssue[] = []
  if (typeof value !== 'string' || !value.trim()) return { valid: false, issues: [{ code: 'required', message: 'An English master product name is required' }] }
  const max = options.maxLength ?? 255
  if (!Number.isSafeInteger(max) || max < 1) throw new Error('Invalid name length limit')
  if (Array.from(value).length > max) issues.push({ code: 'too_long', message: `Master name must contain at most ${max} characters` })
  if (controls.test(value)) issues.push({ code: 'control_characters', message: 'Master name contains control or invisible formatting characters' })
  if (value.includes('\ufffd') || /^[\s?\ufffd]+$/u.test(value)) issues.push({ code: 'unrecoverable_text', message: 'Master name contains unrecoverable text; enter the English name manually' })
  if (hasMojibake(value)) issues.push({ code: 'mojibake', message: 'Master name may contain mojibake; review the source encoding' })
  if (!options.allowNonLatinProductName) {
    let latinBase = false, invalid = false
    for (const ch of value) {
      if (/\p{L}/u.test(ch)) { latinBase = /\p{Script=Latin}/u.test(ch); if (!latinBase) invalid = true }
      else if (/\p{M}/u.test(ch)) { if (!latinBase) invalid = true }
      else {
        latinBase = false
        if (!/[\x20-\x7e\u00a0\u00a3\u00a5\u00a2\u00b0\u00ae\u00a9\u00d7\u00f7\u20ac\u20b9\u2122\u2010-\u2015\u2018-\u201f\u2026]/u.test(ch)) invalid = true
      }
    }
    if (invalid || native.test(value)) issues.push({ code: 'non_latin', message: 'Use Latin text for the master name; keep Tamil/Sinhala in search keywords' })
  }
  return { valid: issues.length === 0, issues }
}

export type KeywordScript = 'latin' | 'tamil' | 'sinhala' | 'numeric' | 'mixed'
export interface KeywordProposal { keyword: string; script: KeywordScript; reason: 'native_name' | 'explicit_delimiter' }
export interface NameSplitOptions {
  format?: 'manual' | 'delimited' | 'xlsx' | 'database'
  repairMojibake?: boolean
  slashMode?: 'keep' | 'first-part'
  delimiters?: string[]
}
function scriptOf(value: string): KeywordScript {
  const tamil = /[\u0b80-\u0bff]/u.test(value), sinhala = /[\u0d80-\u0dff]/u.test(value)
  return tamil && sinhala ? 'mixed' : tamil ? 'tamil' : sinhala ? 'sinhala' : /^\d+$/.test(value) ? 'numeric' : 'latin'
}
function splitOutsideParentheses(value: string, delimiters: Set<string>): string[] {
  const parts = ['']
  let depth = 0
  for (const ch of value) {
    if (ch === '(') depth++
    if (ch === ')') depth = Math.max(0, depth - 1)
    if (!depth && delimiters.has(ch)) parts.push('')
    else parts[parts.length - 1] += ch
  }
  return parts.map(part => part.trim()).filter(Boolean)
}

/** Dry-run proposal: no translation, transliteration, database or output-name
 * mutation. The caller must review/approve before any future write. */
export function splitMasterName(original: string, options: NameSplitOptions = {}) {
  if (typeof original !== 'string') throw new Error('Product name must be text')
  const warnings: TextWarning[] = []
  const canRepair = options.repairMojibake === true && options.format !== 'xlsx'
  const repair = proposeMojibakeRepair(original, canRepair ? 2 : 0)
  warnings.push(...repair.warnings)
  if (options.format === 'xlsx' && hasMojibake(original)) warnings.push({ code: 'xlsx_repair_skipped', message: 'Workbook cells are already decoded; edit the corrupted cell in preview or at source' })
  if (repair.changed) warnings.push({ code: 'encoding_repair_proposed', message: 'Encoding repair is a proposal and requires review' })
  const keywords: KeywordProposal[] = []
  const seen = new Set<string>()
  const add = (raw: string, reason: KeywordProposal['reason']) => {
    const keyword = raw.normalize('NFC').replace(/[\u200b-\u200d\ufeff]/g, '').replace(/\s+/g, ' ').trim()
    if (!keyword) return
    if (controls.test(keyword) || /[?\ufffd]/u.test(keyword) || hasMojibake(keyword)) {
      warnings.push({ code: 'unsafe_keyword_omitted', message: 'Unrecoverable or garbled text was not proposed as a keyword' }); return
    }
    const key = keyword.toLowerCase()
    if (!seen.has(key)) { keywords.push({ keyword, script: scriptOf(keyword), reason }); seen.add(key) }
  }
  const extractNative = (text: string) => text.replace(/[\u0b80-\u0bff\u0d80-\u0dff]+(?:[\s\u200b-\u200d\ufeff]+[\u0b80-\u0bff\u0d80-\u0dff]+)*/gu, match => { add(match, 'native_name'); return '' })
  let masterName = repair.text.replace(/\(([^()]*)\)/gu, (whole, contents: string) => {
    if (/^[\s?\ufffd]+$/u.test(contents) && /[?\ufffd]/u.test(contents)) {
      warnings.push({ code: 'unrecoverable_native_omitted', message: 'Non-English text unrecoverable; kept only the available master-name portion' }); return ''
    }
    if (!native.test(contents)) return whole
    const rest = extractNative(contents).trim().replace(/^[\s,;|/\-]+|[\s,;|/\-]+$/g, '')
    return rest ? `(${rest})` : ''
  })
  masterName = extractNative(masterName).replace(/\(\s*\)/g, '').replace(/\s+/g, ' ').trim()
  if (options.slashMode === 'first-part') {
    const delimiters = options.delimiters || ['/']
    if (!delimiters.length || delimiters.some(delimiter => !['/', ',', ';', '|'].includes(delimiter))) throw new Error('Choose supported single-character name delimiters')
    const parts = splitOutsideParentheses(masterName, new Set(delimiters))
    masterName = parts.shift() || ''
    for (const part of parts) add(part, 'explicit_delimiter')
  }
  const validation = validateMasterName(masterName)
  if (!masterName) warnings.push({ code: 'manual_english_name_required', message: 'No English master name can be inferred; enter it manually' })
  return { originalName: original, masterName, keywords, repaired: repair.changed, validation, warnings,
    needsReview: original !== masterName || keywords.length > 0 || warnings.length > 0 || !validation.valid }
}
